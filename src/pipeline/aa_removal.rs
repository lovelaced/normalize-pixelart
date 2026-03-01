use anyhow::Result;
use image::Rgba;
use palette::Oklab;
use rayon::prelude::*;
use tracing::info;

use crate::color::oklab::{oklab_distance, rgba_to_oklab};
use crate::pipeline::PipelineState;

/// Configuration for anti-aliasing removal.
#[derive(Debug, Clone)]
pub struct AaRemovalConfig {
    /// Sensitivity threshold (0.0-1.0). Lower = more aggressive removal.
    /// A pixel is considered AA if it lies on the interpolation line between
    /// two neighbor colors within this tolerance.
    pub threshold: f32,
    /// Whether to skip AA removal entirely.
    pub skip: bool,
}

impl Default for AaRemovalConfig {
    fn default() -> Self {
        Self {
            threshold: 0.5,
            skip: true, // Off by default — AI art has intentional edge detail
        }
    }
}

/// The 8 directions for 8-connected neighborhood.
const OFFSETS: [(i32, i32); 8] = [
    (-1, -1), (0, -1), (1, -1),
    (-1,  0),          (1,  0),
    (-1,  1), (0,  1), (1,  1),
];

/// Remove anti-aliasing artifacts from the image.
///
/// For each pixel, examines its 8-connected neighbors. If the pixel's color
/// lies "between" the two most common neighbor colors in OKLAB space
/// (i.e., it's an interpolation artifact), snaps it to the closer neighbor.
pub fn remove_aa(state: &mut PipelineState, config: &AaRemovalConfig) -> Result<()> {
    if config.skip {
        return Ok(());
    }

    let image = &state.image;
    let width = image.width();
    let height = image.height();

    // Pre-compute OKLAB values for the entire image (avoids repeated conversions)
    let oklab_pixels: Vec<Oklab> = image.pixels().map(|p| rgba_to_oklab(*p)).collect();
    let raw_pixels: Vec<[u8; 4]> = image.pixels().map(|p| p.0).collect();

    // Process rows in parallel, collect results
    let rows: Vec<Vec<Option<Rgba<u8>>>> = (0..height)
        .into_par_iter()
        .map(|y| {
            let mut row_results = Vec::with_capacity(width as usize);
            for x in 0..width {
                let idx = (y * width + x) as usize;
                let pixel = raw_pixels[idx];

                // Skip fully transparent pixels
                if pixel[3] == 0 {
                    row_results.push(None);
                    continue;
                }

                // Get the two most common neighbor colors (inline, no allocation)
                let (c1, c2, n_unique) = top_two_neighbors(
                    &raw_pixels, width, height, x, y,
                );

                if n_unique < 2 {
                    row_results.push(None);
                    continue;
                }

                // If the pixel is already one of the dominant colors, skip
                if pixel == c1 || pixel == c2 {
                    row_results.push(None);
                    continue;
                }

                // Check if the pixel lies between c1 and c2 in OKLAB space
                let p_ok = oklab_pixels[idx];
                let c1_ok = rgba_to_oklab(Rgba(c1));
                let c2_ok = rgba_to_oklab(Rgba(c2));

                if is_between_oklab(p_ok, c1_ok, c2_ok, config.threshold) {
                    // Snap to the closer of c1 or c2
                    let d1 = oklab_distance(p_ok, c1_ok);
                    let d2 = oklab_distance(p_ok, c2_ok);
                    let snapped = if d1 <= d2 { c1 } else { c2 };
                    // Preserve original alpha
                    row_results.push(Some(Rgba([snapped[0], snapped[1], snapped[2], pixel[3]])));
                } else {
                    row_results.push(None);
                }
            }
            row_results
        })
        .collect();

    // Apply results
    let mut output = image.clone();
    let mut removed_count = 0u32;
    for (y, row) in rows.iter().enumerate() {
        for (x, result) in row.iter().enumerate() {
            if let Some(color) = result {
                output.put_pixel(x as u32, y as u32, *color);
                removed_count += 1;
            }
        }
    }

    info!(
        removed = removed_count,
        total = width * height,
        "AA removal complete"
    );

    state.image = output;
    Ok(())
}

