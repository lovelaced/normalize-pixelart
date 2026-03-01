use anyhow::{Context, Result};
use image::RgbaImage;
use std::path::Path;

/// Load an image from disk, converting to RGBA8.
pub fn load_image(path: &Path) -> Result<RgbaImage> {
    let img = image::open(path)
        .with_context(|| format!("Failed to open image: {}", path.display()))?;
    Ok(img.to_rgba8())
}

/// Save an RGBA image to disk. Format is inferred from the extension.
pub fn save_image(image: &RgbaImage, path: &Path) -> Result<()> {
    image
        .save(path)
        .with_context(|| format!("Failed to save image: {}", path.display()))?;
    Ok(())
}
