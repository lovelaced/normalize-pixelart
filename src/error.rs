use thiserror::Error;

#[derive(Debug, Error)]
pub enum NormalizeError {
    #[error("Failed to load image: {0}")]
    ImageLoad(#[from] image::ImageError),

    #[error("Grid detection failed: {0}")]
    GridDetection(String),

    #[error("Invalid grid size {0}: must be >= 2")]
    InvalidGridSize(u32),

    #[error("Image too small ({width}x{height}) for grid size {grid_size}")]
    ImageTooSmall {
        width: u32,
        height: u32,
        grid_size: u32,
    },

    #[error("No output pixels: image dimensions ({width}x{height}) with grid size {grid_size} produce 0 output pixels")]
    NoOutputPixels {
        width: u32,
        height: u32,
        grid_size: u32,
    },

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}
