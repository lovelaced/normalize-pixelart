use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Mutex;

use image::RgbaImage;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};

use normalize_pixelart::color::lospec;
use normalize_pixelart::color::palettes::ALL_PALETTES;
use normalize_pixelart::config::parse_hex_color;
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
    sheet_tiles: Option<Vec<(u32, u32, RgbaImage)>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            original: None,
            processed: None,
            config: PipelineConfig::default(),
            diagnostics: None,
            unique_colors: 0,
            sheet_tiles: None,
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
    grid_phase_x: Option<u32>,
    grid_phase_y: Option<u32>,
    max_grid_candidate: Option<u32>,
    no_grid_detect: bool,
    downscale_mode: String,
    aa_threshold: Option<f32>,
    palette_name: Option<String>,
    auto_colors: Option<u32>,
    custom_palette: Option<Vec<String>>,
    remove_bg: bool,
    bg_color: Option<String>,
    border_threshold: Option<f32>,
    no_quantize: bool,
    bg_tolerance: f32,
    flood_fill: bool,
    output_scale: Option<u32>,
    output_width: Option<u32>,
    output_height: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LospecResult {
    name: String,
    slug: String,
    num_colors: usize,
    colors: Vec<String>,
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

fn build_config(pc: &ProcessConfig, original_width: u32, original_height: u32) -> PipelineConfig {
    let mut config = PipelineConfig::default();

    // Grid detection
    if pc.no_grid_detect {
        config.grid.skip = true;
    }
    if let Some(gs) = pc.grid_size {
        config.grid.override_size = Some(gs);
    }
    if let (Some(px), Some(py)) = (pc.grid_phase_x, pc.grid_phase_y) {
        config.grid.override_phase = Some((px, py));
    }
    if let Some(mc) = pc.max_grid_candidate {
        config.grid.max_candidate = mc;
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
    } else if let Some(ref hex_colors) = pc.custom_palette {
        let mut rgb_colors = Vec::with_capacity(hex_colors.len());
        for hex in hex_colors {
            if let Ok(rgb) = parse_hex_color(hex) {
                rgb_colors.push(rgb);
            }
        }
        if !rgb_colors.is_empty() {
            config.quantize.custom_palette = Some(rgb_colors);
            config.quantize.skip = false;
        }
    } else if let Some(n) = pc.auto_colors {
        config.quantize.num_colors = Some(n);
        config.quantize.skip = false;
    } else {
        config.quantize.skip = true;
    }
    if pc.no_quantize {
        config.quantize.skip = true;
    }
    // Ensure defaults for k-means
    config.quantize = config.quantize.with_defaults();

    config.background.enabled = pc.remove_bg;
    config.background.color_tolerance = pc.bg_tolerance;
    config.background.flood_fill = pc.flood_fill;
    if let Some(ref hex) = pc.bg_color {
        if let Ok(rgb) = parse_hex_color(hex) {
            config.background.bg_color = Some(rgb);
        }
    }
    if let Some(bt) = pc.border_threshold {
        config.background.border_threshold = bt;
    }

    // Output resize: explicit dimensions take priority over scale
    if pc.output_width.is_some() || pc.output_height.is_some() {
        config.output_width = pc.output_width;
        config.output_height = pc.output_height;
    } else if let Some(scale) = pc.output_scale {
        if scale > 1 {
            config.output_width = Some(original_width * scale);
            config.output_height = Some(original_height * scale);
        }
    }

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

    let config = build_config(&pc, original.width(), original.height());
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

#[tauri::command]
fn fetch_lospec(slug: String) -> Result<LospecResult, String> {
    let palette = lospec::fetch_lospec_palette(&slug)?;
    Ok(LospecResult {
        name: palette.name,
        slug: palette.slug,
        num_colors: palette.colors.len(),
        colors: palette
            .colors
            .iter()
            .map(|[r, g, b]| format!("#{:02X}{:02X}{:02X}", r, g, b))
            .collect(),
    })
}

#[tauri::command]
fn get_palette_colors(slug: String) -> Result<Vec<String>, String> {
    let pal = ALL_PALETTES
        .iter()
        .find(|p| p.slug == slug)
        .ok_or_else(|| format!("Unknown palette: {}", slug))?;
    Ok(pal
        .colors
        .iter()
        .map(|[r, g, b]| format!("#{:02X}{:02X}{:02X}", r, g, b))
        .collect())
}

#[tauri::command]
fn load_palette_file(path: String) -> Result<Vec<String>, String> {
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read palette file: {}", e))?;
    let mut colors = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') && line.len() < 2 {
            continue;
        }
        if let Ok(rgb) = parse_hex_color(line) {
            colors.push(format!("#{:02X}{:02X}{:02X}", rgb[0], rgb[1], rgb[2]));
        }
    }
    if colors.is_empty() {
        return Err("No valid hex colors found in file".to_string());
    }
    Ok(colors)
}

