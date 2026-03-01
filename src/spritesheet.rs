//! Sprite sheet processing: split, normalize, and reassemble.

use anyhow::Result;
use image::{GenericImageView, Rgba, RgbaImage};
use rayon::prelude::*;
use tracing::info;

use crate::color::oklab::{oklab_distance, rgba_to_oklab};
use crate::pipeline::{detect_border_color, run_pipeline, PipelineConfig};

/// A tile extracted from a sprite sheet.
pub struct Tile {
    /// Column index in the grid.
    pub col: u32,
    /// Row index in the grid.
    pub row: u32,
    /// The tile image.
    pub image: RgbaImage,
}

/// Split a sprite sheet into individual tiles on a regular grid.
///
/// - `tile_w`, `tile_h`: dimensions of each tile
/// - `spacing`: gap between tiles (in pixels)
/// - `margin`: border around the entire sheet (in pixels)
pub fn split_sheet(
    image: &RgbaImage,
    tile_w: u32,
    tile_h: u32,
    spacing: u32,
    margin: u32,
) -> Vec<Tile> {
    let (img_w, img_h) = image.dimensions();
    let mut tiles = Vec::new();

    let mut y = margin;
    let mut row = 0;
    while y + tile_h <= img_h {
        let mut x = margin;
        let mut col = 0;
        while x + tile_w <= img_w {
            let tile_img = image.view(x, y, tile_w, tile_h).to_image();
            tiles.push(Tile {
                col,
                row,
                image: tile_img,
            });
            x += tile_w + spacing;
            col += 1;
        }
        y += tile_h + spacing;
        row += 1;
    }

    info!(
        tiles = tiles.len(),
        cols = if tiles.is_empty() { 0 } else { tiles.last().unwrap().col + 1 },
        rows = row,
        tile_w,
        tile_h,
        "Split sprite sheet into tiles"
    );

    tiles
}

/// Reassemble tiles into a sprite sheet.
///
/// Tiles are placed on a regular grid based on their (col, row) indices.
/// The output background is fully transparent.
pub fn assemble_sheet(
    tiles: &[Tile],
    tile_w: u32,
    tile_h: u32,
    spacing: u32,
    margin: u32,
) -> RgbaImage {
    if tiles.is_empty() {
        return RgbaImage::new(0, 0);
    }

    let max_col = tiles.iter().map(|t| t.col).max().unwrap_or(0);
    let max_row = tiles.iter().map(|t| t.row).max().unwrap_or(0);

    let cols = max_col + 1;
    let rows = max_row + 1;

    let out_w = margin * 2 + cols * tile_w + (cols.saturating_sub(1)) * spacing;
    let out_h = margin * 2 + rows * tile_h + (rows.saturating_sub(1)) * spacing;

    let mut output = RgbaImage::from_pixel(out_w, out_h, Rgba([0, 0, 0, 0]));

    for tile in tiles {
        let x = margin + tile.col * (tile_w + spacing);
        let y = margin + tile.row * (tile_h + spacing);

        // Copy tile pixels into the output
        for ty in 0..tile.image.height().min(tile_h) {
            for tx in 0..tile.image.width().min(tile_w) {
                let px = x + tx;
                let py = y + ty;
                if px < out_w && py < out_h {
                    output.put_pixel(px, py, *tile.image.get_pixel(tx, ty));
                }
            }
        }
    }

    info!(
        width = out_w,
        height = out_h,
        cols,
        rows,
        "Assembled sprite sheet"
    );

    output
}

