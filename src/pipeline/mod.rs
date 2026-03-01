pub mod aa_removal;
pub mod background;
pub mod downscale;
pub mod grid_detect;
pub mod quantize;

use anyhow::Result;
use image::RgbaImage;
use tracing::info;

pub use aa_removal::AaRemovalConfig;
pub use background::BackgroundConfig;
pub use downscale::DownscaleMode;
pub use quantize::QuantizeConfig;

/// Configuration for the grid detection stage.
#[derive(Debug, Clone)]
pub struct GridDetectConfig {
    /// If set, skip auto-detection and use this grid size.
    pub override_size: Option<u32>,
    /// If set, skip auto-detection and use this grid phase offset.
    pub override_phase: Option<(u32, u32)>,
    /// Maximum candidate grid size to test (default: 32).
    pub max_candidate: u32,
    /// Whether to skip grid detection entirely.
    pub skip: bool,
}

impl Default for GridDetectConfig {
    fn default() -> Self {
        Self {
            override_size: None,
            override_phase: None,
            max_candidate: 32,
            skip: false,
        }
    }
}

/// Full pipeline configuration.
#[derive(Debug, Clone, Default)]
pub struct PipelineConfig {
    pub grid: GridDetectConfig,
    pub aa: AaRemovalConfig,
    pub quantize: QuantizeConfig,
    pub background: BackgroundConfig,
    pub downscale_mode: DownscaleMode,
    /// Explicit output width. If None, preserves input width.
    pub output_width: Option<u32>,
    /// Explicit output height. If None, preserves input height.
    pub output_height: Option<u32>,
}

/// Diagnostic information collected during pipeline execution.
#[derive(Debug, Clone, Default)]
pub struct PipelineDiagnostics {
    /// Grid detection confidence (0.0 = no confidence, 1.0 = perfect grid).
    pub grid_confidence: Option<f32>,
    /// Edge alignment scores for each candidate grid size (for debugging).
    pub grid_variance_scores: Vec<(u32, f32)>,
}

/// State carried through the pipeline stages.
pub struct PipelineState {
    /// The working image, mutated by each stage.
    pub image: RgbaImage,
    /// Original input dimensions (for preserving size).
    pub original_width: u32,
    pub original_height: u32,
    /// Detected (or overridden) grid size.
    pub grid_size: Option<u32>,
    /// Detected (or overridden) grid phase offset (x, y).
    pub grid_phase: Option<(u32, u32)>,
    /// Diagnostic info for reporting / TUI display.
    pub diagnostics: PipelineDiagnostics,
}

impl PipelineState {
    pub fn new(image: RgbaImage) -> Self {
        let w = image.width();
        let h = image.height();
        Self {
            image,
            original_width: w,
            original_height: h,
            grid_size: None,
            grid_phase: None,
            diagnostics: PipelineDiagnostics::default(),
        }
    }
}

/// Run the full normalization pipeline on a single image.
pub fn run_pipeline(image: RgbaImage, config: &PipelineConfig) -> Result<PipelineState> {
    let mut state = PipelineState::new(image);

    // Stage 1: Grid detection
    if !config.grid.skip {
        grid_detect::detect_grid(&mut state, &config.grid)?;
    }

    // Stage 2: Anti-aliasing removal (before downscale for best results)
    if !config.aa.skip {
        aa_removal::remove_aa(&mut state, &config.aa)?;
    }

    // Stage 3: Grid normalization (only if we have a grid size > 1)
    let used_snap_mode = config.downscale_mode == DownscaleMode::Snap;
    if let Some(grid_size) = state.grid_size {
        if grid_size > 1 {
            downscale::majority_vote_downscale(&mut state, config.downscale_mode)?;
        }
    }

    // Stage 4: Color quantization (at logical pixel resolution — fast)
    if !config.quantize.skip {
        quantize::quantize_colors(&mut state, &config.quantize)?;
    }

    // Stage 5: Background removal
    background::remove_background(&mut state.image, &config.background)?;

    // Stage 6: Resize to final output size
    // Snap mode already outputs at original resolution, so only resize if
    // the user explicitly requested different dimensions.
    let out_w = if used_snap_mode {
        config.output_width.unwrap_or(state.image.width())
    } else {
        config.output_width.unwrap_or(state.original_width)
    };
    let out_h = if used_snap_mode {
        config.output_height.unwrap_or(state.image.height())
    } else {
        config.output_height.unwrap_or(state.original_height)
    };
    let (cur_w, cur_h) = (state.image.width(), state.image.height());

    if cur_w != out_w || cur_h != out_h {
        info!(
            from_w = cur_w,
            from_h = cur_h,
            to_w = out_w,
            to_h = out_h,
            "Resizing to output dimensions"
        );
        state.image = image::imageops::resize(
            &state.image,
            out_w,
            out_h,
            image::imageops::FilterType::Nearest,
        );
    }

    Ok(state)
}
