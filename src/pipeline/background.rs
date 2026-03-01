use anyhow::Result;
use image::{Rgba, RgbaImage};
use std::collections::VecDeque;
use tracing::info;

use crate::color::oklab::{oklab_distance, rgba_to_oklab};

/// Configuration for background detection and removal.
#[derive(Debug, Clone)]
pub struct BackgroundConfig {
    /// Whether background removal is enabled.
    pub enabled: bool,
    /// Explicit background color (if None, auto-detect from border pixels).
    pub bg_color: Option<[u8; 3]>,
    /// Minimum fraction of border pixels that must match for auto-detection (0.0-1.0).
    pub border_threshold: f32,
    /// OKLAB distance threshold for considering a pixel as "background color".
    pub color_tolerance: f32,
    /// Use flood-fill from corners instead of global replacement.
    pub flood_fill: bool,
}

impl Default for BackgroundConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            bg_color: None,
            border_threshold: 0.4,
            color_tolerance: 0.05,
            flood_fill: true,
        }
    }
}

/// Detect and remove the background from the image.
///
/// Two modes:
/// 1. **Flood-fill** (default): start from all four corners and flood-fill
///    connected regions of the background color, replacing with transparency.
///    This only removes the outer background, not interior regions.
/// 2. **Global**: replace ALL pixels matching the background color with
///    transparency, regardless of position.
pub fn remove_background(
    image: &mut RgbaImage,
    config: &BackgroundConfig,
) -> Result<Option<Rgba<u8>>> {
    if !config.enabled {
        return Ok(None);
    }

    let width = image.width();
    let height = image.height();

    // Determine background color
    let bg_color = if let Some(rgb) = config.bg_color {
        Rgba([rgb[0], rgb[1], rgb[2], 255])
    } else {
        // Auto-detect from border pixels
        match detect_border_color(image, config.border_threshold) {
            Some(color) => color,
            None => {
                info!("No dominant border color detected, skipping background removal");
                return Ok(None);
            }
        }
    };

    info!(
        r = bg_color[0],
        g = bg_color[1],
        b = bg_color[2],
        "Detected background color"
    );

    let bg_oklab = rgba_to_oklab(bg_color);
    let mut removed_count = 0u32;

    if config.flood_fill {
        // Flood-fill from corners
        let mut visited = vec![false; (width * height) as usize];
        let mut queue = VecDeque::new();

        // Seed from all four corners
        let corners = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)];
        for &(cx, cy) in &corners {
            let idx = (cy * width + cx) as usize;
            if !visited[idx] && is_bg_pixel(image, cx, cy, bg_oklab, config.color_tolerance) {
                queue.push_back((cx, cy));
                visited[idx] = true;
            }
        }

        // Also seed from all border pixels (not just corners) to handle
        // backgrounds that don't touch corners
        for x in 0..width {
            for &y in &[0, height - 1] {
                let idx = (y * width + x) as usize;
                if !visited[idx] && is_bg_pixel(image, x, y, bg_oklab, config.color_tolerance) {
                    queue.push_back((x, y));
                    visited[idx] = true;
                }
            }
        }
        for y in 1..height - 1 {
            for &x in &[0, width - 1] {
                let idx = (y * width + x) as usize;
                if !visited[idx] && is_bg_pixel(image, x, y, bg_oklab, config.color_tolerance) {
                    queue.push_back((x, y));
                    visited[idx] = true;
                }
            }
        }

        // BFS flood-fill
        while let Some((x, y)) = queue.pop_front() {
            // Make this pixel transparent
            image.put_pixel(x, y, Rgba([0, 0, 0, 0]));
            removed_count += 1;

            // Check 4-connected neighbors
            let neighbors = [
                (x.wrapping_sub(1), y),
                (x + 1, y),
                (x, y.wrapping_sub(1)),
                (x, y + 1),
            ];
            for (nx, ny) in neighbors {
                if nx < width && ny < height {
                    let idx = (ny * width + nx) as usize;
                    if !visited[idx]
                        && is_bg_pixel(image, nx, ny, bg_oklab, config.color_tolerance)
                    {
                        visited[idx] = true;
                        queue.push_back((nx, ny));
                    }
                }
            }
        }
    } else {
        // Global replacement: replace ALL matching pixels
        for y in 0..height {
            for x in 0..width {
                if is_bg_pixel(image, x, y, bg_oklab, config.color_tolerance) {
                    image.put_pixel(x, y, Rgba([0, 0, 0, 0]));
                    removed_count += 1;
                }
            }
        }
    }

    info!(
        removed = removed_count,
        total = width * height,
        pct = format!("{:.1}%", removed_count as f64 / (width * height) as f64 * 100.0),
        "Background removal complete"
    );

    Ok(Some(bg_color))
}

/// Check if a pixel matches the background color within tolerance.
fn is_bg_pixel(
    image: &RgbaImage,
    x: u32,
    y: u32,
    bg_oklab: palette::Oklab,
    tolerance: f32,
) -> bool {
    let pixel = *image.get_pixel(x, y);
    if pixel[3] == 0 {
        return false; // Already transparent
    }
    let pixel_oklab = rgba_to_oklab(pixel);
    oklab_distance(pixel_oklab, bg_oklab) <= tolerance
}