/// Split a sprite sheet → normalize each tile → reassemble.
///
/// Each tile is processed through the full pipeline in parallel.
pub fn process_sheet(
    image: &RgbaImage,
    tile_w: u32,
    tile_h: u32,
    spacing: u32,
    margin: u32,
    config: &PipelineConfig,
) -> Result<RgbaImage> {
    let tiles = split_sheet(image, tile_w, tile_h, spacing, margin);

    if tiles.is_empty() {
        anyhow::bail!(
            "No tiles found in {}x{} image with tile size {}x{}, spacing {}, margin {}",
            image.width(),
            image.height(),
            tile_w,
            tile_h,
            spacing,
            margin
        );
    }

    eprintln!(
        "Processing {} tiles ({}x{} each)...",
        tiles.len(),
        tile_w,
        tile_h
    );

    // Process each tile through the pipeline in parallel
    let processed: Result<Vec<Tile>> = tiles
        .into_par_iter()
        .map(|tile| {
            let state = run_pipeline(tile.image, config)?;
            Ok(Tile {
                col: tile.col,
                row: tile.row,
                image: state.image,
            })
        })
        .collect();

    let processed = processed?;

    Ok(assemble_sheet(&processed, tile_w, tile_h, spacing, margin))
}

// ---------------------------------------------------------------------------
// Auto-split: detect sprites in AI-generated sheets with uneven spacing
// ---------------------------------------------------------------------------

/// Configuration for auto-split mode.
#[derive(Debug, Clone)]
pub struct AutoSplitConfig {
    /// Explicit background color (RGB). If None, auto-detect.
    pub bg_color: Option<[u8; 3]>,
    /// OKLAB tolerance for background matching.
    pub tolerance: f32,
    /// Fraction of bg pixels to classify a row/col as separator (0.0–1.0).
    pub separator_threshold: f32,
    /// Minimum sprite dimension (filters noise).
    pub min_sprite_size: u32,
    /// Padding around each sprite in output.
    pub pad: u32,
}

impl Default for AutoSplitConfig {
    fn default() -> Self {
        Self {
            bg_color: None,
            tolerance: 0.05,
            separator_threshold: 0.90,
            min_sprite_size: 8,
            pad: 0,
        }
    }
}

/// Detected background for auto-split.
#[derive(Debug, Clone)]
pub enum AutoSplitBg {
    /// Image uses transparency as background.
    Transparent,
    /// Image has a solid background color.
    Color {
        rgba: Rgba<u8>,
        oklab: palette::Oklab,
    },
}

/// A bounding box within an image.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BBox {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// Check if a pixel is background for auto-split purposes.
fn is_autosplit_bg(pixel: Rgba<u8>, bg: &AutoSplitBg, tolerance: f32) -> bool {
    match bg {
        AutoSplitBg::Transparent => pixel[3] < 128,
        AutoSplitBg::Color { oklab: bg_ok, .. } => {
            if pixel[3] < 128 {
                return true;
            }
            let pix_ok = rgba_to_oklab(pixel);
            oklab_distance(pix_ok, *bg_ok) <= tolerance
        }
    }
}

/// Detect whether the sheet uses transparency or a solid background color.
pub fn detect_autosplit_background(
    image: &RgbaImage,
    config: &AutoSplitConfig,
) -> AutoSplitBg {
    // If explicit color, use it
    if let Some(rgb) = config.bg_color {
        let rgba = Rgba([rgb[0], rgb[1], rgb[2], 255]);
        return AutoSplitBg::Color {
            rgba,
            oklab: rgba_to_oklab(rgba),
        };
    }

    // Check if the image has significant transparency
    let total = (image.width() * image.height()) as f32;
    let transparent_count = image.pixels().filter(|p| p[3] < 128).count() as f32;
    if transparent_count / total > 0.05 {
        return AutoSplitBg::Transparent;
    }

    // Try to detect border color
    if let Some(color) = detect_border_color(image, 0.3) {
        return AutoSplitBg::Color {
            rgba: color,
            oklab: rgba_to_oklab(color),
        };
    }

    // Fallback: assume white background
    let white = Rgba([255, 255, 255, 255]);
    AutoSplitBg::Color {
        rgba: white,
        oklab: rgba_to_oklab(white),
    }
}