// ---------------------------------------------------------------------------
// Batch processing
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BatchProgress {
    current: u32,
    total: u32,
    filename: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchSummary {
    succeeded: u32,
    failed: Vec<BatchFailure>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchFailure {
    path: String,
    error: String,
}

#[tauri::command]
async fn batch_process(
    input_paths: Vec<String>,
    output_dir: String,
    pc: ProcessConfig,
    overwrite: bool,
    app: tauri::AppHandle,
) -> Result<BatchSummary, String> {
    let out_dir = PathBuf::from(&output_dir);
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Failed to create output directory: {}", e))?;

    let total = input_paths.len() as u32;
    let mut succeeded = 0u32;
    let mut failed = Vec::new();

    for (i, input_path) in input_paths.iter().enumerate() {
        let path = PathBuf::from(input_path);
        let filename = path.file_name().unwrap_or_default().to_string_lossy().to_string();

        let _ = app.emit("batch-progress", BatchProgress {
            current: i as u32 + 1,
            total,
            filename: filename.clone(),
        });

        let stem = path.file_stem().unwrap_or_default().to_string_lossy();
        let ext = path.extension().unwrap_or_default().to_string_lossy();
        let ext = if ext.is_empty() { "png".to_string() } else { ext.to_string() };
        let out_path = out_dir.join(format!("{}_normalized.{}", stem, ext));

        if out_path.exists() && !overwrite {
            failed.push(BatchFailure {
                path: input_path.clone(),
                error: "Output already exists".to_string(),
            });
            continue;
        }

        match (|| -> Result<(), String> {
            let image = io::load_image(&path).map_err(|e| format!("Load failed: {}", e))?;
            let config = build_config(&pc, image.width(), image.height());
            let state = run_pipeline(image, &config).map_err(|e| format!("Pipeline failed: {}", e))?;
            io::save_image(&state.image, &out_path).map_err(|e| format!("Save failed: {}", e))?;
            Ok(())
        })() {
            Ok(()) => succeeded += 1,
            Err(e) => failed.push(BatchFailure {
                path: input_path.clone(),
                error: e,
            }),
        }
    }

    Ok(BatchSummary { succeeded, failed })
}

// ---------------------------------------------------------------------------
// Sprite sheet processing
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SheetPreviewResult {
    tile_count: u32,
    tile_width: u32,
    tile_height: u32,
    cols: u32,
    rows: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SheetProcessResult {
    tile_count: u32,
    tile_width: u32,
    tile_height: u32,
    cols: u32,
    rows: u32,
    output_width: u32,
    output_height: u32,
}

#[tauri::command]
fn sheet_preview(
    mode: String,
    tile_width: Option<u32>,
    tile_height: Option<u32>,
    spacing: Option<u32>,
    margin: Option<u32>,
    separator_threshold: Option<f32>,
    min_sprite_size: Option<u32>,
    pad: Option<u32>,
    state: State<'_, Mutex<AppState>>,
) -> Result<SheetPreviewResult, String> {
    let st = state.lock().unwrap();
    let original = st.original.as_ref().ok_or("No image loaded")?.clone();
    drop(st);

    use normalize_pixelart::spritesheet;

    match mode.as_str() {
        "fixed" => {
            let tw = tile_width.ok_or("tile_width required for fixed mode")?;
            let th = tile_height.ok_or("tile_height required for fixed mode")?;
            let sp = spacing.unwrap_or(0);
            let mg = margin.unwrap_or(0);
            let tiles = spritesheet::split_sheet(&original, tw, th, sp, mg);
            let cols = if tiles.is_empty() { 0 } else { tiles.iter().map(|t| t.col).max().unwrap() + 1 };
            let rows = if tiles.is_empty() { 0 } else { tiles.iter().map(|t| t.row).max().unwrap() + 1 };
            Ok(SheetPreviewResult {
                tile_count: tiles.len() as u32,
                tile_width: tw,
                tile_height: th,
                cols,
                rows,
            })
        }
        "auto" => {
            let auto_config = spritesheet::AutoSplitConfig {
                bg_color: None,
                tolerance: 0.05,
                separator_threshold: separator_threshold.unwrap_or(0.90),
                min_sprite_size: min_sprite_size.unwrap_or(8),
                pad: pad.unwrap_or(0),
            };
            let (tiles, tw, th) = spritesheet::auto_split_sheet(&original, &auto_config)
                .map_err(|e| e.to_string())?;
            let cols = if tiles.is_empty() { 0 } else { tiles.iter().map(|t| t.col).max().unwrap() + 1 };
            let rows = if tiles.is_empty() { 0 } else { tiles.iter().map(|t| t.row).max().unwrap() + 1 };
            Ok(SheetPreviewResult {
                tile_count: tiles.len() as u32,
                tile_width: tw,
                tile_height: th,
                cols,
                rows,
            })
        }
        _ => Err(format!("Unknown sheet mode: {}", mode)),
    }
}

#[tauri::command]
fn sheet_process(
    mode: String,
    tile_width: Option<u32>,
    tile_height: Option<u32>,
    spacing: Option<u32>,
    margin: Option<u32>,
    separator_threshold: Option<f32>,
    min_sprite_size: Option<u32>,
    pad: Option<u32>,
    no_normalize: Option<bool>,
    pc: ProcessConfig,
    state: State<'_, Mutex<AppState>>,
) -> Result<SheetProcessResult, String> {
    let st = state.lock().unwrap();
    let original = st.original.as_ref().ok_or("No image loaded")?.clone();
    drop(st);

    use normalize_pixelart::spritesheet;

    let skip_pipeline = no_normalize.unwrap_or(false);
    let config = build_config(&pc, original.width(), original.height());

    match mode.as_str() {
        "fixed" => {
            let tw = tile_width.ok_or("tile_width required for fixed mode")?;
            let th = tile_height.ok_or("tile_height required for fixed mode")?;
            let sp = spacing.unwrap_or(0);
            let mg = margin.unwrap_or(0);
            let result = if skip_pipeline {
                // Just split and reassemble without normalizing
                let tiles = spritesheet::split_sheet(&original, tw, th, sp, mg);
                spritesheet::assemble_sheet(&tiles, tw, th, sp, mg)
            } else {
                spritesheet::process_sheet(&original, tw, th, sp, mg, &config)
                    .map_err(|e| e.to_string())?
            };
            let out_w = result.width();
            let out_h = result.height();

            // Split again to get tiles for saving
            let processed_tiles = spritesheet::split_sheet(&result, tw, th, sp, mg);
            let cols = if processed_tiles.is_empty() { 0 } else { processed_tiles.iter().map(|t| t.col).max().unwrap() + 1 };
            let rows = if processed_tiles.is_empty() { 0 } else { processed_tiles.iter().map(|t| t.row).max().unwrap() + 1 };
            let tile_count = processed_tiles.len() as u32;

            let sheet_tiles: Vec<(u32, u32, RgbaImage)> = processed_tiles
                .into_iter()
                .map(|t| (t.col, t.row, t.image))
                .collect();

            let mut st = state.lock().unwrap();
            st.processed = Some(result);
            st.sheet_tiles = Some(sheet_tiles);

            Ok(SheetProcessResult { tile_count, tile_width: tw, tile_height: th, cols, rows, output_width: out_w, output_height: out_h })
        }
        "auto" => {
            let auto_config = spritesheet::AutoSplitConfig {
                bg_color: None,
                tolerance: 0.05,
                separator_threshold: separator_threshold.unwrap_or(0.90),
                min_sprite_size: min_sprite_size.unwrap_or(8),
                pad: pad.unwrap_or(0),
            };
            let pipeline_ref = if skip_pipeline { None } else { Some(&config) };
            let (result, tiles, tw, th) = spritesheet::process_sheet_auto(&original, &auto_config, pipeline_ref)
                .map_err(|e| e.to_string())?;
            let out_w = result.width();
            let out_h = result.height();
            let cols = if tiles.is_empty() { 0 } else { tiles.iter().map(|t| t.col).max().unwrap() + 1 };
            let rows = if tiles.is_empty() { 0 } else { tiles.iter().map(|t| t.row).max().unwrap() + 1 };
            let tile_count = tiles.len() as u32;

            let sheet_tiles: Vec<(u32, u32, RgbaImage)> = tiles
                .into_iter()
                .map(|t| (t.col, t.row, t.image))
                .collect();

            let mut st = state.lock().unwrap();
            st.processed = Some(result);
            st.sheet_tiles = Some(sheet_tiles);

            Ok(SheetProcessResult { tile_count, tile_width: tw, tile_height: th, cols, rows, output_width: out_w, output_height: out_h })
        }
        _ => Err(format!("Unknown sheet mode: {}", mode)),
    }
}

#[tauri::command]
fn sheet_save_tiles(output_dir: String, state: State<'_, Mutex<AppState>>) -> Result<u32, String> {
    let st = state.lock().unwrap();
    let tiles = st.sheet_tiles.as_ref().ok_or("No sheet tiles available")?;

    let out_dir = PathBuf::from(&output_dir);
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Failed to create output directory: {}", e))?;

    let mut count = 0u32;
    for (col, row, img) in tiles {
        let path = out_dir.join(format!("tile_{}_{}.png", row, col));
        io::save_image(img, &path).map_err(|e| format!("Failed to save tile: {}", e))?;
        count += 1;
    }
    Ok(count)
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
            fetch_lospec,
            get_palette_colors,
            load_palette_file,
            batch_process,
            sheet_preview,
            sheet_process,
            sheet_save_tiles,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
