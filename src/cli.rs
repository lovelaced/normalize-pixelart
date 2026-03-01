use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(
    name = "normalize-pixelart",
    about = "Normalize AI-generated pixel art into clean, grid-aligned game assets",
    version
)]
pub struct Cli {
    /// Increase verbosity (-v, -vv, -vvv)
    #[arg(short, long, action = clap::ArgAction::Count, global = true)]
    pub verbose: u8,

    /// Suppress all output except errors
    #[arg(short, long, global = true)]
    pub quiet: bool,

    /// Path to config file (default: .normalize-pixelart.toml in cwd)
    #[arg(long, global = true)]
    pub config: Option<PathBuf>,

    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Process a single image
    Process(ProcessArgs),
    /// Batch process a directory of images
    Batch(BatchArgs),
    /// Process a sprite sheet (split, normalize, reassemble)
    Sheet(SheetArgs),
    /// List available palettes or extract palette from an image
    Palette(PaletteArgs),
    /// Launch interactive TUI editor
    #[cfg(feature = "tui")]
    Tui(TuiArgs),
}

#[cfg(feature = "tui")]
#[derive(Parser, Debug)]
pub struct TuiArgs {
    /// Input image to load (optional — can open from within TUI)
    pub input: Option<PathBuf>,

    /// Pipeline options (initial settings)
    #[command(flatten)]
    pub pipeline: PipelineFlags,
}

/// Shared pipeline flags used by process, batch, and sheet commands.
#[derive(Parser, Debug, Clone)]
pub struct PipelineFlags {
    // --- Grid Detection ---
    /// Override auto-detected grid size (pixels per logical pixel)
    #[arg(long)]
    pub grid_size: Option<u32>,

    /// Override grid phase offset as "X,Y" (default: auto-detect)
    #[arg(long, value_parser = parse_phase)]
    pub grid_phase: Option<(u32, u32)>,

    /// Skip grid detection entirely (requires --grid-size)
    #[arg(long)]
    pub no_grid_detect: bool,

    /// Maximum grid size candidate to test during detection (default: 32)
    #[arg(long, default_value = "32")]
    pub max_grid_candidate: u32,

    // --- Downscale ---
    /// Downscale mode: snap (default, preserves dithering), center-weighted, majority-vote, center-pixel
    #[arg(long, default_value = "snap")]
    pub downscale_mode: String,

    // --- Anti-aliasing ---
    /// Enable AA removal with sensitivity 0.0-1.0 (off by default).
    /// Lower = more aggressive. Only useful for cleanly upscaled pixel art.
    #[arg(long)]
    pub aa_threshold: Option<f32>,

    // --- Color Quantization ---
    /// Use a predefined palette (pico-8, sweetie-16, endesga-32, endesga-64, gameboy, nes)
    #[arg(long)]
    pub palette: Option<String>,

    /// Load a custom palette from a .hex file (one color per line)
    #[arg(long)]
    pub palette_file: Option<PathBuf>,

    /// Fetch a palette from Lospec by slug (e.g., "sweetie-16", "endesga-32")
    #[cfg(feature = "lospec")]
    #[arg(long)]
    pub lospec: Option<String>,

    /// Auto-extract palette with this many colors
    #[arg(long)]
    pub colors: Option<u32>,

    /// Skip color quantization entirely
    #[arg(long)]
    pub no_quantize: bool,

    // --- Background Removal ---
    /// Enable background detection and removal
    #[arg(long)]
    pub remove_bg: bool,

    /// Explicit background color as hex (e.g., "FF00FF" or "#FF00FF")
    #[arg(long)]
    pub bg_color: Option<String>,

    /// Minimum fraction of border pixels for auto-detection (0.0-1.0, default: 0.4)
    #[arg(long)]
    pub bg_threshold: Option<f32>,

    /// Color tolerance for background matching in OKLAB space (default: 0.05)
    #[arg(long)]
    pub bg_tolerance: Option<f32>,

    /// Use global replacement instead of flood-fill (removes interior bg too)
    #[arg(long)]
    pub no_flood_fill: bool,
}

#[derive(Parser, Debug)]
pub struct ProcessArgs {
    /// Input image path
    pub input: PathBuf,

    /// Output image path (default: <input>_normalized.png)
    pub output: Option<PathBuf>,

    // --- Output Size ---
    /// Target output width (default: same as input)
    #[arg(long)]
    pub target_width: Option<u32>,

    /// Target output height (default: same as input)
    #[arg(long)]
    pub target_height: Option<u32>,

    /// Overwrite output file if it exists
    #[arg(long)]
    pub overwrite: bool,

    /// Pipeline options
    #[command(flatten)]
    pub pipeline: PipelineFlags,
}

