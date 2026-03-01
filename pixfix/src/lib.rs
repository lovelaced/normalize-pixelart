use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Mutex;

use image::RgbaImage;
use serde::{Deserialize, Serialize};
use tauri::State;

use normalize_pixelart::color::palettes::ALL_PALETTES;
use normalize_pixelart::image_util::histogram::ColorHistogram;
use normalize_pixelart::image_util::io;
use normalize_pixelart::pipeline::{
    DownscaleMode, PipelineConfig, PipelineDiagnostics, run_pipeline,
};

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

struct AppState {
    original: Option<RgbaImage>,
    processed: Option<RgbaImage>,
    config: PipelineConfig,
    diagnostics: Option<PipelineDiagnostics>,
    unique_colors: usize,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            original: None,
            processed: None,
            config: PipelineConfig::default(),
            diagnostics: None,
            unique_colors: 0,
        }
    }
}

// ---------------------------------------------------------------------------
// Serializable types for JS communication
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageInfo {
    width: u32,
    height: u32,
    grid_size: Option<u32>,
    grid_confidence: Option<f32>,
    unique_colors: usize,
    grid_scores: Vec<(u32, f32)>,
    histogram: Vec<ColorEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProcessConfig {
    grid_size: Option<u32>,
    downscale_mode: String,
    aa_threshold: Option<f32>,
    palette_name: Option<String>,
    auto_colors: Option<u32>,
    remove_bg: bool,
    bg_tolerance: f32,
    flood_fill: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessResult {
    width: u32,
    height: u32,
    grid_size: Option<u32>,
    grid_confidence: Option<f32>,
    unique_colors: usize,
    grid_scores: Vec<(u32, f32)>,
    histogram: Vec<ColorEntry>,
}

#[derive(Serialize, Clone)]
struct ColorEntry {
    hex: String,
    r: u8,
    g: u8,
    b: u8,
    percent: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PaletteInfo {
    name: String,
    slug: String,
    num_colors: usize,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn build_histogram_entries(img: &RgbaImage, top_n: usize) -> (Vec<ColorEntry>, usize) {
    let hist = ColorHistogram::from_image(img);
    let total = hist.total_pixels() as f64;
    let unique = hist.unique_colors();
    let entries = hist
        .top_n(top_n)
        .into_iter()
        .map(|(rgba, count)| {
            let [r, g, b, _] = rgba.0;
            ColorEntry {
                hex: format!("#{:02X}{:02X}{:02X}", r, g, b),
                r,
                g,
                b,
                percent: (count as f64 / total) * 100.0,
            }
        })
        .collect();
    (entries, unique)
}

fn parse_downscale_mode(s: &str) -> DownscaleMode {
    match s {
        "center-weighted" => DownscaleMode::CenterWeighted,
        "majority-vote" => DownscaleMode::MajorityVote,
        "center-pixel" => DownscaleMode::CenterPixel,
        _ => DownscaleMode::Snap,
    }
}

fn build_config(pc: &ProcessConfig) -> PipelineConfig {
    let mut config = PipelineConfig::default();

    if let Some(gs) = pc.grid_size {
        config.grid.override_size = Some(gs);
    }

    config.downscale_mode = parse_downscale_mode(&pc.downscale_mode);

    if let Some(thresh) = pc.aa_threshold {
        config.aa.skip = false;
        config.aa.threshold = thresh;
    } else {
        config.aa.skip = true;
    }

    if let Some(ref name) = pc.palette_name {
        config.quantize.palette_name = Some(name.clone());
        config.quantize.skip = false;
    } else if let Some(n) = pc.auto_colors {
        config.quantize.num_colors = Some(n);
        config.quantize.skip = false;
    } else {
        config.quantize.skip = true;
    }
    // Ensure defaults for k-means
    config.quantize = config.quantize.with_defaults();

    config.background.enabled = pc.remove_bg;
    config.background.color_tolerance = pc.bg_tolerance;
    config.background.flood_fill = pc.flood_fill;

    config
}

fn encode_png(img: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut buf = Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(buf.into_inner())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn open_image(path: String, state: State<'_, Mutex<AppState>>) -> Result<ImageInfo, String> {
    let img = io::load_image(std::path::Path::new(&path)).map_err(|e| e.to_string())?;

    // Run pipeline with default config
    let pipeline_state = run_pipeline(img.clone(), &PipelineConfig::default())
        .map_err(|e| e.to_string())?;

    let processed = pipeline_state.image;
    let (histogram, unique_colors) = build_histogram_entries(&processed, 20);

    let info = ImageInfo {
        width: img.width(),
        height: img.height(),
        grid_size: pipeline_state.grid_size,
        grid_confidence: pipeline_state.diagnostics.grid_confidence,
        unique_colors,
        grid_scores: pipeline_state.diagnostics.grid_variance_scores.clone(),
        histogram,
    };

    let mut st = state.lock().unwrap();
    st.original = Some(img);
    st.processed = Some(processed);
    st.config = PipelineConfig::default();
    st.diagnostics = Some(pipeline_state.diagnostics);
    st.unique_colors = unique_colors;

    Ok(info)
}

#[tauri::command]
fn process(pc: ProcessConfig, state: State<'_, Mutex<AppState>>) -> Result<ProcessResult, String> {
    let st = state.lock().unwrap();
    let original = st.original.as_ref().ok_or("No image loaded")?.clone();
    drop(st);

    let config = build_config(&pc);
    let pipeline_state = run_pipeline(original, &config).map_err(|e| e.to_string())?;

    let processed = pipeline_state.image;
    let (histogram, unique_colors) = build_histogram_entries(&processed, 20);

    let result = ProcessResult {
        width: processed.width(),
        height: processed.height(),
        grid_size: pipeline_state.grid_size,
        grid_confidence: pipeline_state.diagnostics.grid_confidence,
        unique_colors,
        grid_scores: pipeline_state.diagnostics.grid_variance_scores.clone(),
        histogram,
    };

    let mut st = state.lock().unwrap();
    st.processed = Some(processed);
    st.config = config;
    st.diagnostics = Some(pipeline_state.diagnostics);
    st.unique_colors = unique_colors;

    Ok(result)
}

#[tauri::command]
fn get_image(which: String, state: State<'_, Mutex<AppState>>) -> Result<Vec<u8>, String> {
    let st = state.lock().unwrap();
    let img = match which.as_str() {
        "original" => st.original.as_ref().ok_or("No image loaded")?,
        "processed" => st.processed.as_ref().ok_or("No processed image")?,
        _ => return Err(format!("Unknown image type: {}", which)),
    };
    encode_png(img)
}

#[tauri::command]
fn save_image(path: String, state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let st = state.lock().unwrap();
    let img = st.processed.as_ref().ok_or("No processed image to save")?;
    io::save_image(img, &PathBuf::from(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_palettes() -> Vec<PaletteInfo> {
    ALL_PALETTES
        .iter()
        .map(|p| PaletteInfo {
            name: p.name.to_string(),
            slug: p.slug.to_string(),
            num_colors: p.colors.len(),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(AppState::default()))
        .invoke_handler(tauri::generate_handler![
            open_image,
            process,
            get_image,
            save_image,
            list_palettes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
