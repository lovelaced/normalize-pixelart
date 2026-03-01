use anyhow::{bail, Context, Result};
use clap::Parser;
use tracing::info;

use normalize_pixelart::cli::{Cli, Commands, PaletteAction, ProcessArgs};
use normalize_pixelart::color::palettes;
use normalize_pixelart::config::{load_config, parse_hex_color};
use normalize_pixelart::image_util::io::{load_image, save_image};
use normalize_pixelart::pipeline::{
    AaRemovalConfig, BackgroundConfig, DownscaleMode, GridDetectConfig, PipelineConfig,
    QuantizeConfig, run_pipeline,
};

fn main() -> Result<()> {
    let cli = Cli::parse();

    // Set up tracing based on verbosity
    let level = if cli.quiet {
        "error"
    } else {
        match cli.verbose {
            0 => "warn",
            1 => "info",
            2 => "debug",
            _ => "trace",
        }
    };
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(level)),
        )
        .with_writer(std::io::stderr)
        .init();

    // Load config file
    let config_file = load_config(cli.config.as_deref())
        .context("Failed to load config file")?;

    match cli.command {
        Commands::Process(args) => run_process(args, &config_file),
        Commands::Palette(args) => match args.action {
            PaletteAction::List => run_palette_list(),
            PaletteAction::Extract(extract_args) => run_palette_extract(extract_args),
        },
    }
}

fn run_process(
    args: ProcessArgs,
    config_file: &normalize_pixelart::config::ConfigFile,
) -> Result<()> {
    let output_path = args.output_path();

    // Check if output already exists
    let overwrite = args.overwrite || config_file.output.overwrite.unwrap_or(false);
    if output_path.exists() && !overwrite {
        bail!(
            "Output file already exists: {}. Use --overwrite to replace.",
            output_path.display()
        );
    }

    // Load the input image
    info!(path = %args.input.display(), "Loading image");
    let image = load_image(&args.input)?;
    let (w, h) = (image.width(), image.height());
    eprintln!("Loaded {}x{} image: {}", w, h, args.input.display());

    // Load custom palette file if specified
    let custom_palette = if let Some(ref path) = args.palette_file {
        let colors = palettes::load_hex_file(path)
            .map_err(|e| anyhow::anyhow!(e))?;
        eprintln!("Loaded {} colors from {}", colors.len(), path.display());
        Some(colors)
    } else {
        None
    };

    // Parse explicit background color
    let bg_color = if let Some(ref hex) = args.bg_color {
        Some(parse_hex_color(hex).map_err(|e| anyhow::anyhow!(e))?)
    } else if let Some(ref hex) = config_file.background.color {
        Some(parse_hex_color(hex).map_err(|e| anyhow::anyhow!(e))?)
    } else {
        None
    };

    // Parse downscale mode
    let downscale_mode: DownscaleMode = args
        .downscale_mode
        .parse()
        .map_err(|e: String| anyhow::anyhow!(e))?;

    // AA removal: off by default, enabled only if --aa-threshold is specified
    let (aa_threshold, aa_skip) = match args.aa_threshold {
        Some(t) => (t, false),
        None => match config_file.aa.threshold {
            Some(t) => (t, config_file.aa.skip.unwrap_or(false)),
            None => (0.5, true), // Default: skip AA removal
        },
    };

    // Build pipeline config — CLI args override config file values
    let config = PipelineConfig {
        grid: GridDetectConfig {
            override_size: args.grid_size.or(config_file.grid.size),
            override_phase: args.grid_phase,
            max_candidate: config_file.grid.max_candidate.unwrap_or(args.max_grid_candidate),
            skip: args.no_grid_detect || config_file.grid.skip.unwrap_or(false),
        },
        aa: AaRemovalConfig {
            threshold: aa_threshold,
            skip: aa_skip,
        },
        quantize: QuantizeConfig {
            num_colors: args.colors.or(config_file.quantize.colors),
            palette_name: args.palette.clone().or(config_file.quantize.palette.clone()),
            custom_palette,
            skip: args.no_quantize || config_file.quantize.skip.unwrap_or(false),
            ..Default::default()
        },
        background: BackgroundConfig {
            enabled: args.remove_bg || config_file.background.enabled.unwrap_or(false),
            bg_color,
            border_threshold: args
                .bg_threshold
                .or(config_file.background.border_threshold)
                .unwrap_or(0.4),
            color_tolerance: args
                .bg_tolerance
                .or(config_file.background.color_tolerance)
                .unwrap_or(0.05),
            flood_fill: !args.no_flood_fill
                && config_file.background.flood_fill.unwrap_or(true),
        },
        downscale_mode,
        output_width: args.target_width,
        output_height: args.target_height,
    };

    // Run the pipeline
    let state = run_pipeline(image, &config).context("Pipeline execution failed")?;

    // Report results
    if let Some(grid_size) = state.grid_size {
        let phase = state.grid_phase.unwrap_or((0, 0));
        let confidence = state
            .diagnostics
            .grid_confidence
            .map(|c| format!("{:.0}%", c * 100.0))
            .unwrap_or_else(|| "N/A".to_string());
        let logical_w = state.original_width / grid_size;
        let logical_h = state.original_height / grid_size;
        eprintln!(
            "Grid: {}x{} pixels, phase: ({}, {}), confidence: {}, logical: {}x{}",
            grid_size, grid_size, phase.0, phase.1, confidence, logical_w, logical_h
        );
    }

    let (ow, oh) = (state.image.width(), state.image.height());
    eprintln!("Output: {}x{}", ow, oh);

    // Save
    save_image(&state.image, &output_path)?;
    eprintln!("Saved: {}", output_path.display());

    Ok(())
}