impl ProcessArgs {
    /// Compute the output path. Defaults to `<input>_normalized.png`.
    pub fn output_path(&self) -> PathBuf {
        if let Some(ref out) = self.output {
            out.clone()
        } else {
            let stem = self
                .input
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy();
            let ext = self
                .input
                .extension()
                .unwrap_or_default()
                .to_string_lossy();
            let ext = if ext.is_empty() { "png" } else { &ext };
            self.input
                .with_file_name(format!("{}_normalized.{}", stem, ext))
        }
    }
}

#[derive(Parser, Debug)]
pub struct BatchArgs {
    /// Input glob pattern or directory (e.g., "sprites/*.png", "./input/")
    pub input: String,

    /// Output directory (created if needed)
    pub output: PathBuf,

    /// Overwrite output files if they exist
    #[arg(long)]
    pub overwrite: bool,

    /// Pipeline options
    #[command(flatten)]
    pub pipeline: PipelineFlags,
}

#[derive(Parser, Debug)]
pub struct SheetArgs {
    /// Input sprite sheet image
    pub input: PathBuf,

    /// Output sprite sheet (default: <input>_normalized.png)
    pub output: Option<PathBuf>,

    /// Tile width in pixels (omit for auto-split mode)
    #[arg(long)]
    pub tile_width: Option<u32>,

    /// Tile height in pixels (omit for auto-split mode)
    #[arg(long)]
    pub tile_height: Option<u32>,

    /// Spacing between tiles in pixels (default: 0)
    #[arg(long, default_value = "0")]
    pub spacing: u32,

    /// Margin around the sheet in pixels (default: 0)
    #[arg(long, default_value = "0")]
    pub margin: u32,

    /// Overwrite output file if it exists
    #[arg(long)]
    pub overwrite: bool,

    // --- Auto-split options ---
    /// Fraction of background pixels to classify a row/column as a separator (0.0-1.0, default: 0.90)
    #[arg(long)]
    pub separator_threshold: Option<f32>,

    /// Minimum sprite dimension in pixels; smaller regions are filtered as noise (default: 8)
    #[arg(long)]
    pub min_sprite_size: Option<u32>,

    /// Padding around each sprite in the output sheet (default: 0)
    #[arg(long)]
    pub pad: Option<u32>,

    /// Also save individual sprite files to this directory
    #[arg(long)]
    pub output_dir: Option<PathBuf>,

    /// Skip the normalization pipeline (just split and reassemble)
    #[arg(long)]
    pub no_normalize: bool,

    /// Pipeline options
    #[command(flatten)]
    pub pipeline: PipelineFlags,
}

impl SheetArgs {
    /// Compute the output path. Defaults to `<input>_normalized.png`.
    pub fn output_path(&self) -> PathBuf {
        if let Some(ref out) = self.output {
            out.clone()
        } else {
            let stem = self
                .input
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy();
            let ext = self
                .input
                .extension()
                .unwrap_or_default()
                .to_string_lossy();
            let ext = if ext.is_empty() { "png" } else { &ext };
            self.input
                .with_file_name(format!("{}_normalized.{}", stem, ext))
        }
    }
}

#[derive(Parser, Debug)]
pub struct PaletteArgs {
    #[command(subcommand)]
    pub action: PaletteAction,
}

#[derive(Subcommand, Debug)]
pub enum PaletteAction {
    /// List all built-in palettes
    List,
    /// Extract a palette from an image using k-means
    Extract(PaletteExtractArgs),
    /// Fetch a palette from Lospec (lospec.com) by slug
    #[cfg(feature = "lospec")]
    Fetch(PaletteFetchArgs),
}

#[cfg(feature = "lospec")]
#[derive(Parser, Debug)]
pub struct PaletteFetchArgs {
    /// Palette slug on Lospec (e.g., "pico-8", "sweetie-16", "endesga-32")
    pub slug: String,

    /// Save palette as .hex file
    #[arg(long, short)]
    pub output: Option<PathBuf>,
}

#[derive(Parser, Debug)]
pub struct PaletteExtractArgs {
    /// Input image path
    pub input: PathBuf,

    /// Number of colors to extract (default: 16)
    #[arg(long, default_value = "16")]
    pub colors: u32,

    /// Save palette as .hex file
    #[arg(long, short)]
    pub output: Option<PathBuf>,
}

fn parse_phase(s: &str) -> Result<(u32, u32), String> {
    let parts: Vec<&str> = s.split(',').collect();
    if parts.len() != 2 {
        return Err("Phase must be in format 'X,Y' (e.g., '1,2')".to_string());
    }
    let x = parts[0]
        .trim()
        .parse::<u32>()
        .map_err(|e| format!("Invalid X value: {}", e))?;
    let y = parts[1]
        .trim()
        .parse::<u32>()
        .map_err(|e| format!("Invalid Y value: {}", e))?;
    Ok((x, y))
}
