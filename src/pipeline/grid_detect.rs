use anyhow::Result;
use palette::Oklab;
use rayon::prelude::*;
use tracing::{debug, info};

use crate::color::oklab::{oklab_distance_sq, rgba_to_oklab};
use crate::pipeline::{GridDetectConfig, PipelineState};

/// Result of grid detection for a single candidate.
#[derive(Debug, Clone)]
struct CandidateResult {
    grid_size: u32,
    phase_x: u32,
    phase_y: u32,
    /// Edge alignment score: ratio of mean gradient at grid boundaries to mean
    /// gradient at non-boundary positions. Higher = better grid alignment.
    score: f32,
}

/// Detect the pixel grid size and phase offset in the image.
///
/// Uses edge-alignment analysis: for each candidate grid size, we measure
/// where color transitions occur. In true pixel art at scale N, color changes
/// happen at grid boundaries (every Nth pixel) and NOT between them.
///
/// The score = mean_diff_at_grid_lines / mean_diff_off_grid_lines.
/// The correct grid size maximizes this because ALL transitions align to its
/// grid. Smaller factors (N/2) score lower because only half their grid lines
/// coincide with real transitions.
pub fn detect_grid(state: &mut PipelineState, config: &GridDetectConfig) -> Result<()> {
    let image = &state.image;
    let width = image.width();
    let height = image.height();

    // Handle overrides
    if let Some(size) = config.override_size {
        if let Some(phase) = config.override_phase {
            // Both size and phase overridden — use as-is
            info!(grid_size = size, phase_x = phase.0, phase_y = phase.1, "Using override grid size and phase");
            state.grid_size = Some(size);
            state.grid_phase = Some(phase);
            return Ok(());
        }

        // Size overridden but phase not — auto-detect best phase for this size
        let oklab_pixels: Vec<Oklab> = image.pixels().map(|p| rgba_to_oklab(*p)).collect();
        let best_phase = find_best_phase(&oklab_pixels, width, height, size);
        info!(
            grid_size = size,
            phase_x = best_phase.0,
            phase_y = best_phase.1,
            "Using override grid size with auto-detected phase"
        );
        state.grid_size = Some(size);
        state.grid_phase = Some(best_phase);
        return Ok(());
    }

    let max_candidate = config
        .max_candidate
        .min(width / 2)
        .min(height / 2)
        .max(2);

    // Pre-compute OKLAB values for the entire image (done once)
    let oklab_pixels: Vec<Oklab> = image.pixels().map(|p| rgba_to_oklab(*p)).collect();

    // Phase 1: Coarse pass — test all candidate sizes with phase (0,0), in parallel
    let coarse_results: Vec<CandidateResult> = (2..=max_candidate)
        .into_par_iter()
        .map(|candidate| {
            let score = compute_edge_alignment(
                &oklab_pixels,
                width,
                height,
                candidate,
                0,
                0,
            );
            CandidateResult {
                grid_size: candidate,
                phase_x: 0,
                phase_y: 0,
                score,
            }
        })
        .collect();

    // Store diagnostic scores
    for r in &coarse_results {
        debug!(grid_size = r.grid_size, score = r.score, "Coarse pass");
        state
            .diagnostics
            .grid_variance_scores
            .push((r.grid_size, r.score));
    }

    // Sort by score descending
    let mut sorted_coarse = coarse_results;
    sorted_coarse.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    // Phase 2: Fine pass — scan phase offsets
    // For small candidates (≤ threshold): exhaustive phase scan (cheap, small phase space)
    // For large candidates in top-N: limited phase scan (subsample phase space)
    let phase_scan_threshold = 8;
    let num_top_candidates = 5.min(sorted_coarse.len());

    // Collect all (candidate, phase_x, phase_y) jobs to run in parallel
    let mut phase_jobs: Vec<(u32, u32, u32)> = Vec::new();

    // Small candidates: exhaustive phase scan
    for candidate in 2..=max_candidate.min(phase_scan_threshold) {
        for phase_x in 0..candidate {
            for phase_y in 0..candidate {
                if phase_x == 0 && phase_y == 0 {
                    continue; // Already computed in coarse pass
                }
                phase_jobs.push((candidate, phase_x, phase_y));
            }
        }
    }

    // Top candidates above threshold: limited phase scan
    // Only scan phases 0..min(candidate, 8) for each axis
    for r in &sorted_coarse[..num_top_candidates] {
        if r.grid_size <= phase_scan_threshold {
            continue; // Already covered above
        }
        let max_phase = r.grid_size.min(8);
        for phase_x in 0..max_phase {
            for phase_y in 0..max_phase {
                if phase_x == 0 && phase_y == 0 {
                    continue;
                }
                phase_jobs.push((r.grid_size, phase_x, phase_y));
            }
        }
    }

    // Run all phase jobs in parallel
    let phase_results: Vec<CandidateResult> = phase_jobs
        .par_iter()
        .map(|&(candidate, phase_x, phase_y)| {
            let score = compute_edge_alignment(
                &oklab_pixels,
                width,
                height,
                candidate,
                phase_x,
                phase_y,
            );
            CandidateResult {
                grid_size: candidate,
                phase_x,
                phase_y,
                score,
            }
        })
        .collect();

    // Find the best overall result (from coarse + phase results)
    let mut best = sorted_coarse[0].clone();
    for r in &phase_results {
        if r.score > best.score {
            best = r.clone();
        }
    }

    // Compute confidence based on how much the best score exceeds the runner-up
    // at a different grid size
    let runner_up = sorted_coarse
        .iter()
        .find(|r| r.grid_size != best.grid_size);
    let confidence = match runner_up {
        Some(r) if best.score > 0.0 => {
            (1.0 - r.score / best.score).clamp(0.0, 1.0)
        }
        _ => 1.0,
    };

    info!(
        grid_size = best.grid_size,
        phase_x = best.phase_x,
        phase_y = best.phase_y,
        score = best.score,
        confidence,
        "Grid detected"
    );

    state.grid_size = Some(best.grid_size);
    state.grid_phase = Some((best.phase_x, best.phase_y));
    state.diagnostics.grid_confidence = Some(confidence);

    Ok(())
}