fn run_palette_list() -> Result<()> {
    eprintln!("Built-in palettes:\n");
    for pal in palettes::ALL_PALETTES {
        println!("  {:<16} {:>3} colors  (--palette {})", pal.name, pal.colors.len(), pal.slug);
    }
    Ok(())
}

fn run_palette_extract(
    args: normalize_pixelart::cli::PaletteExtractArgs,
) -> Result<()> {
    use normalize_pixelart::color::kmeans::{kmeans_oklab, subsample};
    use normalize_pixelart::color::oklab::rgba_to_oklab;
    use palette::{IntoColor, Srgb};

    let image = load_image(&args.input)?;
    eprintln!(
        "Extracting {} colors from {}...",
        args.colors,
        args.input.display()
    );

    // Collect opaque pixel colors
    let all_colors: Vec<palette::Oklab> = image
        .pixels()
        .filter(|p| p[3] > 0)
        .map(|p| rgba_to_oklab(*p))
        .collect();

    if all_colors.is_empty() {
        bail!("Image has no opaque pixels");
    }

    let samples = subsample(&all_colors, 10000);
    let centroids = kmeans_oklab(&samples, args.colors as usize, 50);

    // Convert to RGB and display
    let mut hex_lines = Vec::new();
    for c in &centroids {
        let srgb: Srgb = (*c).into_color();
        let r = (srgb.red.clamp(0.0, 1.0) * 255.0).round() as u8;
        let g = (srgb.green.clamp(0.0, 1.0) * 255.0).round() as u8;
        let b = (srgb.blue.clamp(0.0, 1.0) * 255.0).round() as u8;
        let hex = format!("{:02X}{:02X}{:02X}", r, g, b);
        println!("#{}", hex);
        hex_lines.push(hex);
    }

    if let Some(ref output) = args.output {
        let content = hex_lines.join("\n") + "\n";
        std::fs::write(output, content)
            .with_context(|| format!("Failed to write palette file: {}", output.display()))?;
        eprintln!("Saved palette to {}", output.display());
    }

    Ok(())
}
