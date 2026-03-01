use anyhow::{bail, Result};
use image::Rgba;
use palette::Oklab;
use tracing::info;

use crate::color::kmeans::{kmeans_oklab, subsample};
use crate::color::oklab::rgba_to_oklab;
use crate::color::palette_match::{palette_to_oklab, palette_to_rgba, snap_to_palette};
use crate::color::palettes;
use crate::pipeline::PipelineState;

/// Configuration for color quantization.
#[derive(Debug, Clone, Default)]
pub struct QuantizeConfig {
    /// Number of colors to extract (for auto-extract mode).
    pub num_colors: Option<u32>,
    /// Predefined palette name (e.g., "pico-8").
    pub palette_name: Option<String>,
    /// Custom palette as RGB triplets.
    pub custom_palette: Option<Vec<[u8; 3]>>,
    /// Maximum pixel samples for k-means (default: 10000).
    pub max_samples: usize,
    /// Maximum k-means iterations (default: 50).
    pub max_iterations: usize,
    /// Whether to skip quantization entirely.
    pub skip: bool,
}

impl QuantizeConfig {
    pub fn with_defaults(mut self) -> Self {
        if self.max_samples == 0 {
            self.max_samples = 10000;
        }
        if self.max_iterations == 0 {
            self.max_iterations = 50;
        }
        self
    }
}

/// Quantize the image colors.
///
/// Three modes:
/// 1. Predefined palette: snap all pixels to the named palette
/// 2. Custom palette: snap all pixels to the provided colors
/// 3. Auto-extract: run k-means in OKLAB to find N colors, then snap
pub fn quantize_colors(state: &mut PipelineState, config: &QuantizeConfig) -> Result<()> {
    if config.skip {
        return Ok(());
    }

    let config = fill_defaults(config);

    // Determine the target palette
    let (palette_oklab, palette_rgba) = if let Some(ref name) = config.palette_name {
        // Mode 1: Predefined palette
        let pal = palettes::find_palette(name)
            .ok_or_else(|| {
                let available: Vec<&str> = palettes::ALL_PALETTES.iter().map(|p| p.slug).collect();
                anyhow::anyhow!(
                    "Unknown palette '{}'. Available: {}",
                    name,
                    available.join(", ")
                )
            })?;
        info!(palette = pal.name, colors = pal.colors.len(), "Using predefined palette");
        (palette_to_oklab(pal.colors), palette_to_rgba(pal.colors))
    } else if let Some(ref custom) = config.custom_palette {
        // Mode 2: Custom palette
        info!(colors = custom.len(), "Using custom palette");
        (palette_to_oklab(custom), palette_to_rgba(custom))
    } else if let Some(num) = config.num_colors {
        // Mode 3: Auto-extract via k-means
        if num < 2 {
            bail!("Number of colors must be >= 2, got {}", num);
        }
        info!(target_colors = num, "Auto-extracting palette via k-means");
        extract_palette(state, num as usize, config.max_samples, config.max_iterations)?
    } else {
        // No quantization mode specified
        return Ok(());
    };

    // Snap all pixels to the palette
    snap_to_palette(&mut state.image, &palette_oklab, &palette_rgba);

    // Count unique colors in output
    let mut unique_colors = std::collections::HashSet::new();
    for pixel in state.image.pixels() {
        if pixel[3] > 0 {
            unique_colors.insert(pixel.0);
        }
    }
    info!(colors = unique_colors.len(), "Quantization complete");

    Ok(())
}

fn fill_defaults(config: &QuantizeConfig) -> QuantizeConfig {
    let mut c = config.clone();
    if c.max_samples == 0 {
        c.max_samples = 10000;
    }
    if c.max_iterations == 0 {
        c.max_iterations = 50;
    }
    c
}