/// Find the best phase offset for a given grid size by testing all possibilities.
///
/// For small grid sizes (≤12), scans all phase_x × phase_y combinations.
/// For larger sizes, scans a limited window (0..12 for each axis).
/// All jobs run in parallel via rayon.
fn find_best_phase(
    oklab_pixels: &[Oklab],
    width: u32,
    height: u32,
    grid_size: u32,
) -> (u32, u32) {
    let max_phase = grid_size.min(12);

    let results: Vec<(u32, u32, f32)> = (0..max_phase)
        .into_par_iter()
        .flat_map(|px| {
            (0..max_phase)
                .into_par_iter()
                .map(move |py| {
                    let score =
                        compute_edge_alignment(oklab_pixels, width, height, grid_size, px, py);
                    (px, py, score)
                })
        })
        .collect();

    results
        .into_iter()
        .max_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(px, py, _)| (px, py))
        .unwrap_or((0, 0))
}

/// Compute edge alignment score for a candidate grid size and phase.
///
/// Measures the ratio of color gradients at grid boundaries vs non-boundaries.
/// For the correct grid size, transitions happen at grid lines and nowhere else,
/// so this ratio is maximized.
///
/// Examines both horizontal transitions (between adjacent columns) and
/// vertical transitions (between adjacent rows).
fn compute_edge_alignment(
    oklab_pixels: &[Oklab],
    width: u32,
    height: u32,
    grid_size: u32,
    phase_x: u32,
    phase_y: u32,
) -> f32 {
    let mut on_grid_total = 0.0f64;
    let mut on_grid_count = 0u64;
    let mut off_grid_total = 0.0f64;
    let mut off_grid_count = 0u64;

    // Vertical transitions (between row y-1 and row y)
    for y in 1..height {
        // A grid line occurs at positions where a new block starts
        let is_grid_line = if y >= phase_y {
            (y - phase_y).is_multiple_of(grid_size)
        } else {
            false
        };

        for x in 0..width {
            let idx_curr = (y * width + x) as usize;
            let idx_prev = ((y - 1) * width + x) as usize;
            let diff = oklab_distance_sq(oklab_pixels[idx_curr], oklab_pixels[idx_prev]);

            if is_grid_line {
                on_grid_total += diff as f64;
                on_grid_count += 1;
            } else {
                off_grid_total += diff as f64;
                off_grid_count += 1;
            }
        }
    }

    // Horizontal transitions (between column x-1 and column x)
    for y in 0..height {
        for x in 1..width {
            let is_grid_line = if x >= phase_x {
                (x - phase_x).is_multiple_of(grid_size)
            } else {
                false
            };

            let idx_curr = (y * width + x) as usize;
            let idx_prev = (y * width + x - 1) as usize;
            let diff = oklab_distance_sq(oklab_pixels[idx_curr], oklab_pixels[idx_prev]);

            if is_grid_line {
                on_grid_total += diff as f64;
                on_grid_count += 1;
            } else {
                off_grid_total += diff as f64;
                off_grid_count += 1;
            }
        }
    }

    if on_grid_count == 0 {
        return 0.0;
    }

    let on_avg = on_grid_total / on_grid_count as f64;
    let off_avg = if off_grid_count > 0 {
        off_grid_total / off_grid_count as f64
    } else {
        0.0
    };

    (on_avg / (off_avg + 1e-10)) as f32
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    /// Create a synthetic pixel art image: a small image upscaled by `scale`.
    fn make_synthetic(small_w: u32, small_h: u32, scale: u32) -> RgbaImage {
        let colors = [
            Rgba([255, 0, 0, 255]),
            Rgba([0, 255, 0, 255]),
            Rgba([0, 0, 255, 255]),
            Rgba([255, 255, 0, 255]),
            Rgba([255, 0, 255, 255]),
            Rgba([0, 255, 255, 255]),
            Rgba([128, 128, 128, 255]),
            Rgba([255, 128, 0, 255]),
        ];

        let big_w = small_w * scale;
        let big_h = small_h * scale;
        let mut img = RgbaImage::new(big_w, big_h);

        for sy in 0..small_h {
            for sx in 0..small_w {
                let color_idx = ((sy * 3 + sx * 7 + sy * sx) as usize) % colors.len();
                let color = colors[color_idx];
                for dy in 0..scale {
                    for dx in 0..scale {
                        img.put_pixel(sx * scale + dx, sy * scale + dy, color);
                    }
                }
            }
        }

        img
    }

    /// Create a synthetic pixel art image with AA noise at block boundaries.
    fn make_synthetic_with_aa(small_w: u32, small_h: u32, scale: u32) -> RgbaImage {
        let colors = [
            Rgba([255, 0, 0, 255]),
            Rgba([0, 255, 0, 255]),
            Rgba([0, 0, 255, 255]),
            Rgba([255, 255, 0, 255]),
            Rgba([255, 0, 255, 255]),
            Rgba([0, 255, 255, 255]),
        ];

        let big_w = small_w * scale;
        let big_h = small_h * scale;
        let mut img = RgbaImage::new(big_w, big_h);

        let mut sprite = vec![vec![Rgba([0u8, 0, 0, 255]); small_w as usize]; small_h as usize];
        for sy in 0..small_h {
            for sx in 0..small_w {
                let idx = ((sy * 3 + sx * 7 + sy * sx) as usize) % colors.len();
                sprite[sy as usize][sx as usize] = colors[idx];
            }
        }

        // Upscale
        for sy in 0..small_h {
            for sx in 0..small_w {
                let color = sprite[sy as usize][sx as usize];
                for dy in 0..scale {
                    for dx in 0..scale {
                        img.put_pixel(sx * scale + dx, sy * scale + dy, color);
                    }
                }
            }
        }

        // Inject AA at horizontal boundaries
        for sy in 0..small_h - 1 {
            for sx in 0..small_w {
                let c1 = sprite[sy as usize][sx as usize];
                let c2 = sprite[(sy + 1) as usize][sx as usize];
                if c1 != c2 {
                    let blend = Rgba([
                        ((c1[0] as u16 + c2[0] as u16) / 2) as u8,
                        ((c1[1] as u16 + c2[1] as u16) / 2) as u8,
                        ((c1[2] as u16 + c2[2] as u16) / 2) as u8,
                        255,
                    ]);
                    let boundary_y = (sy + 1) * scale;
                    for dx in 0..scale {
                        if boundary_y > 0 {
                            img.put_pixel(sx * scale + dx, boundary_y - 1, blend);
                        }
                        img.put_pixel(sx * scale + dx, boundary_y, blend);
                    }
                }
            }
        }

        // Inject AA at vertical boundaries
        for sy in 0..small_h {
            for sx in 0..small_w - 1 {
                let c1 = sprite[sy as usize][sx as usize];
                let c2 = sprite[sy as usize][(sx + 1) as usize];
                if c1 != c2 {
                    let blend = Rgba([
                        ((c1[0] as u16 + c2[0] as u16) / 2) as u8,
                        ((c1[1] as u16 + c2[1] as u16) / 2) as u8,
                        ((c1[2] as u16 + c2[2] as u16) / 2) as u8,
                        255,
                    ]);
                    let boundary_x = (sx + 1) * scale;
                    for dy in 0..scale {
                        if boundary_x > 0 {
                            img.put_pixel(boundary_x - 1, sy * scale + dy, blend);
                        }
                        img.put_pixel(boundary_x, sy * scale + dy, blend);
                    }
                }
            }
        }

        img
    }

    #[test]
    fn test_detect_grid_scale_4() {
        let img = make_synthetic(8, 8, 4);
        let config = GridDetectConfig {
            max_candidate: 16,
            ..Default::default()
        };
        let mut state = PipelineState::new(img);
        detect_grid(&mut state, &config).unwrap();

        assert_eq!(state.grid_size, Some(4));
        assert_eq!(state.grid_phase, Some((0, 0)));
    }

    #[test]
    fn test_detect_grid_scale_2() {
        let img = make_synthetic(16, 16, 2);
        let config = GridDetectConfig {
            max_candidate: 16,
            ..Default::default()
        };
        let mut state = PipelineState::new(img);
        detect_grid(&mut state, &config).unwrap();

        assert_eq!(state.grid_size, Some(2));
    }

    #[test]
    fn test_detect_grid_scale_8() {
        let img = make_synthetic(4, 4, 8);
        let config = GridDetectConfig {
            max_candidate: 16,
            ..Default::default()
        };
        let mut state = PipelineState::new(img);
        detect_grid(&mut state, &config).unwrap();

        assert_eq!(state.grid_size, Some(8));
    }

    #[test]
    fn test_detect_grid_with_aa_noise() {
        let img = make_synthetic_with_aa(8, 8, 4);
        let config = GridDetectConfig {
            max_candidate: 16,
            ..Default::default()
        };
        let mut state = PipelineState::new(img);
        detect_grid(&mut state, &config).unwrap();

        assert_eq!(state.grid_size, Some(4));
    }

    #[test]
    fn test_override_grid_size() {
        let img = make_synthetic(8, 8, 4);
        let config = GridDetectConfig {
            override_size: Some(6),
            override_phase: Some((1, 2)),
            ..Default::default()
        };
        let mut state = PipelineState::new(img);
        detect_grid(&mut state, &config).unwrap();

        assert_eq!(state.grid_size, Some(6));
        assert_eq!(state.grid_phase, Some((1, 2)));
    }

    #[test]
    fn test_detect_with_phase_offset() {
        let scale = 4u32;
        let small_w = 6u32;
        let small_h = 6u32;
        let offset = 1u32;
        let big_w = small_w * scale + offset;
        let big_h = small_h * scale + offset;

        let colors = [
            Rgba([255, 0, 0, 255]),
            Rgba([0, 255, 0, 255]),
            Rgba([0, 0, 255, 255]),
            Rgba([255, 255, 0, 255]),
        ];

        let mut img = RgbaImage::new(big_w, big_h);
        for pixel in img.pixels_mut() {
            *pixel = Rgba([128, 128, 128, 255]);
        }
        for sy in 0..small_h {
            for sx in 0..small_w {
                let color = colors[((sy * 3 + sx * 7 + sy * sx) as usize) % colors.len()];
                for dy in 0..scale {
                    for dx in 0..scale {
                        let px = offset + sx * scale + dx;
                        let py = offset + sy * scale + dy;
                        if px < big_w && py < big_h {
                            img.put_pixel(px, py, color);
                        }
                    }
                }
            }
        }

        let config = GridDetectConfig {
            max_candidate: 16,
            ..Default::default()
        };
        let mut state = PipelineState::new(img);
        detect_grid(&mut state, &config).unwrap();

        assert_eq!(state.grid_size, Some(4));
        assert_eq!(state.grid_phase, Some((1, 1)));
    }
}