/// Find the top two most frequent neighbor colors (no heap allocation).
/// Returns (most_common, second_common, unique_count).
fn top_two_neighbors(
    pixels: &[[u8; 4]],
    width: u32,
    height: u32,
    x: u32,
    y: u32,
) -> ([u8; 4], [u8; 4], usize) {
    // At most 8 neighbors; use fixed-size stack buffer
    let mut colors: [([u8; 4], u8); 8] = [([0; 4], 0); 8];
    let mut n_unique = 0usize;

    let ix = x as i32;
    let iy = y as i32;
    let w = width as i32;
    let h = height as i32;

    for &(dx, dy) in &OFFSETS {
        let nx = ix + dx;
        let ny = iy + dy;
        if nx >= 0 && nx < w && ny >= 0 && ny < h {
            let pixel = pixels[(ny as u32 * width + nx as u32) as usize];
            // Linear search in our small fixed buffer
            let mut found = false;
            for entry in colors.iter_mut().take(n_unique) {
                if entry.0 == pixel {
                    entry.1 += 1;
                    found = true;
                    break;
                }
            }
            if !found && n_unique < 8 {
                colors[n_unique] = (pixel, 1);
                n_unique += 1;
            }
        }
    }

    if n_unique < 2 {
        return (colors[0].0, [0; 4], n_unique);
    }

    // Find top two by count (partial sort, no allocation)
    let mut first_idx = 0;
    for i in 1..n_unique {
        if colors[i].1 > colors[first_idx].1 {
            first_idx = i;
        }
    }

    let mut second_idx = if first_idx == 0 { 1 } else { 0 };
    for i in 0..n_unique {
        if i != first_idx && colors[i].1 > colors[second_idx].1 {
            second_idx = i;
        }
    }

    (colors[first_idx].0, colors[second_idx].0, n_unique)
}

/// Check if a point lies between two colors in OKLAB space.
///
/// Uses the triangle inequality: if dist(c1, p) + dist(p, c2) ≈ dist(c1, c2),
/// then p is roughly on the line segment between c1 and c2.
fn is_between_oklab(p: Oklab, c1: Oklab, c2: Oklab, threshold: f32) -> bool {
    let d_c1_c2 = oklab_distance(c1, c2);

    // Colors must be sufficiently different for AA to be meaningful
    if d_c1_c2 < 0.02 {
        return false;
    }

    let d_c1_p = oklab_distance(c1, p);
    let d_p_c2 = oklab_distance(p, c2);

    // Triangle inequality deviation
    let deviation = (d_c1_p + d_p_c2) / d_c1_c2 - 1.0;

    // Must not be too close to either endpoint
    let ratio = d_c1_p / d_c1_c2;
    let away_from_endpoints = ratio > 0.1 && ratio < 0.9;

    let max_deviation = threshold * 0.3;
    deviation < max_deviation && away_from_endpoints
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::image_util::neighbors::neighbor_colors;
    use crate::pipeline::PipelineState;
    use image::RgbaImage;

    #[test]
    fn test_is_between_exact_midpoint() {
        let red = Rgba([255, 0, 0, 255]);
        let blue = Rgba([0, 0, 255, 255]);
        let blend = Rgba([127, 0, 127, 255]);
        let p = rgba_to_oklab(blend);
        let c1 = rgba_to_oklab(red);
        let c2 = rgba_to_oklab(blue);
        assert!(is_between_oklab(p, c1, c2, 0.5));
    }

    #[test]
    fn test_is_not_between_same_color() {
        let red = Rgba([255, 0, 0, 255]);
        let p = rgba_to_oklab(red);
        assert!(!is_between_oklab(p, p, p, 0.5));
    }

    #[test]
    fn test_is_not_between_endpoint() {
        let red = Rgba([255, 0, 0, 255]);
        let blue = Rgba([0, 0, 255, 255]);
        let p = rgba_to_oklab(red);
        let c1 = rgba_to_oklab(red);
        let c2 = rgba_to_oklab(blue);
        assert!(!is_between_oklab(p, c1, c2, 0.5));
    }

    #[test]
    fn test_aa_removal_snaps_blend_pixels() {
        // 3x3 image: red border with a blend pixel in the center-right
        let red = Rgba([255, 0, 0, 255]);
        let blue = Rgba([0, 0, 255, 255]);
        let blend = Rgba([127, 0, 127, 255]);

        let mut img = RgbaImage::new(5, 3);
        // Fill left side with red
        for y in 0..3 {
            for x in 0..3 {
                img.put_pixel(x, y, red);
            }
        }
        // Right side blue
        for y in 0..3 {
            img.put_pixel(3, y, blue);
            img.put_pixel(4, y, blue);
        }
        // Insert blend pixel at the boundary
        img.put_pixel(2, 1, blend);

        let mut state = PipelineState::new(img);
        let config = AaRemovalConfig {
            threshold: 0.5,
            skip: false,
        };
        remove_aa(&mut state, &config).unwrap();

        // The blend pixel should have been snapped to red (closer neighbor)
        let result = *state.image.get_pixel(2, 1);
        assert!(result == red || result == blue, "Expected red or blue, got {:?}", result);
    }

    #[test]
    fn test_top_two_neighbors_matches_original() {
        // Verify the optimized version gives same results as the original
        let mut img = RgbaImage::from_pixel(3, 3, Rgba([255, 0, 0, 255]));
        img.put_pixel(0, 0, Rgba([0, 0, 255, 255]));
        img.put_pixel(1, 0, Rgba([0, 0, 255, 255]));

        let raw: Vec<[u8; 4]> = img.pixels().map(|p| p.0).collect();
        let (c1, c2, n) = top_two_neighbors(&raw, 3, 3, 1, 1);

        let neighbors = neighbor_colors(&img, 1, 1);
        assert_eq!(n, neighbors.len());
        assert_eq!(c1, neighbors[0].0.0);
        assert_eq!(c2, neighbors[1].0.0);
    }
}