/// Classify each row as separator (true) or content (false).
pub fn classify_separator_rows(
    image: &RgbaImage,
    bg: &AutoSplitBg,
    tolerance: f32,
    threshold: f32,
) -> Vec<bool> {
    let width = image.width();
    (0..image.height())
        .map(|y| {
            let bg_count = (0..width)
                .filter(|&x| is_autosplit_bg(*image.get_pixel(x, y), bg, tolerance))
                .count();
            (bg_count as f32 / width as f32) >= threshold
        })
        .collect()
}

/// Classify each column as separator (true) or content (false).
pub fn classify_separator_cols(
    image: &RgbaImage,
    bg: &AutoSplitBg,
    tolerance: f32,
    threshold: f32,
) -> Vec<bool> {
    let height = image.height();
    (0..image.width())
        .map(|x| {
            let bg_count = (0..height)
                .filter(|&y| is_autosplit_bg(*image.get_pixel(x, y), bg, tolerance))
                .count();
            (bg_count as f32 / height as f32) >= threshold
        })
        .collect()
}

/// Group consecutive non-separator indices into bands (start, length).
/// Bands smaller than `min_size` are discarded.
pub fn extract_bands(separators: &[bool], min_size: u32) -> Vec<(u32, u32)> {
    let mut bands = Vec::new();
    let mut i = 0u32;
    while (i as usize) < separators.len() {
        if !separators[i as usize] {
            let start = i;
            while (i as usize) < separators.len() && !separators[i as usize] {
                i += 1;
            }
            let len = i - start;
            if len >= min_size {
                bands.push((start, len));
            }
        } else {
            i += 1;
        }
    }
    bands
}

/// Find the tight bounding box of non-background pixels within a region.
/// Returns None if the region is entirely background.
pub fn tight_bbox(
    image: &RgbaImage,
    region: BBox,
    bg: &AutoSplitBg,
    tolerance: f32,
) -> Option<BBox> {
    let mut min_x = region.x + region.w;
    let mut min_y = region.y + region.h;
    let mut max_x = region.x;
    let mut max_y = region.y;
    let mut found = false;

    for y in region.y..region.y + region.h {
        for x in region.x..region.x + region.w {
            if !is_autosplit_bg(*image.get_pixel(x, y), bg, tolerance) {
                found = true;
                if x < min_x {
                    min_x = x;
                }
                if x > max_x {
                    max_x = x;
                }
                if y < min_y {
                    min_y = y;
                }
                if y > max_y {
                    max_y = y;
                }
            }
        }
    }

    if !found {
        return None;
    }

    Some(BBox {
        x: min_x,
        y: min_y,
        w: max_x - min_x + 1,
        h: max_y - min_y + 1,
    })
}

/// Extract cells from row/col band intersections, trim each to tight bbox.
/// Returns (tiles, uniform_tile_w, uniform_tile_h) with padding applied.
fn extract_cells(
    image: &RgbaImage,
    row_bands: &[(u32, u32)],
    col_bands: &[(u32, u32)],
    bg: &AutoSplitBg,
    tolerance: f32,
    min_size: u32,
    pad: u32,
) -> (Vec<Tile>, u32, u32) {
    let mut bboxes: Vec<(u32, u32, BBox)> = Vec::new();

    for (ri, &(ry, rh)) in row_bands.iter().enumerate() {
        for (ci, &(cx, cw)) in col_bands.iter().enumerate() {
            let region = BBox {
                x: cx,
                y: ry,
                w: cw,
                h: rh,
            };
            if let Some(bbox) = tight_bbox(image, region, bg, tolerance) {
                if bbox.w >= min_size && bbox.h >= min_size {
                    bboxes.push((ci as u32, ri as u32, bbox));
                }
            }
        }
    }

    if bboxes.is_empty() {
        return (Vec::new(), 0, 0);
    }

    // Find max sprite dimensions for uniform sizing
    let max_w = bboxes.iter().map(|(_, _, b)| b.w).max().unwrap();
    let max_h = bboxes.iter().map(|(_, _, b)| b.h).max().unwrap();
    let tile_w = max_w + pad * 2;
    let tile_h = max_h + pad * 2;

    let tiles: Vec<Tile> = bboxes
        .into_iter()
        .map(|(col, row, bbox)| {
            // Create a transparent tile of uniform size
            let mut tile_img = RgbaImage::from_pixel(tile_w, tile_h, Rgba([0, 0, 0, 0]));

            // Center the sprite within the tile
            let offset_x = pad + (max_w - bbox.w) / 2;
            let offset_y = pad + (max_h - bbox.h) / 2;

            for sy in 0..bbox.h {
                for sx in 0..bbox.w {
                    let pixel = *image.get_pixel(bbox.x + sx, bbox.y + sy);
                    if !is_autosplit_bg(pixel, bg, tolerance) {
                        tile_img.put_pixel(offset_x + sx, offset_y + sy, pixel);
                    }
                }
            }

            Tile {
                col,
                row,
                image: tile_img,
            }
        })
        .collect();

    (tiles, tile_w, tile_h)
}

