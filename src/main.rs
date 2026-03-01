use anyhow::{bail, Context, Result};
use clap::Parser;
use tracing::info;

use normalize_pixelart::cli::{Cli, Commands, PaletteAction, PipelineFlags, ProcessArgs};
use normalize_pixelart::color::palettes;
use normalize_pixelart::config::{load_config, parse_hex_color, ConfigFile};
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
        Commands::Batch(args) => run_batch_command(args, &config_file),
        Commands::Sheet(args) => run_sheet_command(args, &config_file),
        Commands::Palette(args) => match args.action {
            PaletteAction::List => run_palette_list(),
            PaletteAction::Extract(extract_args) => run_palette_extract(extract_args),
            #[cfg(feature = "lospec")]
            PaletteAction::Fetch(fetch_args) => run_palette_fetch(fetch_args),
        },
        #[cfg(feature = "tui")]
        Commands::Tui(args) => {
            let (config, _) = build_pipeline_config(&args.pipeline, &config_file)?;
            normalize_pixelart::tui::run_tui(args.input, config)
        }
    }
}

/// Build a PipelineConfig from shared PipelineFlags + config file.
fn build_pipeline_config(
    flags: &PipelineFlags,
    config_file: &ConfigFile,
) -> Result<(PipelineConfig, Option<Vec<[u8; 3]>>)> {
    // Load custom palette: --palette-file takes priority over --lospec
    let custom_palette = if let Some(ref path) = flags.palette_file {
        let colors = palettes::load_hex_file(path)
            .map_err(|e| anyhow::anyhow!(e))?;
        eprintln!("Loaded {} colors from {}", colors.len(), path.display());
        Some(colors)
    } else {
        None
    };

    #[cfg(feature = "lospec")]
    let custom_palette = if custom_palette.is_none() {
        if let Some(ref slug) = flags.lospec {
            let pal = normalize_pixelart::color::lospec::fetch_lospec_palette(slug)
                .map_err(|e| anyhow::anyhow!(e))?;
            eprintln!("Lospec: {} ({} colors)", pal.name, pal.colors.len());
            Some(pal.colors)
        } else {
            None
        }
    } else {
        custom_palette
    };

    // Parse explicit background color
    let bg_color = if let Some(ref hex) = flags.bg_color {
        Some(parse_hex_color(hex).map_err(|e| anyhow::anyhow!(e))?)
    } else if let Some(ref hex) = config_file.background.color {
        Some(parse_hex_color(hex).map_err(|e| anyhow::anyhow!(e))?)
    } else {
        None
    };

    // Parse downscale mode
    let downscale_mode: DownscaleMode = flags
        .downscale_mode
        .parse()
        .map_err(|e: String| anyhow::anyhow!(e))?;

    // AA removal: off by default, enabled only if --aa-threshold is specified
    let (aa_threshold, aa_skip) = match flags.aa_threshold {
        Some(t) => (t, false),
        None => match config_file.aa.threshold {
            Some(t) => (t, config_file.aa.skip.unwrap_or(false)),
            None => (0.5, true),
        },
    };

    let config = PipelineConfig {
        grid: GridDetectConfig {
            override_size: flags.grid_size.or(config_file.grid.size),
            override_phase: flags.grid_phase,
            max_candidate: config_file.grid.max_candidate.unwrap_or(flags.max_grid_candidate),
            skip: flags.no_grid_detect || config_file.grid.skip.unwrap_or(false),
        },
        aa: AaRemovalConfig {
            threshold: aa_threshold,
            skip: aa_skip,
        },
        quantize: QuantizeConfig {
            num_colors: flags.colors.or(config_file.quantize.colors),
            palette_name: flags.palette.clone().or(config_file.quantize.palette.clone()),
            custom_palette,
            skip: flags.no_quantize || config_file.quantize.skip.unwrap_or(false),
            ..Default::default()
        },
        background: BackgroundConfig {
            enabled: flags.remove_bg || config_file.background.enabled.unwrap_or(false),
            bg_color,
            border_threshold: flags
                .bg_threshold
                .or(config_file.background.border_threshold)
                .unwrap_or(0.4),
            color_tolerance: flags
                .bg_tolerance
                .or(config_file.background.color_tolerance)
                .unwrap_or(0.05),
            flood_fill: !flags.no_flood_fill
                && config_file.background.flood_fill.unwrap_or(true),
        },
        downscale_mode,
        output_width: None,
        output_height: None,
    };

    Ok((config, None))
}