/// Auto-detect background color from border pixels.
///
/// Samples all pixels on the image border, builds a histogram,
/// and returns the most common color if it exceeds the threshold.
fn detect_border_color(image: &RgbaImage, threshold: f32) -> Option<Rgba<u8>> {
    let width = image.width();
    let height = image.height();

    if width < 2 || height < 2 {
        return None;
    }

    let mut color_counts: Vec<([u8; 4], u32)> = Vec::new();
    let mut total_border = 0u32;

    // Collect all border pixels
    let mut add_pixel = |x: u32, y: u32| {
        let pixel = image.get_pixel(x, y).0;
        if pixel[3] == 0 {
            return; // Skip transparent
        }
        total_border += 1;
        if let Some(entry) = color_counts.iter_mut().find(|(c, _)| *c == pixel) {
            entry.1 += 1;
        } else {
            color_counts.push((pixel, 1));
        }
    };

    // Top and bottom rows
    for x in 0..width {
        add_pixel(x, 0);
        add_pixel(x, height - 1);
    }
    // Left and right columns (excluding corners already counted)
    for y in 1..height - 1 {
        add_pixel(0, y);
        add_pixel(width - 1, y);
    }

    if total_border == 0 {
        return None;
    }

    // Find the most common border color
    color_counts.sort_by(|a, b| b.1.cmp(&a.1));
    let (top_color, top_count) = color_counts[0];
    let coverage = top_count as f32 / total_border as f32;

    if coverage >= threshold {
        Some(Rgba(top_color))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_bordered_image() -> RgbaImage {
        // 8x8 image: gray border, colored interior
        let gray = Rgba([128, 128, 128, 255]);
        let red = Rgba([255, 0, 0, 255]);
        let blue = Rgba([0, 0, 255, 255]);

        let mut img = RgbaImage::new(8, 8);
        // Fill with gray
        for pixel in img.pixels_mut() {
            *pixel = gray;
        }
        // Interior colors
        for y in 2..6 {
            for x in 2..6 {
                img.put_pixel(x, y, if (x + y) % 2 == 0 { red } else { blue });
            }
        }
        img
    }

    #[test]
    fn test_detect_border_color() {
        let img = make_bordered_image();
        let detected = detect_border_color(&img, 0.4);
        assert_eq!(detected, Some(Rgba([128, 128, 128, 255])));
    }

    #[test]
    fn test_flood_fill_removes_border() {
        let mut img = make_bordered_image();
        let config = BackgroundConfig {
            enabled: true,
            flood_fill: true,
            border_threshold: 0.4,
            color_tolerance: 0.05,
            ..Default::default()
        };

        let result = remove_background(&mut img, &config).unwrap();
        assert!(result.is_some());

        // Border pixels should be transparent
        assert_eq!(img.get_pixel(0, 0)[3], 0);
        assert_eq!(img.get_pixel(7, 7)[3], 0);
        assert_eq!(img.get_pixel(0, 3)[3], 0);

        // Interior non-gray pixels should still be opaque
        assert_ne!(img.get_pixel(3, 3)[3], 0);
    }

    #[test]
    fn test_global_removal() {
        // Create image with gray scattered inside too
        let gray = Rgba([128, 128, 128, 255]);
        let red = Rgba([255, 0, 0, 255]);
        let mut img = RgbaImage::new(4, 4);
        for pixel in img.pixels_mut() {
            *pixel = gray;
        }
        img.put_pixel(1, 1, red);
        img.put_pixel(2, 2, gray); // Interior gray pixel

        let config = BackgroundConfig {
            enabled: true,
            flood_fill: false, // Global mode
            border_threshold: 0.4,
            color_tolerance: 0.05,
            ..Default::default()
        };

        remove_background(&mut img, &config).unwrap();

        // ALL gray pixels removed, including interior
        assert_eq!(img.get_pixel(2, 2)[3], 0);
        // Red pixel preserved
        assert_eq!(*img.get_pixel(1, 1), red);
    }

    #[test]
    fn test_explicit_bg_color() {
        let mut img = RgbaImage::from_pixel(4, 4, Rgba([50, 100, 150, 255]));
        img.put_pixel(2, 2, Rgba([255, 0, 0, 255]));

        let config = BackgroundConfig {
            enabled: true,
            bg_color: Some([50, 100, 150]),
            flood_fill: false,
            color_tolerance: 0.05,
            ..Default::default()
        };

        remove_background(&mut img, &config).unwrap();
        assert_eq!(img.get_pixel(0, 0)[3], 0);
        assert_eq!(*img.get_pixel(2, 2), Rgba([255, 0, 0, 255]));
    }

    #[test]
    fn test_no_dominant_border() {
        // Every border pixel is a different color — no dominant bg
        let mut img = RgbaImage::new(4, 4);
        let mut val = 0u8;
        for y in 0..4 {
            for x in 0..4 {
                img.put_pixel(x, y, Rgba([val, val.wrapping_add(50), val.wrapping_add(100), 255]));
                val = val.wrapping_add(20);
            }
        }

        let config = BackgroundConfig {
            enabled: true,
            border_threshold: 0.4,
            color_tolerance: 0.05,
            ..Default::default()
        };

        let result = remove_background(&mut img, &config).unwrap();
        assert!(result.is_none()); // No background detected
    }

    #[test]
    fn test_disabled() {
        let mut img = RgbaImage::from_pixel(4, 4, Rgba([128, 128, 128, 255]));
        let config = BackgroundConfig::default(); // enabled: false

        let result = remove_background(&mut img, &config).unwrap();
        assert!(result.is_none());
        // All pixels still opaque
        assert_eq!(img.get_pixel(0, 0)[3], 255);
    }
}