/// Auto-detect sprites in a messy AI-generated sheet and extract them.
///
/// Returns (tiles, tile_w, tile_h) where all tiles are uniformly sized.
pub fn auto_split_sheet(
    image: &RgbaImage,
    config: &AutoSplitConfig,
) -> Result<(Vec<Tile>, u32, u32)> {
    let bg = detect_autosplit_background(image, config);
    info!(?bg, "Auto-split background detection");

    let sep_rows = classify_separator_rows(image, &bg, config.tolerance, config.separator_threshold);
    let sep_cols = classify_separator_cols(image, &bg, config.tolerance, config.separator_threshold);

    let row_bands = extract_bands(&sep_rows, config.min_sprite_size);
    let col_bands = extract_bands(&sep_cols, config.min_sprite_size);

    info!(
        row_bands = row_bands.len(),
        col_bands = col_bands.len(),
        "Detected sprite grid"
    );

    if row_bands.is_empty() || col_bands.is_empty() {
        anyhow::bail!(
            "No sprite regions detected in {}x{} image (found {} row bands, {} col bands). \
             Try adjusting --separator-threshold or --min-sprite-size.",
            image.width(),
            image.height(),
            row_bands.len(),
            col_bands.len(),
        );
    }

    let (tiles, tile_w, tile_h) = extract_cells(
        image,
        &row_bands,
        &col_bands,
        &bg,
        config.tolerance,
        config.min_sprite_size,
        config.pad,
    );

    if tiles.is_empty() {
        anyhow::bail!(
            "All detected cells were empty or below minimum size ({}px). \
             Try reducing --min-sprite-size.",
            config.min_sprite_size
        );
    }

    info!(
        sprites = tiles.len(),
        tile_w,
        tile_h,
        "Auto-split complete"
    );

    Ok((tiles, tile_w, tile_h))
}

