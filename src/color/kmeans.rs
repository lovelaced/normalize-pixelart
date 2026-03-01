use palette::Oklab;
use rand::seq::SliceRandom;
use rand::Rng;

use crate::color::oklab::oklab_distance_sq;

/// Run k-means++ clustering in OKLAB space.
///
/// Returns a Vec of `k` centroid colors.
///
/// Uses k-means++ initialization for better starting positions,
/// then runs Lloyd's algorithm until convergence.
pub fn kmeans_oklab(colors: &[Oklab], k: usize, max_iterations: usize) -> Vec<Oklab> {
    if colors.is_empty() || k == 0 {
        return Vec::new();
    }
    let k = k.min(colors.len());

    // K-means++ initialization
    let mut rng = rand::thread_rng();
    let mut centroids = kmeans_plus_plus_init(colors, k, &mut rng);

    let mut assignments = vec![0usize; colors.len()];

    for _iter in 0..max_iterations {
        // Assignment step: assign each point to nearest centroid
        let mut changed = false;
        for (i, color) in colors.iter().enumerate() {
            let nearest = nearest_centroid(*color, &centroids);
            if nearest != assignments[i] {
                assignments[i] = nearest;
                changed = true;
            }
        }

        if !changed {
            break; // Converged
        }

        // Update step: recompute centroids as mean of assigned points
        let mut sums_l = vec![0.0f64; k];
        let mut sums_a = vec![0.0f64; k];
        let mut sums_b = vec![0.0f64; k];
        let mut counts = vec![0u32; k];

        for (i, color) in colors.iter().enumerate() {
            let c = assignments[i];
            sums_l[c] += color.l as f64;
            sums_a[c] += color.a as f64;
            sums_b[c] += color.b as f64;
            counts[c] += 1;
        }

        for c in 0..k {
            if counts[c] > 0 {
                let n = counts[c] as f64;
                centroids[c] = Oklab::new(
                    (sums_l[c] / n) as f32,
                    (sums_a[c] / n) as f32,
                    (sums_b[c] / n) as f32,
                );
            }
        }
    }

    centroids
}

/// K-means++ initialization: choose k initial centroids with probability
/// proportional to squared distance from nearest existing centroid.
fn kmeans_plus_plus_init(colors: &[Oklab], k: usize, rng: &mut impl Rng) -> Vec<Oklab> {
    let mut centroids = Vec::with_capacity(k);

    // First centroid: random point
    let first = colors.choose(rng).copied().unwrap();
    centroids.push(first);

    // Subsequent centroids: weighted by distance to nearest existing centroid
    for _ in 1..k {
        let weights: Vec<f32> = colors
            .iter()
            .map(|c| {
                centroids
                    .iter()
                    .map(|cent| oklab_distance_sq(*c, *cent))
                    .fold(f32::MAX, f32::min)
            })
            .collect();

        let total: f32 = weights.iter().sum();
        if total <= 0.0 {
            // All remaining points are at existing centroids
            break;
        }

        // Weighted random selection
        let threshold = rng.gen::<f32>() * total;
        let mut cumulative = 0.0f32;
        let mut chosen = colors.len() - 1;
        for (i, &w) in weights.iter().enumerate() {
            cumulative += w;
            if cumulative >= threshold {
                chosen = i;
                break;
            }
        }
        centroids.push(colors[chosen]);
    }

    centroids
}

/// Find the index of the nearest centroid to a given color.
pub fn nearest_centroid(color: Oklab, centroids: &[Oklab]) -> usize {
    centroids
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| {
            oklab_distance_sq(color, **a)
                .partial_cmp(&oklab_distance_sq(color, **b))
                .unwrap()
        })
        .map(|(i, _)| i)
        .unwrap_or(0)
}

/// Subsample colors for faster k-means on large images.
/// Takes at most `max_samples` random samples from the input.
pub fn subsample(colors: &[Oklab], max_samples: usize) -> Vec<Oklab> {
    if colors.len() <= max_samples {
        return colors.to_vec();
    }
    let mut rng = rand::thread_rng();
    let mut indices: Vec<usize> = (0..colors.len()).collect();
    indices.shuffle(&mut rng);
    indices.truncate(max_samples);
    indices.iter().map(|&i| colors[i]).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kmeans_two_clusters() {
        // Create two distinct clusters: around (0.3, 0, 0) and (0.7, 0, 0)
        let mut colors = Vec::new();
        for _ in 0..50 {
            colors.push(Oklab::new(0.3, 0.0, 0.0));
        }
        for _ in 0..50 {
            colors.push(Oklab::new(0.7, 0.0, 0.0));
        }

        let centroids = kmeans_oklab(&colors, 2, 50);
        assert_eq!(centroids.len(), 2);

        // Centroids should be near 0.3 and 0.7
        let mut ls: Vec<f32> = centroids.iter().map(|c| c.l).collect();
        ls.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert!((ls[0] - 0.3).abs() < 0.05);
        assert!((ls[1] - 0.7).abs() < 0.05);
    }

    #[test]
    fn test_kmeans_single_color() {
        let colors = vec![Oklab::new(0.5, 0.1, -0.1); 100];
        let centroids = kmeans_oklab(&colors, 3, 50);
        // Should still produce centroids (some may be duplicates)
        assert!(!centroids.is_empty());
    }

    #[test]
    fn test_nearest_centroid() {
        let centroids = vec![
            Oklab::new(0.2, 0.0, 0.0),
            Oklab::new(0.8, 0.0, 0.0),
        ];
        assert_eq!(nearest_centroid(Oklab::new(0.25, 0.0, 0.0), &centroids), 0);
        assert_eq!(nearest_centroid(Oklab::new(0.75, 0.0, 0.0), &centroids), 1);
    }

    #[test]
    fn test_subsample() {
        let colors: Vec<Oklab> = (0..1000)
            .map(|i| Oklab::new(i as f32 / 1000.0, 0.0, 0.0))
            .collect();
        let sampled = subsample(&colors, 100);
        assert_eq!(sampled.len(), 100);
    }
}
