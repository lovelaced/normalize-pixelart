use anyhow::{bail, Result};
use image::{Rgba, RgbaImage};
use std::collections::HashMap;
use tracing::info;

use crate::pipeline::PipelineState;

/// Downscale strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DownscaleMode {
    /// Snap: clean up each block IN-PLACE without reducing resolution.
    /// For each NxN block, finds 1-2 representative colors and snaps every
    /// pixel to the nearest one. Preserves dithering, gradients, and lighting
    /// patterns while aligning to the grid. Best for AI art.
    #[default]
    Snap,
    /// Center-weighted: pixels near the block center have more influence.
    /// Reduces to logical pixel resolution (1 color per block).
    CenterWeighted,
    /// Pure majority vote: the single most common color wins.
    /// Reduces to logical pixel resolution (1 color per block).
    MajorityVote,
    /// Use the center pixel directly. Fastest.
    /// Reduces to logical pixel resolution (1 color per block).
    CenterPixel,
}

impl std::fmt::Display for DownscaleMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DownscaleMode::Snap => write!(f, "snap"),
            DownscaleMode::CenterWeighted => write!(f, "center-weighted"),
            DownscaleMode::MajorityVote => write!(f, "majority-vote"),
            DownscaleMode::CenterPixel => write!(f, "center-pixel"),
        }
    }
}

impl std::str::FromStr for DownscaleMode {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "snap" | "s" => Ok(DownscaleMode::Snap),
            "center-weighted" | "center_weighted" | "cw" => Ok(DownscaleMode::CenterWeighted),
            "majority-vote" | "majority_vote" | "mv" => Ok(DownscaleMode::MajorityVote),
            "center-pixel" | "center_pixel" | "cp" => Ok(DownscaleMode::CenterPixel),
            _ => Err(format!(
                "Unknown downscale mode '{}'. Options: snap, center-weighted, majority-vote, center-pixel",
                s
            )),
        }
    }
}

/// Normalize the image to the detected grid.
///
/// In `Snap` mode: works at original resolution — for each NxN block,
/// finds representative colors and snaps every pixel to the nearest one.
/// Preserves dithering, gradients, and lighting patterns.
///
/// In other modes: reduces to logical pixel resolution (1 color per block).
/// The pipeline orchestrator handles any subsequent resizing.
pub fn majority_vote_downscale(
    state: &mut PipelineState,
    mode: DownscaleMode,
) -> Result<()> {
    let grid_size = state
        .grid_size
        .ok_or_else(|| anyhow::anyhow!("majority_vote_downscale requires grid_size to be set"))?;
    let (phase_x, phase_y) = state.grid_phase.unwrap_or((0, 0));
    let image = &state.image;
    let width = image.width();
    let height = image.height();

    if grid_size < 2 {
        return Ok(()); // Nothing to do
    }

    let blocks_w = (width - phase_x) / grid_size;
    let blocks_h = (height - phase_y) / grid_size;

    if blocks_w == 0 || blocks_h == 0 {
        bail!(
            "Image {}x{} with grid size {} and phase ({},{}) produces no output pixels",
            width,
            height,
            grid_size,
            phase_x,
            phase_y
        );
    }

    if mode == DownscaleMode::Snap {
        info!(
            width,
            height,
            blocks_w,
            blocks_h,
            grid_size,
            phase_x,
            phase_y,
            mode = %mode,
            "Snapping pixels to grid (preserving resolution)"
        );
        state.image = snap_blocks(image, grid_size, phase_x, phase_y, blocks_w, blocks_h);
        return Ok(());
    }

    info!(
        from_w = width,
        from_h = height,
        to_w = blocks_w,
        to_h = blocks_h,
        grid_size,
        phase_x,
        phase_y,
        mode = %mode,
        "Downscaling to logical pixels"
    );

    let mut output = RgbaImage::new(blocks_w, blocks_h);

    for oy in 0..blocks_h {
        for ox in 0..blocks_w {
            let block_x = phase_x + ox * grid_size;
            let block_y = phase_y + oy * grid_size;

            let color = match mode {
                DownscaleMode::CenterWeighted => {
                    block_center_weighted(image, block_x, block_y, grid_size)
                }
                DownscaleMode::MajorityVote => {
                    block_mode_color(image, block_x, block_y, grid_size)
                }
                DownscaleMode::CenterPixel => {
                    block_center_pixel(image, block_x, block_y, grid_size)
                }
                DownscaleMode::Snap => unreachable!(),
            };
            output.put_pixel(ox, oy, color);
        }
    }

    state.image = output;
    Ok(())
}