fn run_process(args: ProcessArgs, config_file: &ConfigFile) -> Result<()> {
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

    let (mut config, _) = build_pipeline_config(&args.pipeline, config_file)?;
    config.output_width = args.target_width;
    config.output_height = args.target_height;

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

fn run_batch_command(
    args: normalize_pixelart::cli::BatchArgs,
    config_file: &ConfigFile,
) -> Result<()> {
    let (config, _) = build_pipeline_config(&args.pipeline, config_file)?;

    // Resolve input files via glob
    let inputs = normalize_pixelart::batch::resolve_inputs(&args.input)?;
    if inputs.is_empty() {
        bail!("No input files matched pattern: {}", args.input);
    }

    eprintln!("Found {} input files", inputs.len());

    // Create output directory
    std::fs::create_dir_all(&args.output)
        .with_context(|| format!("Failed to create output directory: {}", args.output.display()))?;

    let overwrite = args.overwrite || config_file.output.overwrite.unwrap_or(false);
    let result = normalize_pixelart::batch::run_batch(&inputs, &args.output, &config, overwrite)?;

    eprintln!(
        "\nBatch complete: {} succeeded, {} failed",
        result.succeeded, result.failed.len()
    );
    for (path, err) in &result.failed {
        eprintln!("  FAILED {}: {}", path.display(), err);
    }

    if !result.failed.is_empty() {
        bail!("{} images failed to process", result.failed.len());
    }

    Ok(())
}

fn run_sheet_command(
    args: normalize_pixelart::cli::SheetArgs,
    config_file: &ConfigFile,
) -> Result<()> {
    let output_path = args.output_path();

    let overwrite = args.overwrite || config_file.output.overwrite.unwrap_or(false);
    if output_path.exists() && !overwrite {
        bail!(
            "Output file already exists: {}. Use --overwrite to replace.",
            output_path.display()
        );
    }

    info!(path = %args.input.display(), "Loading sprite sheet");
    let image = load_image(&args.input)?;
    let (w, h) = (image.width(), image.height());
    eprintln!("Loaded {}x{} sprite sheet: {}", w, h, args.input.display());

    match (args.tile_width, args.tile_height) {
        (Some(tw), Some(th)) => {
            // Original fixed-grid mode
            let (config, _) = build_pipeline_config(&args.pipeline, config_file)?;

            let result = normalize_pixelart::spritesheet::process_sheet(
                &image,
                tw,
                th,
                args.spacing,
                args.margin,
                &config,
            )
            .context("Sprite sheet processing failed")?;

            let (ow, oh) = (result.width(), result.height());
            eprintln!("Output: {}x{}", ow, oh);

            save_image(&result, &output_path)?;
            eprintln!("Saved: {}", output_path.display());
        }
        (None, None) => {
            // Auto-split mode
            use normalize_pixelart::spritesheet::{AutoSplitConfig, process_sheet_auto};

            // Parse bg_color from pipeline flags or config
            let bg_color = if let Some(ref hex) = args.pipeline.bg_color {
                Some(parse_hex_color(hex).map_err(|e| anyhow::anyhow!(e))?)
            } else if let Some(ref hex) = config_file.background.color {
                Some(parse_hex_color(hex).map_err(|e| anyhow::anyhow!(e))?)
            } else {
                None
            };

            let tolerance = args
                .pipeline
                .bg_tolerance
                .or(config_file.background.color_tolerance)
                .unwrap_or(0.05);

            let auto_config = AutoSplitConfig {
                bg_color,
                tolerance,
                separator_threshold: args
                    .separator_threshold
                    .or(config_file.sheet.separator_threshold)
                    .unwrap_or(0.90),
                min_sprite_size: args
                    .min_sprite_size
                    .or(config_file.sheet.min_sprite_size)
                    .unwrap_or(8),
                pad: args
                    .pad
                    .or(config_file.sheet.pad)
                    .unwrap_or(0),
            };

            let pipeline_config = if args.no_normalize {
                None
            } else {
                let (config, _) = build_pipeline_config(&args.pipeline, config_file)?;
                Some(config)
            };

            let (sheet, tiles, tile_w, tile_h) =
                process_sheet_auto(&image, &auto_config, pipeline_config.as_ref())
                    .context("Auto-split sprite sheet processing failed")?;

            let (ow, oh) = (sheet.width(), sheet.height());
            eprintln!("Output: {}x{} ({} sprites, {}x{} each)", ow, oh, tiles.len(), tile_w, tile_h);

            save_image(&sheet, &output_path)?;
            eprintln!("Saved: {}", output_path.display());

            // Optionally save individual sprite files
            if let Some(ref dir) = args.output_dir {
                std::fs::create_dir_all(dir)
                    .with_context(|| format!("Failed to create output directory: {}", dir.display()))?;
                for tile in &tiles {
                    let filename = format!("sprite_{:02}_{:02}.png", tile.row, tile.col);
                    let path = dir.join(&filename);
                    save_image(&tile.image, &path)?;
                }
                eprintln!("Saved {} individual sprites to {}", tiles.len(), dir.display());
            }
        }
        _ => {
            bail!(
                "Either both --tile-width and --tile-height must be specified (fixed grid mode), \
                 or neither (auto-split mode)."
            );
        }
    }

    Ok(())
}

fn run_palette_list() -> Result<()> {
    eprintln!("Built-in palettes:\n");
    for pal in palettes::ALL_PALETTES {
        println!("  {:<16} {:>3} colors  (--palette {})", pal.name, pal.colors.len(), pal.slug);
    }
    Ok(())
}

#[cfg(feature = "lospec")]
fn run_palette_fetch(args: normalize_pixelart::cli::PaletteFetchArgs) -> Result<()> {
    use normalize_pixelart::color::lospec;

    eprintln!("Fetching palette '{}' from Lospec...", args.slug);
    let pal = lospec::fetch_lospec_palette(&args.slug)
        .map_err(|e| anyhow::anyhow!(e))?;

    eprintln!("{} ({} colors)\n", pal.name, pal.colors.len());
    for color in &pal.colors {
        println!("#{:02X}{:02X}{:02X}", color[0], color[1], color[2]);
    }

    if let Some(ref output) = args.output {
        let content = lospec::palette_to_hex_string(&pal);
        std::fs::write(output, content)
            .with_context(|| format!("Failed to write palette file: {}", output.display()))?;
        eprintln!("\nSaved palette to {}", output.display());
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
