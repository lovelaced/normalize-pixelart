use image::Rgba;
use palette::{IntoColor, Oklab, Srgb};

/// Convert an RGBA pixel to Oklab color space (ignoring alpha).
pub fn rgba_to_oklab(pixel: Rgba<u8>) -> Oklab {
    let srgb = Srgb::new(
        pixel[0] as f32 / 255.0,
        pixel[1] as f32 / 255.0,
        pixel[2] as f32 / 255.0,
    );
    srgb.into_color()
}

/// Squared Euclidean distance in Oklab space.
/// Faster than full distance (avoids sqrt) and preserves ordering.
pub fn oklab_distance_sq(a: Oklab, b: Oklab) -> f32 {
    let dl = a.l - b.l;
    let da = a.a - b.a;
    let db = a.b - b.b;
    dl * dl + da * da + db * db
}

/// Euclidean distance in Oklab space.
pub fn oklab_distance(a: Oklab, b: Oklab) -> f32 {
    oklab_distance_sq(a, b).sqrt()
}

/// Compute the mean Oklab color from a slice of Oklab values.
pub fn oklab_mean(colors: &[Oklab]) -> Oklab {
    if colors.is_empty() {
        return Oklab::new(0.0, 0.0, 0.0);
    }
    let n = colors.len() as f32;
    let mut l = 0.0f32;
    let mut a = 0.0f32;
    let mut b = 0.0f32;
    for c in colors {
        l += c.l;
        a += c.a;
        b += c.b;
    }
    Oklab::new(l / n, a / n, b / n)
}

/// Compute the variance of Oklab colors around a given mean.
/// Returns the average squared distance from the mean.
pub fn oklab_variance(colors: &[Oklab], mean: Oklab) -> f32 {
    if colors.is_empty() {
        return 0.0;
    }
    let total: f32 = colors.iter().map(|c| oklab_distance_sq(*c, mean)).sum();
    total / colors.len() as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rgba_to_oklab_black() {
        let black = rgba_to_oklab(Rgba([0, 0, 0, 255]));
        assert!(black.l.abs() < 0.01);
    }

    #[test]
    fn test_rgba_to_oklab_white() {
        let white = rgba_to_oklab(Rgba([255, 255, 255, 255]));
        assert!((white.l - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_distance_same_color() {
        let c = rgba_to_oklab(Rgba([128, 64, 200, 255]));
        assert!(oklab_distance(c, c) < 1e-6);
    }

    #[test]
    fn test_distance_symmetry() {
        let a = rgba_to_oklab(Rgba([255, 0, 0, 255]));
        let b = rgba_to_oklab(Rgba([0, 0, 255, 255]));
        assert!((oklab_distance(a, b) - oklab_distance(b, a)).abs() < 1e-6);
    }

    #[test]
    fn test_mean_single() {
        let c = Oklab::new(0.5, 0.1, -0.2);
        let mean = oklab_mean(&[c]);
        assert!((mean.l - c.l).abs() < 1e-6);
        assert!((mean.a - c.a).abs() < 1e-6);
        assert!((mean.b - c.b).abs() < 1e-6);
    }

    #[test]
    fn test_variance_uniform() {
        let c = Oklab::new(0.5, 0.1, -0.2);
        let colors = vec![c; 10];
        let mean = oklab_mean(&colors);
        assert!(oklab_variance(&colors, mean) < 1e-6);
    }
}