/// Snap mode: enforce a clean grid at original resolution.
///
/// For each NxN block, find the dominant color (center-weighted majority vote)
/// and paint every pixel in that block that single color. This produces a
/// perfectly grid-aligned image with no mixels or stray pixels.
///
/// Dithering between blocks is naturally preserved — adjacent blocks can have
/// different dominant colors, so checkerboard/gradient patterns across blocks
/// remain intact.
fn snap_blocks(
    image: &RgbaImage,
    grid_size: u32,
    phase_x: u32,
    phase_y: u32,
    blocks_w: u32,
    blocks_h: u32,
) -> RgbaImage {
    let width = image.width();
    let height = image.height();
    let mut output = image.clone();

    let center = grid_size as f32 / 2.0;
    let max_dist = center * std::f32::consts::SQRT_2;

    for by in 0..blocks_h {
        for bx in 0..blocks_w {
            let block_x = phase_x + bx * grid_size;
            let block_y = phase_y + by * grid_size;

            // Find dominant color with center-weighted voting
            let mut weighted_freq: Vec<([u8; 4], f32)> = Vec::new();

            for dy in 0..grid_size {
                for dx in 0..grid_size {
                    let px = block_x + dx;
                    let py = block_y + dy;
                    if px >= width || py >= height {
                        continue;
                    }
                    let pixel = image.get_pixel(px, py).0;
                    let dist = ((dx as f32 - center + 0.5).powi(2)
                        + (dy as f32 - center + 0.5).powi(2))
                    .sqrt();
                    let weight = (1.0 - (dist / max_dist).clamp(0.0, 1.0)).powi(2);

                    if let Some(entry) = weighted_freq.iter_mut().find(|(c, _)| *c == pixel) {
                        entry.1 += weight;
                    } else {
                        weighted_freq.push((pixel, weight));
                    }
                }
            }

            let dominant = match weighted_freq
                .iter()
                .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
            {
                Some(entry) => entry.0,
                None => continue,
            };

            // Paint every pixel in the block with the dominant color
            for dy in 0..grid_size {
                for dx in 0..grid_size {
                    let px = block_x + dx;
                    let py = block_y + dy;
                    if px >= width || py >= height {
                        continue;
                    }
                    let alpha = image.get_pixel(px, py)[3];
                    output.put_pixel(px, py, Rgba([dominant[0], dominant[1], dominant[2], alpha]));
                }
            }
        }
    }

    output
}

/// Center-weighted color selection.
///
/// Each pixel in the block votes for its color, but pixels closer to the
/// center get higher weight. This preserves the AI's intended color
/// (typically cleanest at center) while being robust against edge noise.
fn block_center_weighted(
    image: &RgbaImage,
    block_x: u32,
    block_y: u32,
    grid_size: u32,
) -> Rgba<u8> {
    let img_w = image.width();
    let img_h = image.height();
    let center = grid_size as f32 / 2.0;
    let max_dist = center * std::f32::consts::SQRT_2;

    let mut weighted_freq: HashMap<[u8; 4], f32> = HashMap::new();

    for dy in 0..grid_size {
        for dx in 0..grid_size {
            let px = block_x + dx;
            let py = block_y + dy;
            if px < img_w && py < img_h {
                let pixel = image.get_pixel(px, py).0;
                // Weight = 1.0 at center, quadratic falloff toward edges.
                // Quadratic ensures center pixels strongly dominate over
                // noisy edge pixels, which is critical for AI-generated art.
                let dist = ((dx as f32 - center + 0.5).powi(2)
                    + (dy as f32 - center + 0.5).powi(2))
                .sqrt();
                let weight = (1.0 - (dist / max_dist).clamp(0.0, 1.0)).powi(2);
                *weighted_freq.entry(pixel).or_insert(0.0) += weight;
            }
        }
    }

    if weighted_freq.is_empty() {
        return Rgba([0, 0, 0, 0]);
    }

    // Pick the color with highest weighted vote
    weighted_freq
        .into_iter()
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(color, _)| Rgba(color))
        .unwrap_or(Rgba([0, 0, 0, 0]))
}

/// Pick the center pixel of the block directly.
fn block_center_pixel(
    image: &RgbaImage,
    block_x: u32,
    block_y: u32,
    grid_size: u32,
) -> Rgba<u8> {
    let cx = block_x + grid_size / 2;
    let cy = block_y + grid_size / 2;
    if cx < image.width() && cy < image.height() {
        *image.get_pixel(cx, cy)
    } else {
        Rgba([0, 0, 0, 0])
    }
}