/// Auto-split a sheet, optionally normalize each tile, and reassemble.
pub fn process_sheet_auto(
    image: &RgbaImage,
    auto_config: &AutoSplitConfig,
    pipeline_config: Option<&PipelineConfig>,
) -> Result<(RgbaImage, Vec<Tile>, u32, u32)> {
    let (tiles, tile_w, tile_h) = auto_split_sheet(image, auto_config)?;

    eprintln!(
        "Auto-detected {} sprites (uniform tile size: {}x{})",
        tiles.len(),
        tile_w,
        tile_h
    );

    let processed = if let Some(config) = pipeline_config {
        let result: Result<Vec<Tile>> = tiles
            .into_par_iter()
            .map(|tile| {
                let state = run_pipeline(tile.image, config)?;
                Ok(Tile {
                    col: tile.col,
                    row: tile.row,
                    image: state.image,
                })
            })
            .collect();
        result?
    } else {
        tiles
    };

    let sheet = assemble_sheet(&processed, tile_w, tile_h, 0, 0);
    Ok((sheet, processed, tile_w, tile_h))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn make_test_sheet() -> RgbaImage {
        // 2x2 grid of 4x4 tiles, no spacing, no margin = 8x8 image
        let red = Rgba([255, 0, 0, 255]);
        let green = Rgba([0, 255, 0, 255]);
        let blue = Rgba([0, 0, 255, 255]);
        let yellow = Rgba([255, 255, 0, 255]);

        let mut img = RgbaImage::new(8, 8);
        for y in 0..4 {
            for x in 0..4 {
                img.put_pixel(x, y, red);
            }
            for x in 4..8 {
                img.put_pixel(x, y, green);
            }
        }
        for y in 4..8 {
            for x in 0..4 {
                img.put_pixel(x, y, blue);
            }
            for x in 4..8 {
                img.put_pixel(x, y, yellow);
            }
        }
        img
    }

    #[test]
    fn test_split_sheet_basic() {
        let sheet = make_test_sheet();
        let tiles = split_sheet(&sheet, 4, 4, 0, 0);
        assert_eq!(tiles.len(), 4);
        assert_eq!(tiles[0].col, 0);
        assert_eq!(tiles[0].row, 0);
        assert_eq!(tiles[1].col, 1);
        assert_eq!(tiles[1].row, 0);
        assert_eq!(tiles[2].col, 0);
        assert_eq!(tiles[2].row, 1);
        assert_eq!(tiles[3].col, 1);
        assert_eq!(tiles[3].row, 1);

        // Check tile colors
        assert_eq!(*tiles[0].image.get_pixel(0, 0), Rgba([255, 0, 0, 255]));
        assert_eq!(*tiles[1].image.get_pixel(0, 0), Rgba([0, 255, 0, 255]));
        assert_eq!(*tiles[2].image.get_pixel(0, 0), Rgba([0, 0, 255, 255]));
        assert_eq!(*tiles[3].image.get_pixel(0, 0), Rgba([255, 255, 0, 255]));
    }

    #[test]
    fn test_split_and_reassemble_roundtrip() {
        let sheet = make_test_sheet();
        let tiles = split_sheet(&sheet, 4, 4, 0, 0);
        let reassembled = assemble_sheet(&tiles, 4, 4, 0, 0);

        assert_eq!(reassembled.dimensions(), sheet.dimensions());
        for y in 0..8 {
            for x in 0..8 {
                assert_eq!(
                    reassembled.get_pixel(x, y),
                    sheet.get_pixel(x, y),
                    "Pixel mismatch at ({}, {})",
                    x,
                    y
                );
            }
        }
    }

    #[test]
    fn test_split_with_spacing() {
        // 2x2 grid of 4x4 tiles with 2px spacing = 10x10 image
        let mut img = RgbaImage::from_pixel(10, 10, Rgba([128, 128, 128, 255]));
        let red = Rgba([255, 0, 0, 255]);
        for y in 0..4 {
            for x in 0..4 {
                img.put_pixel(x, y, red);
            }
        }

        let tiles = split_sheet(&img, 4, 4, 2, 0);
        assert_eq!(tiles.len(), 4);
        assert_eq!(*tiles[0].image.get_pixel(0, 0), red);
    }

    #[test]
    fn test_split_with_margin() {
        // 1 tile of 4x4 with 2px margin = 8x8 image
        let mut img = RgbaImage::from_pixel(8, 8, Rgba([0, 0, 0, 255]));
        let red = Rgba([255, 0, 0, 255]);
        for y in 2..6 {
            for x in 2..6 {
                img.put_pixel(x, y, red);
            }
        }

        let tiles = split_sheet(&img, 4, 4, 0, 2);
        assert_eq!(tiles.len(), 1);
        assert_eq!(*tiles[0].image.get_pixel(0, 0), red);
    }

    // --- Auto-split tests ---

    #[test]
    fn test_classify_separator_rows() {
        let white = Rgba([255, 255, 255, 255]);
        let red = Rgba([255, 0, 0, 255]);
        // 10x6 image: rows 0,1 = red, row 2 = white, rows 3,4 = red, row 5 = white
        let mut img = RgbaImage::from_pixel(10, 6, white);
        for x in 0..10 {
            for y in 0..2 {
                img.put_pixel(x, y, red);
            }
            for y in 3..5 {
                img.put_pixel(x, y, red);
            }
        }

        let bg = AutoSplitBg::Color {
            rgba: white,
            oklab: crate::color::oklab::rgba_to_oklab(white),
        };
        let seps = classify_separator_rows(&img, &bg, 0.05, 0.90);
        assert_eq!(seps, vec![false, false, true, false, false, true]);
    }

    #[test]
    fn test_extract_bands() {
        let seps = vec![true, false, false, false, true, false, true, false, false];
        let bands = extract_bands(&seps, 2);
        // Band at [1..4) length 3, band at [5..6) length 1 (too small), band at [7..9) length 2
        assert_eq!(bands, vec![(1, 3), (7, 2)]);
    }

    #[test]
    fn test_extract_bands_filters_small() {
        let seps = vec![true, false, true, false, false, false, true];
        let bands = extract_bands(&seps, 2);
        // Band at [1..2) length 1 (filtered), band at [3..6) length 3
        assert_eq!(bands, vec![(3, 3)]);
    }

    #[test]
    fn test_tight_bbox() {
        let white = Rgba([255, 255, 255, 255]);
        let red = Rgba([255, 0, 0, 255]);
        // 10x10 white image with a 3x2 red block at (3,4)
        let mut img = RgbaImage::from_pixel(10, 10, white);
        for y in 4..6 {
            for x in 3..6 {
                img.put_pixel(x, y, red);
            }
        }

        let bg = AutoSplitBg::Color {
            rgba: white,
            oklab: crate::color::oklab::rgba_to_oklab(white),
        };
        let region = BBox {
            x: 0,
            y: 0,
            w: 10,
            h: 10,
        };
        let bbox = tight_bbox(&img, region, &bg, 0.05).unwrap();
        assert_eq!(bbox, BBox { x: 3, y: 4, w: 3, h: 2 });
    }

    #[test]
    fn test_tight_bbox_empty_region() {
        let white = Rgba([255, 255, 255, 255]);
        let img = RgbaImage::from_pixel(10, 10, white);

        let bg = AutoSplitBg::Color {
            rgba: white,
            oklab: crate::color::oklab::rgba_to_oklab(white),
        };
        let region = BBox {
            x: 0,
            y: 0,
            w: 10,
            h: 10,
        };
        assert!(tight_bbox(&img, region, &bg, 0.05).is_none());
    }

    #[test]
    fn test_auto_split_2x2() {
        // Build a 2x2 grid of colored 4x4 sprites with 2px white separators:
        // Layout (10x10):
        //   cols: [0..4] sprite, [4..6] sep, [6..10] sprite
        //   rows: [0..4] sprite, [4..6] sep, [6..10] sprite
        let white = Rgba([255, 255, 255, 255]);
        let red = Rgba([255, 0, 0, 255]);
        let green = Rgba([0, 255, 0, 255]);
        let blue = Rgba([0, 0, 255, 255]);
        let yellow = Rgba([255, 255, 0, 255]);

        let mut img = RgbaImage::from_pixel(10, 10, white);
        // Top-left: red
        for y in 0..4 {
            for x in 0..4 {
                img.put_pixel(x, y, red);
            }
        }
        // Top-right: green
        for y in 0..4 {
            for x in 6..10 {
                img.put_pixel(x, y, green);
            }
        }
        // Bottom-left: blue
        for y in 6..10 {
            for x in 0..4 {
                img.put_pixel(x, y, blue);
            }
        }
        // Bottom-right: yellow
        for y in 6..10 {
            for x in 6..10 {
                img.put_pixel(x, y, yellow);
            }
        }

        let config = AutoSplitConfig {
            bg_color: Some([255, 255, 255]),
            tolerance: 0.05,
            separator_threshold: 0.90,
            min_sprite_size: 2,
            pad: 0,
        };

        let (tiles, tw, th) = auto_split_sheet(&img, &config).unwrap();
        assert_eq!(tiles.len(), 4);
        assert_eq!(tw, 4);
        assert_eq!(th, 4);

        // Verify tile positions
        let find_tile = |col, row| tiles.iter().find(|t| t.col == col && t.row == row).unwrap();
        assert_eq!(*find_tile(0, 0).image.get_pixel(0, 0), red);
        assert_eq!(*find_tile(1, 0).image.get_pixel(0, 0), green);
        assert_eq!(*find_tile(0, 1).image.get_pixel(0, 0), blue);
        assert_eq!(*find_tile(1, 1).image.get_pixel(0, 0), yellow);
    }

    #[test]
    fn test_auto_split_uneven_sizes() {
        // Two sprites of different sizes with white separator:
        // Left: 3x5 red at (0,0), Right: 5x3 green at (5,0)
        // Total: 10x5, col separator at x=3,4
        let white = Rgba([255, 255, 255, 255]);
        let red = Rgba([255, 0, 0, 255]);
        let green = Rgba([0, 255, 0, 255]);

        let mut img = RgbaImage::from_pixel(10, 5, white);
        for y in 0..5 {
            for x in 0..3 {
                img.put_pixel(x, y, red);
            }
        }
        for y in 1..4 {
            for x in 5..10 {
                img.put_pixel(x, y, green);
            }
        }

        let config = AutoSplitConfig {
            bg_color: Some([255, 255, 255]),
            tolerance: 0.05,
            separator_threshold: 0.90,
            min_sprite_size: 2,
            pad: 0,
        };

        let (tiles, tw, th) = auto_split_sheet(&img, &config).unwrap();
        assert_eq!(tiles.len(), 2);
        // Uniform size = max of (3,5) x max of (5,3) = 5x5
        assert_eq!(tw, 5);
        assert_eq!(th, 5);
    }

    #[test]
    fn test_auto_split_transparent_bg() {
        // 2 sprites on transparent background
        let transparent = Rgba([0, 0, 0, 0]);
        let red = Rgba([255, 0, 0, 255]);
        let blue = Rgba([0, 0, 255, 255]);

        let mut img = RgbaImage::from_pixel(10, 4, transparent);
        // Left sprite
        for y in 0..4 {
            for x in 0..4 {
                img.put_pixel(x, y, red);
            }
        }
        // Right sprite
        for y in 0..4 {
            for x in 6..10 {
                img.put_pixel(x, y, blue);
            }
        }

        let config = AutoSplitConfig {
            bg_color: None,
            tolerance: 0.05,
            separator_threshold: 0.90,
            min_sprite_size: 2,
            pad: 0,
        };

        let (tiles, tw, th) = auto_split_sheet(&img, &config).unwrap();
        assert_eq!(tiles.len(), 2);
        assert_eq!(tw, 4);
        assert_eq!(th, 4);
    }

    #[test]
    fn test_auto_split_empty_cells() {
        // 2x2 grid but one cell is empty
        let white = Rgba([255, 255, 255, 255]);
        let red = Rgba([255, 0, 0, 255]);

        let mut img = RgbaImage::from_pixel(10, 10, white);
        // Only fill top-left and bottom-right
        for y in 0..4 {
            for x in 0..4 {
                img.put_pixel(x, y, red);
            }
        }
        for y in 6..10 {
            for x in 6..10 {
                img.put_pixel(x, y, red);
            }
        }

        let config = AutoSplitConfig {
            bg_color: Some([255, 255, 255]),
            tolerance: 0.05,
            separator_threshold: 0.90,
            min_sprite_size: 2,
            pad: 0,
        };

        let (tiles, _, _) = auto_split_sheet(&img, &config).unwrap();
        // Only 2 tiles, the empty cells are filtered
        assert_eq!(tiles.len(), 2);
        assert!(tiles.iter().any(|t| t.col == 0 && t.row == 0));
        assert!(tiles.iter().any(|t| t.col == 1 && t.row == 1));
    }
}
