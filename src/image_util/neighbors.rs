use image::{Rgba, RgbaImage};

/// The 8 directions for 8-connected neighborhood.
const OFFSETS: [(i32, i32); 8] = [
    (-1, -1),
    (0, -1),
    (1, -1),
    (-1, 0),
    (1, 0),
    (-1, 1),
    (0, 1),
    (1, 1),
];

/// Get the 8-connected neighbors of a pixel at (x, y).
/// Returns a Vec of (color, count) for each unique neighbor color,
/// sorted by count descending.
pub fn neighbor_colors(image: &RgbaImage, x: u32, y: u32) -> Vec<(Rgba<u8>, u32)> {
    let w = image.width() as i32;
    let h = image.height() as i32;
    let ix = x as i32;
    let iy = y as i32;

    let mut counts: Vec<([u8; 4], u32)> = Vec::new();

    for &(dx, dy) in &OFFSETS {
        let nx = ix + dx;
        let ny = iy + dy;
        if nx >= 0 && nx < w && ny >= 0 && ny < h {
            let pixel = image.get_pixel(nx as u32, ny as u32).0;
            if let Some(entry) = counts.iter_mut().find(|(c, _)| *c == pixel) {
                entry.1 += 1;
            } else {
                counts.push((pixel, 1));
            }
        }
    }

    counts.sort_by(|a, b| b.1.cmp(&a.1));
    counts.into_iter().map(|(c, n)| (Rgba(c), n)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_neighbor_colors_uniform() {
        let img = RgbaImage::from_pixel(3, 3, Rgba([255, 0, 0, 255]));
        let neighbors = neighbor_colors(&img, 1, 1);
        assert_eq!(neighbors.len(), 1);
        assert_eq!(neighbors[0].0, Rgba([255, 0, 0, 255]));
        assert_eq!(neighbors[0].1, 8);
    }

    #[test]
    fn test_neighbor_colors_corner() {
        let img = RgbaImage::from_pixel(3, 3, Rgba([255, 0, 0, 255]));
        let neighbors = neighbor_colors(&img, 0, 0);
        // Corner has only 3 neighbors
        assert_eq!(neighbors[0].1, 3);
    }

    #[test]
    fn test_neighbor_colors_mixed() {
        let mut img = RgbaImage::from_pixel(3, 3, Rgba([255, 0, 0, 255]));
        img.put_pixel(0, 0, Rgba([0, 0, 255, 255]));
        img.put_pixel(1, 0, Rgba([0, 0, 255, 255]));
        let neighbors = neighbor_colors(&img, 1, 1);
        // Should have red (majority) and blue
        assert_eq!(neighbors.len(), 2);
        assert_eq!(neighbors[0].0, Rgba([255, 0, 0, 255])); // 6 red
        assert_eq!(neighbors[1].0, Rgba([0, 0, 255, 255])); // 2 blue
    }
}