/// Find the most common color in a block, with center-proximity tie-breaking.
fn block_mode_color(
    image: &RgbaImage,
    block_x: u32,
    block_y: u32,
    grid_size: u32,
) -> Rgba<u8> {
    let mut freq: HashMap<[u8; 4], u32> = HashMap::new();
    let img_w = image.width();
    let img_h = image.height();
    let half = grid_size / 2;

    for dy in 0..grid_size {
        for dx in 0..grid_size {
            let px = block_x + dx;
            let py = block_y + dy;
            if px < img_w && py < img_h {
                let pixel = image.get_pixel(px, py);
                *freq.entry(pixel.0).or_insert(0) += 1;
            }
        }
    }

    if freq.is_empty() {
        return Rgba([0, 0, 0, 0]);
    }

    let max_count = *freq.values().max().unwrap();

    // Collect all colors tied for the maximum
    let tied: Vec<[u8; 4]> = freq
        .iter()
        .filter(|(_, &count)| count == max_count)
        .map(|(&color, _)| color)
        .collect();

    if tied.len() == 1 {
        return Rgba(tied[0]);
    }

    // Tie-break: prefer the color of the pixel closest to block center
    let center_x = block_x + half;
    let center_y = block_y + half;
    if center_x < img_w && center_y < img_h {
        let center_pixel = image.get_pixel(center_x, center_y).0;
        if tied.contains(&center_pixel) {
            return Rgba(center_pixel);
        }
    }

    // Fallback: just take the first tied color
    Rgba(tied[0])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::PipelineState;

    #[test]
    fn test_majority_vote_uniform_blocks() {
        // 8x8 image with 4 quadrants of solid color, grid size 4
        let mut img = RgbaImage::new(8, 8);
        let red = Rgba([255, 0, 0, 255]);
        let green = Rgba([0, 255, 0, 255]);
        let blue = Rgba([0, 0, 255, 255]);
        let yellow = Rgba([255, 255, 0, 255]);

        for y in 0..4 {
            for x in 0..4 {
                img.put_pixel(x, y, red);
            }
        }
        for y in 0..4 {
            for x in 4..8 {
                img.put_pixel(x, y, green);
            }
        }
        for y in 4..8 {
            for x in 0..4 {
                img.put_pixel(x, y, blue);
            }
        }
        for y in 4..8 {
            for x in 4..8 {
                img.put_pixel(x, y, yellow);
            }
        }

        let mut state = PipelineState::new(img);
        state.grid_size = Some(4);
        state.grid_phase = Some((0, 0));

        majority_vote_downscale(&mut state, DownscaleMode::MajorityVote).unwrap();

        assert_eq!(state.image.width(), 2);
        assert_eq!(state.image.height(), 2);
        assert_eq!(*state.image.get_pixel(0, 0), red);
        assert_eq!(*state.image.get_pixel(1, 0), green);
        assert_eq!(*state.image.get_pixel(0, 1), blue);
        assert_eq!(*state.image.get_pixel(1, 1), yellow);
    }

    #[test]
    fn test_majority_vote_noisy_block() {
        // 4x4 image: 12 red pixels, 4 blue pixels. Grid size 4 → 1x1 output.
        let mut img = RgbaImage::new(4, 4);
        let red = Rgba([255, 0, 0, 255]);
        let blue = Rgba([0, 0, 255, 255]);

        for pixel in img.pixels_mut() {
            *pixel = red;
        }
        // Introduce some blue noise
        img.put_pixel(0, 0, blue);
        img.put_pixel(1, 0, blue);
        img.put_pixel(0, 1, blue);
        img.put_pixel(3, 3, blue);

        let mut state = PipelineState::new(img);
        state.grid_size = Some(4);
        state.grid_phase = Some((0, 0));

        majority_vote_downscale(&mut state, DownscaleMode::MajorityVote).unwrap();

        assert_eq!(state.image.width(), 1);
        assert_eq!(state.image.height(), 1);
        // Red is the majority (12 vs 4)
        assert_eq!(*state.image.get_pixel(0, 0), red);
    }

    #[test]
    fn test_majority_vote_with_phase() {
        // 9x9 image: 1px border of gray, then 2x2 grid of 4x4 colored blocks
        let mut img = RgbaImage::new(9, 9);
        let gray = Rgba([128, 128, 128, 255]);
        let red = Rgba([255, 0, 0, 255]);
        let green = Rgba([0, 255, 0, 255]);
        let blue = Rgba([0, 0, 255, 255]);
        let yellow = Rgba([255, 255, 0, 255]);

        for pixel in img.pixels_mut() {
            *pixel = gray;
        }
        for y in 1..5 {
            for x in 1..5 {
                img.put_pixel(x, y, red);
            }
        }
        for y in 1..5 {
            for x in 5..9 {
                img.put_pixel(x, y, green);
            }
        }
        for y in 5..9 {
            for x in 1..5 {
                img.put_pixel(x, y, blue);
            }
        }
        for y in 5..9 {
            for x in 5..9 {
                img.put_pixel(x, y, yellow);
            }
        }

        let mut state = PipelineState::new(img);
        state.grid_size = Some(4);
        state.grid_phase = Some((1, 1));

        majority_vote_downscale(&mut state, DownscaleMode::MajorityVote).unwrap();

        assert_eq!(state.image.width(), 2);
        assert_eq!(state.image.height(), 2);
        assert_eq!(*state.image.get_pixel(0, 0), red);
        assert_eq!(*state.image.get_pixel(1, 0), green);
        assert_eq!(*state.image.get_pixel(0, 1), blue);
        assert_eq!(*state.image.get_pixel(1, 1), yellow);
    }

    #[test]
    fn test_center_weighted_prefers_center() {
        // 4x4 block: mostly blue at edges, red at center
        let red = Rgba([255, 0, 0, 255]);
        let blue = Rgba([0, 0, 255, 255]);
        let mut img = RgbaImage::new(4, 4);

        // Fill with blue
        for pixel in img.pixels_mut() {
            *pixel = blue;
        }
        // Center 2x2 is red
        img.put_pixel(1, 1, red);
        img.put_pixel(2, 1, red);
        img.put_pixel(1, 2, red);
        img.put_pixel(2, 2, red);

        let mut state = PipelineState::new(img);
        state.grid_size = Some(4);
        state.grid_phase = Some((0, 0));

        // Center-weighted should prefer red (center pixels have higher weight)
        majority_vote_downscale(&mut state, DownscaleMode::CenterWeighted).unwrap();
        assert_eq!(*state.image.get_pixel(0, 0), red);
    }

    #[test]
    fn test_center_pixel_mode() {
        let red = Rgba([255, 0, 0, 255]);
        let blue = Rgba([0, 0, 255, 255]);
        let mut img = RgbaImage::new(4, 4);

        // Fill with blue, center pixel is red
        for pixel in img.pixels_mut() {
            *pixel = blue;
        }
        img.put_pixel(2, 2, red);

        let mut state = PipelineState::new(img);
        state.grid_size = Some(4);
        state.grid_phase = Some((0, 0));

        majority_vote_downscale(&mut state, DownscaleMode::CenterPixel).unwrap();
        assert_eq!(*state.image.get_pixel(0, 0), red);
    }

    #[test]
    fn test_snap_uniform_block() {
        // Single 4x4 block: mostly red with some noise → should become all red
        let red = Rgba([255, 0, 0, 255]);
        let noise = Rgba([128, 0, 128, 255]);

        let mut img = RgbaImage::from_pixel(4, 4, red);
        img.put_pixel(0, 0, noise);
        img.put_pixel(3, 3, noise);

        let mut state = PipelineState::new(img);
        state.grid_size = Some(4);
        state.grid_phase = Some((0, 0));

        majority_vote_downscale(&mut state, DownscaleMode::Snap).unwrap();

        assert_eq!(state.image.width(), 4);
        assert_eq!(state.image.height(), 4);

        // Every pixel should be the dominant color (red)
        for pixel in state.image.pixels() {
            assert_eq!(*pixel, red, "All pixels in block should be dominant color");
        }
    }

    #[test]
    fn test_snap_dithering_across_blocks() {
        // 8x4 image: two 4x4 blocks — left=red, right=blue
        // This simulates dithering across blocks (alternating block colors)
        let red = Rgba([255, 0, 0, 255]);
        let blue = Rgba([0, 0, 255, 255]);
        let noise = Rgba([128, 0, 128, 255]);

        let mut img = RgbaImage::new(8, 4);
        for y in 0..4 {
            for x in 0..4 {
                img.put_pixel(x, y, red);
            }
            for x in 4..8 {
                img.put_pixel(x, y, blue);
            }
        }
        // Add noise at the boundary
        img.put_pixel(3, 1, noise);
        img.put_pixel(4, 1, noise);

        let mut state = PipelineState::new(img);
        state.grid_size = Some(4);
        state.grid_phase = Some((0, 0));

        majority_vote_downscale(&mut state, DownscaleMode::Snap).unwrap();

        // Both colors should survive (in different blocks)
        let left = *state.image.get_pixel(0, 0);
        let right = *state.image.get_pixel(4, 0);
        assert_eq!(left, red);
        assert_eq!(right, blue);

        // Noise pixels should be cleaned up to their block's dominant color
        assert_eq!(*state.image.get_pixel(3, 1), red);
        assert_eq!(*state.image.get_pixel(4, 1), blue);
    }

    #[test]
    fn test_snap_preserves_resolution() {
        // Solid block — snap shouldn't change dimensions
        let red = Rgba([255, 0, 0, 255]);
        let img = RgbaImage::from_pixel(8, 8, red);

        let mut state = PipelineState::new(img);
        state.grid_size = Some(4);
        state.grid_phase = Some((0, 0));

        majority_vote_downscale(&mut state, DownscaleMode::Snap).unwrap();

        assert_eq!(state.image.width(), 8);
        assert_eq!(state.image.height(), 8);
    }
}
