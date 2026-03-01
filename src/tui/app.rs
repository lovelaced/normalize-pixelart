use std::path::{Path, PathBuf};

use image::RgbaImage;
use ratatui_image::picker::Picker;
use ratatui_image::protocol::StatefulProtocol;

use crate::image_util::histogram::ColorHistogram;
use crate::image_util::io::{load_image, save_image};
use crate::pipeline::{PipelineConfig, PipelineDiagnostics, run_pipeline};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tab {
    Preview,
    Settings,
    Diagnostics,
}

impl Tab {
    pub const ALL: [Tab; 3] = [Tab::Preview, Tab::Settings, Tab::Diagnostics];

    pub fn title(self) -> &'static str {
        match self {
            Tab::Preview => "Preview",
            Tab::Settings => "Settings",
            Tab::Diagnostics => "Diagnostics",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettingId {
    GridSize,
    DownscaleMode,
    AaThreshold,
    PaletteName,
    AutoColors,
    RemoveBg,
    BgTolerance,
    FloodFill,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextInputMode {
    OpenFile,
    SaveFile,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusLevel {
    Info,
    Success,
    Error,
}

pub struct App {
    // Navigation
    pub active_tab: Tab,
    pub should_quit: bool,

    // Image data
    pub input_path: Option<PathBuf>,
    pub original_image: Option<RgbaImage>,
    pub processed_image: Option<RgbaImage>,

    // Image rendering
    pub picker: Picker,
    pub original_protocol: Option<StatefulProtocol>,
    pub processed_protocol: Option<StatefulProtocol>,

    // Pipeline config (mutable by user)
    pub config: PipelineConfig,
    pub initial_config: PipelineConfig,

    // Settings UI state
    pub settings: Vec<SettingId>,
    pub settings_selected: usize,

    // Status
    pub status_message: String,
    pub status_level: StatusLevel,

    // Diagnostics cache
    pub diagnostics: Option<PipelineDiagnostics>,
    pub color_histogram: Option<Vec<(image::Rgba<u8>, u32)>>,
    pub unique_colors: usize,

    // Text input
    pub text_input_mode: Option<TextInputMode>,
    pub text_input_buffer: String,
}

impl App {
    pub fn new(picker: Picker, config: PipelineConfig, detected_protocol: &str) -> Self {
        Self {
            active_tab: Tab::Preview,
            should_quit: false,
            input_path: None,
            original_image: None,
            processed_image: None,
            picker,
            original_protocol: None,
            processed_protocol: None,
            initial_config: config.clone(),
            config,
            settings: vec![
                SettingId::GridSize,
                SettingId::DownscaleMode,
                SettingId::AaThreshold,
                SettingId::PaletteName,
                SettingId::AutoColors,
                SettingId::RemoveBg,
                SettingId::BgTolerance,
                SettingId::FloodFill,
            ],
            settings_selected: 0,
            status_message: format!(
                "Press 'o' to open an image (detected: {}, using: Halfblocks)",
                detected_protocol
            ),
            status_level: StatusLevel::Info,
            diagnostics: None,
            color_histogram: None,
            unique_colors: 0,
            text_input_mode: None,
            text_input_buffer: String::new(),
        }
    }

    pub fn cycle_tab(&mut self) {
        self.active_tab = match self.active_tab {
            Tab::Preview => Tab::Settings,
            Tab::Settings => Tab::Diagnostics,
            Tab::Diagnostics => Tab::Preview,
        };
    }

    pub fn settings_next(&mut self) {
        if self.settings_selected + 1 < self.settings.len() {
            self.settings_selected += 1;
        }
    }

    pub fn settings_prev(&mut self) {
        if self.settings_selected > 0 {
            self.settings_selected -= 1;
        }
    }

    pub fn load_image(&mut self, path: &Path) {
        match load_image(path) {
            Ok(img) => {
                let dyn_img = image::DynamicImage::ImageRgba8(img.clone());
                self.original_protocol = Some(self.picker.new_resize_protocol(dyn_img));
                self.original_image = Some(img);
                self.input_path = Some(path.to_path_buf());
                self.processed_image = None;
                self.processed_protocol = None;
                self.diagnostics = None;
                self.color_histogram = None;
                self.unique_colors = 0;
                self.status_message = format!("Loaded: {}", path.display());
                self.status_level = StatusLevel::Success;
                self.run_pipeline();
            }
            Err(e) => {
                self.status_message = format!("Error loading: {}", e);
                self.status_level = StatusLevel::Error;
            }
        }
    }

    pub fn run_pipeline(&mut self) {
        let Some(ref img) = self.original_image else {
            self.status_message = "No image loaded".to_string();
            self.status_level = StatusLevel::Info;
            return;
        };

        match run_pipeline(img.clone(), &self.config) {
            Ok(state) => {
                let dyn_img = image::DynamicImage::ImageRgba8(state.image.clone());
                self.processed_protocol = Some(self.picker.new_resize_protocol(dyn_img));
                self.diagnostics = Some(state.diagnostics.clone());
                let hist = ColorHistogram::from_image(&state.image);
                self.color_histogram = Some(hist.top_n(20));
                self.unique_colors = hist.unique_colors();
                self.processed_image = Some(state.image);

                // Build status summary
                let grid_info = if let Some(ref diag) = self.diagnostics {
                    if let Some(conf) = diag.grid_confidence {
                        format!("Grid: {} ({:.0}%)",
                            self.config.grid.override_size
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| "auto".to_string()),
                            conf * 100.0)
                    } else {
                        "Grid: none".to_string()
                    }
                } else {
                    String::new()
                };
                self.status_message = format!("Done. {} | {} unique colors", grid_info, self.unique_colors);
                self.status_level = StatusLevel::Success;
            }
            Err(e) => {
                self.status_message = format!("Pipeline error: {}", e);
                self.status_level = StatusLevel::Error;
            }
        }
    }

    pub fn save_image(&mut self, path: &Path) {
        if let Some(ref img) = self.processed_image {
            match save_image(img, path) {
                Ok(()) => {
                    self.status_message = format!("Saved: {}", path.display());
                    self.status_level = StatusLevel::Success;
                }
                Err(e) => {
                    self.status_message = format!("Save error: {}", e);
                    self.status_level = StatusLevel::Error;
                }
            }
        } else {
            self.status_message = "No processed image to save".to_string();
            self.status_level = StatusLevel::Error;
        }
    }

    pub fn default_output_path(&self) -> String {
        if let Some(ref path) = self.input_path {
            let stem = path.file_stem().unwrap_or_default().to_string_lossy();
            let ext = path.extension().unwrap_or_default().to_string_lossy();
            let ext = if ext.is_empty() { "png" } else { &ext };
            path.with_file_name(format!("{}_normalized.{}", stem, ext))
                .display()
                .to_string()
        } else {
            "output.png".to_string()
        }
    }

    pub fn reset_config(&mut self) {
        self.config = self.initial_config.clone();
        self.status_message = "Config reset to initial values".to_string();
        self.status_level = StatusLevel::Info;
    }

    pub fn adjust_setting(&mut self, delta: i32) {
        let id = self.settings[self.settings_selected];
        match id {
            SettingId::GridSize => {
                const SIZES: &[Option<u32>] = &[
                    None, Some(2), Some(3), Some(4), Some(5), Some(6),
                    Some(7), Some(8), Some(10), Some(12), Some(16), Some(24), Some(32),
                ];
                let current = SIZES.iter().position(|s| *s == self.config.grid.override_size).unwrap_or(0);
                let next = (current as i32 + delta).rem_euclid(SIZES.len() as i32) as usize;
                self.config.grid.override_size = SIZES[next];
                self.config.grid.skip = false;
            }
            SettingId::DownscaleMode => {
                use crate::pipeline::DownscaleMode;
                const MODES: &[DownscaleMode] = &[
                    DownscaleMode::Snap,
                    DownscaleMode::CenterWeighted,
                    DownscaleMode::MajorityVote,
                    DownscaleMode::CenterPixel,
                ];
                let current = MODES.iter().position(|m| *m == self.config.downscale_mode).unwrap_or(0);
                let next = (current as i32 + delta).rem_euclid(MODES.len() as i32) as usize;
                self.config.downscale_mode = MODES[next];
            }
            SettingId::AaThreshold => {
                const VALS: &[Option<f32>] = &[
                    None, Some(0.1), Some(0.2), Some(0.3), Some(0.4), Some(0.5),
                    Some(0.6), Some(0.7), Some(0.8), Some(0.9), Some(1.0),
                ];
                let current_val = if self.config.aa.skip { None } else { Some(self.config.aa.threshold) };
                let current = VALS.iter().position(|v| match (v, &current_val) {
                    (None, None) => true,
                    (Some(a), Some(b)) => (*a - *b).abs() < 0.01,
                    _ => false,
                }).unwrap_or(0);
                let next = (current as i32 + delta).rem_euclid(VALS.len() as i32) as usize;
                match VALS[next] {
                    None => { self.config.aa.skip = true; }
                    Some(t) => { self.config.aa.skip = false; self.config.aa.threshold = t; }
                }
            }
            SettingId::PaletteName => {
                use crate::color::palettes::ALL_PALETTES;
                let names: Vec<Option<&str>> = std::iter::once(None)
                    .chain(ALL_PALETTES.iter().map(|p| Some(p.slug)))
                    .collect();
                let current = names.iter().position(|n| *n == self.config.quantize.palette_name.as_deref()).unwrap_or(0);
                let next = (current as i32 + delta).rem_euclid(names.len() as i32) as usize;
                self.config.quantize.palette_name = names[next].map(String::from);
                if self.config.quantize.palette_name.is_some() {
                    self.config.quantize.skip = false;
                    self.config.quantize.num_colors = None;
                }
            }
            SettingId::AutoColors => {
                const VALS: &[Option<u32>] = &[
                    None, Some(4), Some(8), Some(16), Some(32), Some(64), Some(128), Some(256),
                ];
                let current = VALS.iter().position(|v| *v == self.config.quantize.num_colors).unwrap_or(0);
                let next = (current as i32 + delta).rem_euclid(VALS.len() as i32) as usize;
                self.config.quantize.num_colors = VALS[next];
                if self.config.quantize.num_colors.is_some() {
                    self.config.quantize.skip = false;
                    self.config.quantize.palette_name = None;
                }
            }
            SettingId::RemoveBg => {
                self.config.background.enabled = !self.config.background.enabled;
            }
            SettingId::BgTolerance => {
                const VALS: &[f32] = &[0.01, 0.02, 0.03, 0.05, 0.08, 0.10, 0.15, 0.20];
                let current = VALS.iter().position(|v| (*v - self.config.background.color_tolerance).abs() < 0.005).unwrap_or(3);
                let next = (current as i32 + delta).rem_euclid(VALS.len() as i32) as usize;
                self.config.background.color_tolerance = VALS[next];
            }
            SettingId::FloodFill => {
                self.config.background.flood_fill = !self.config.background.flood_fill;
            }
        }
    }

    pub fn setting_display(&self, id: SettingId) -> String {
        match id {
            SettingId::GridSize => {
                self.config.grid.override_size
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "auto".to_string())
            }
            SettingId::DownscaleMode => format!("{}", self.config.downscale_mode),
            SettingId::AaThreshold => {
                if self.config.aa.skip { "off".to_string() }
                else { format!("{:.1}", self.config.aa.threshold) }
            }
            SettingId::PaletteName => {
                self.config.quantize.palette_name.as_deref().unwrap_or("none").to_string()
            }
            SettingId::AutoColors => {
                self.config.quantize.num_colors
                    .map(|n| n.to_string())
                    .unwrap_or_else(|| "off".to_string())
            }
            SettingId::RemoveBg => {
                if self.config.background.enabled { "on" } else { "off" }.to_string()
            }
            SettingId::BgTolerance => format!("{:.2}", self.config.background.color_tolerance),
            SettingId::FloodFill => {
                if self.config.background.flood_fill { "on" } else { "off" }.to_string()
            }
        }
    }

    pub fn setting_label(id: SettingId) -> &'static str {
        match id {
            SettingId::GridSize => "Grid Size",
            SettingId::DownscaleMode => "Downscale Mode",
            SettingId::AaThreshold => "AA Threshold",
            SettingId::PaletteName => "Palette",
            SettingId::AutoColors => "Auto Colors",
            SettingId::RemoveBg => "Remove BG",
            SettingId::BgTolerance => "BG Tolerance",
            SettingId::FloodFill => "Flood Fill",
        }
    }

    pub fn setting_description(id: SettingId) -> &'static str {
        match id {
            SettingId::GridSize => "Pixel grid cell size (auto-detect or override)",
            SettingId::DownscaleMode => "How to resolve each grid cell to one color",
            SettingId::AaThreshold => "AA removal sensitivity (lower = more aggressive)",
            SettingId::PaletteName => "Snap colors to a predefined palette",
            SettingId::AutoColors => "Auto-extract N colors via k-means clustering",
            SettingId::RemoveBg => "Make the background color transparent",
            SettingId::BgTolerance => "How similar a color must be to count as background",
            SettingId::FloodFill => "Only remove connected background (vs all matching)",
        }
    }

    pub fn is_setting_changed(&self, id: SettingId) -> bool {
        match id {
            SettingId::GridSize => self.config.grid.override_size != self.initial_config.grid.override_size,
            SettingId::DownscaleMode => self.config.downscale_mode != self.initial_config.downscale_mode,
            SettingId::AaThreshold => {
                self.config.aa.skip != self.initial_config.aa.skip
                    || (self.config.aa.threshold - self.initial_config.aa.threshold).abs() > 0.001
            }
            SettingId::PaletteName => self.config.quantize.palette_name != self.initial_config.quantize.palette_name,
            SettingId::AutoColors => self.config.quantize.num_colors != self.initial_config.quantize.num_colors,
            SettingId::RemoveBg => self.config.background.enabled != self.initial_config.background.enabled,
            SettingId::BgTolerance => {
                (self.config.background.color_tolerance - self.initial_config.background.color_tolerance).abs() > 0.001
            }
            SettingId::FloodFill => self.config.background.flood_fill != self.initial_config.background.flood_fill,
        }
    }
}
