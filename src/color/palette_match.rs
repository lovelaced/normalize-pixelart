use image::{Rgba, RgbaImage};
use palette::Oklab;

use crate::color::oklab::{oklab_distance_sq, rgba_to_oklab};

/// Snap every pixel in the image to the nearest color in the palette.
/// Uses OKLAB distance for perceptually accurate matching.
/// Preserves the original alpha channel.
pub fn snap_to_palette(image: &mut RgbaImage, palette_oklab: &[Oklab], palette_rgba: &[Rgba<u8>]) {
    assert_eq!(palette_oklab.len(), palette_rgba.len());

    for pixel in image.pixels_mut() {
        if pixel[3] == 0 {
            continue; // Skip transparent pixels
        }

        let p_ok = rgba_to_oklab(*pixel);
        let nearest_idx = palette_oklab
            .iter()
            .enumerate()
            .min_by(|(_, a), (_, b)| {
                oklab_distance_sq(p_ok, **a)
                    .partial_cmp(&oklab_distance_sq(p_ok, **b))
                    .unwrap()
            })
            .map(|(i, _)| i)
            .unwrap();

        let matched = palette_rgba[nearest_idx];
        *pixel = Rgba([matched[0], matched[1], matched[2], pixel[3]]);
    }
}

/// Convert a palette of RGB colors to OKLAB.
pub fn palette_to_oklab(palette: &[[u8; 3]]) -> Vec<Oklab> {
    palette
        .iter()
        .map(|&[r, g, b]| rgba_to_oklab(Rgba([r, g, b, 255])))
        .collect()
}

/// Convert a palette of RGB colors to Rgba.
pub fn palette_to_rgba(palette: &[[u8; 3]]) -> Vec<Rgba<u8>> {
    palette
        .iter()
        .map(|&[r, g, b]| Rgba([r, g, b, 255]))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_snap_to_palette() {
        let palette = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];
        let oklab = palette_to_oklab(&palette);
        let rgba = palette_to_rgba(&palette);

        let mut img = RgbaImage::new(3, 1);
        img.put_pixel(0, 0, Rgba([250, 10, 5, 255])); // Near red
        img.put_pixel(1, 0, Rgba([10, 240, 20, 255])); // Near green
        img.put_pixel(2, 0, Rgba([5, 5, 250, 255])); // Near blue

        snap_to_palette(&mut img, &oklab, &rgba);

        assert_eq!(*img.get_pixel(0, 0), Rgba([255, 0, 0, 255]));
        assert_eq!(*img.get_pixel(1, 0), Rgba([0, 255, 0, 255]));
        assert_eq!(*img.get_pixel(2, 0), Rgba([0, 0, 255, 255]));
    }

    #[test]
    fn test_snap_preserves_alpha() {
        let palette = [[255, 0, 0]];
        let oklab = palette_to_oklab(&palette);
        let rgba = palette_to_rgba(&palette);

        let mut img = RgbaImage::new(2, 1);
        img.put_pixel(0, 0, Rgba([200, 50, 50, 128])); // Semi-transparent
        img.put_pixel(1, 0, Rgba([200, 50, 50, 0])); // Fully transparent

        snap_to_palette(&mut img, &oklab, &rgba);

        assert_eq!(img.get_pixel(0, 0)[3], 128); // Alpha preserved
        assert_eq!(img.get_pixel(1, 0)[3], 0); // Transparent pixel untouched
    }
}
