use image::{Rgba, RgbaImage};
use std::collections::HashMap;

/// A color histogram that counts occurrences of each unique RGBA color.
#[derive(Debug, Clone)]
pub struct ColorHistogram {
    counts: HashMap<[u8; 4], u32>,
}

impl ColorHistogram {
    /// Build a histogram from all pixels in an image.
    pub fn from_image(image: &RgbaImage) -> Self {
        let mut counts = HashMap::new();
        for pixel in image.pixels() {
            *counts.entry(pixel.0).or_insert(0) += 1;
        }
        Self { counts }
    }

    /// Build a histogram from a rectangular region of an image.
    pub fn from_block(image: &RgbaImage, x: u32, y: u32, width: u32, height: u32) -> Self {
        let mut counts = HashMap::new();
        let img_w = image.width();
        let img_h = image.height();
        for dy in 0..height {
            for dx in 0..width {
                let px = x + dx;
                let py = y + dy;
                if px < img_w && py < img_h {
                    let pixel = image.get_pixel(px, py);
                    *counts.entry(pixel.0).or_insert(0) += 1;
                }
            }
        }
        Self { counts }
    }

    /// Get the most common color (mode). Returns None if empty.
    pub fn mode(&self) -> Option<Rgba<u8>> {
        self.counts
            .iter()
            .max_by_key(|(_, count)| *count)
            .map(|(color, _)| Rgba(*color))
    }

    /// Get the top N most common colors, sorted by frequency (descending).
    pub fn top_n(&self, n: usize) -> Vec<(Rgba<u8>, u32)> {
        let mut entries: Vec<_> = self
            .counts
            .iter()
            .map(|(color, count)| (Rgba(*color), *count))
            .collect();
        entries.sort_by(|a, b| b.1.cmp(&a.1));
        entries.truncate(n);
        entries
    }

    /// Number of unique colors in the histogram.
    pub fn unique_colors(&self) -> usize {
        self.counts.len()
    }

    /// Total number of pixels counted.
    pub fn total_pixels(&self) -> u32 {
        self.counts.values().sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_histogram_mode() {
        let mut img = RgbaImage::new(4, 4);
        // Fill with red
        for pixel in img.pixels_mut() {
            *pixel = Rgba([255, 0, 0, 255]);
        }
        // Set one pixel to blue
        img.put_pixel(0, 0, Rgba([0, 0, 255, 255]));

        let hist = ColorHistogram::from_image(&img);
        assert_eq!(hist.mode(), Some(Rgba([255, 0, 0, 255])));
        assert_eq!(hist.unique_colors(), 2);
        assert_eq!(hist.total_pixels(), 16);
    }

    #[test]
    fn test_histogram_block() {
        let mut img = RgbaImage::new(8, 8);
        for pixel in img.pixels_mut() {
            *pixel = Rgba([0, 0, 0, 255]);
        }
        // Fill top-left 4x4 with white
        for y in 0..4 {
            for x in 0..4 {
                img.put_pixel(x, y, Rgba([255, 255, 255, 255]));
            }
        }

        let hist = ColorHistogram::from_block(&img, 0, 0, 4, 4);
        assert_eq!(hist.mode(), Some(Rgba([255, 255, 255, 255])));
        assert_eq!(hist.total_pixels(), 16);
        assert_eq!(hist.unique_colors(), 1);
    }

    #[test]
    fn test_top_n() {
        let mut img = RgbaImage::new(4, 1);
        img.put_pixel(0, 0, Rgba([255, 0, 0, 255]));
        img.put_pixel(1, 0, Rgba([255, 0, 0, 255]));
        img.put_pixel(2, 0, Rgba([0, 255, 0, 255]));
        img.put_pixel(3, 0, Rgba([0, 0, 255, 255]));

        let hist = ColorHistogram::from_image(&img);
        let top = hist.top_n(2);
        assert_eq!(top.len(), 2);
        assert_eq!(top[0].0, Rgba([255, 0, 0, 255]));
        assert_eq!(top[0].1, 2);
    }
}