/// Extract a palette from the image using k-means in OKLAB space.
fn extract_palette(
    state: &PipelineState,
    num_colors: usize,
    max_samples: usize,
    max_iterations: usize,
) -> Result<(Vec<Oklab>, Vec<Rgba<u8>>)> {
    // Collect all opaque pixel colors in OKLAB
    let all_colors: Vec<Oklab> = state
        .image
        .pixels()
        .filter(|p| p[3] > 0)
        .map(|p| rgba_to_oklab(*p))
        .collect();

    if all_colors.is_empty() {
        bail!("No opaque pixels to extract palette from");
    }

    // Subsample for speed
    let samples = subsample(&all_colors, max_samples);

    // Run k-means
    let centroids = kmeans_oklab(&samples, num_colors, max_iterations);

    // Convert centroids back to RGBA
    let palette_rgba: Vec<Rgba<u8>> = centroids
        .iter()
        .map(|c| {
            use palette::{IntoColor, Srgb};
            let srgb: Srgb = (*c).into_color();
            Rgba([
                (srgb.red.clamp(0.0, 1.0) * 255.0).round() as u8,
                (srgb.green.clamp(0.0, 1.0) * 255.0).round() as u8,
                (srgb.blue.clamp(0.0, 1.0) * 255.0).round() as u8,
                255,
            ])
        })
        .collect();

    Ok((centroids, palette_rgba))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::RgbaImage;

    #[test]
    fn test_quantize_predefined_palette() {
        // Create image with colors near PICO-8 red and blue
        let mut img = RgbaImage::new(4, 1);
        img.put_pixel(0, 0, Rgba([250, 5, 75, 255])); // Near PICO-8 red
        img.put_pixel(1, 0, Rgba([250, 5, 75, 255]));
        img.put_pixel(2, 0, Rgba([35, 170, 250, 255])); // Near PICO-8 blue
        img.put_pixel(3, 0, Rgba([35, 170, 250, 255]));

        let mut state = PipelineState::new(img);
        let config = QuantizeConfig {
            palette_name: Some("pico-8".to_string()),
            skip: false,
            ..Default::default()
        };
        quantize_colors(&mut state, &config).unwrap();

        // All pixels should now be exact PICO-8 colors
        let p0 = *state.image.get_pixel(0, 0);
        let p2 = *state.image.get_pixel(2, 0);
        // Should be snapped to nearest PICO-8 color
        assert!(palettes::PICO_8.colors.iter().any(|c| c[0] == p0[0] && c[1] == p0[1] && c[2] == p0[2]));
        assert!(palettes::PICO_8.colors.iter().any(|c| c[0] == p2[0] && c[1] == p2[1] && c[2] == p2[2]));
    }

    #[test]
    fn test_quantize_auto_extract() {
        // Create image with exactly 2 distinct colors
        let mut img = RgbaImage::new(10, 10);
        for y in 0..5 {
            for x in 0..10 {
                img.put_pixel(x, y, Rgba([255, 0, 0, 255]));
            }
        }
        for y in 5..10 {
            for x in 0..10 {
                img.put_pixel(x, y, Rgba([0, 0, 255, 255]));
            }
        }

        let mut state = PipelineState::new(img);
        let config = QuantizeConfig {
            num_colors: Some(2),
            skip: false,
            ..Default::default()
        };
        quantize_colors(&mut state, &config).unwrap();

        // Output should have at most 2 colors
        let mut unique = std::collections::HashSet::new();
        for pixel in state.image.pixels() {
            unique.insert(pixel.0);
        }
        assert!(unique.len() <= 2);
    }

    #[test]
    fn test_quantize_skip() {
        let img = RgbaImage::from_pixel(4, 4, Rgba([100, 100, 100, 255]));
        let original = img.clone();
        let mut state = PipelineState::new(img);
        let config = QuantizeConfig {
            skip: true,
            ..Default::default()
        };
        quantize_colors(&mut state, &config).unwrap();
        assert_eq!(state.image, original);
    }
}
