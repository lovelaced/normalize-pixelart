//! Batch processing: normalize multiple images in parallel.

use std::path::{Path, PathBuf};

use anyhow::Result;
use indicatif::{ProgressBar, ProgressStyle};
use rayon::prelude::*;

use crate::image_util::io::{load_image, save_image};
use crate::pipeline::{run_pipeline, PipelineConfig};

/// Result of a batch processing run.
pub struct BatchResult {
    pub succeeded: u32,
    pub failed: Vec<(PathBuf, String)>,
}

/// Resolve a glob pattern or directory path into a list of image files.
pub fn resolve_inputs(pattern: &str) -> Result<Vec<PathBuf>> {
    let path = Path::new(pattern);

    // If it's a directory, glob for common image extensions inside it
    if path.is_dir() {
        let mut files = Vec::new();
        for ext in &["png", "jpg", "jpeg", "gif", "bmp", "webp"] {
            let glob_pattern = format!("{}/*.{}", path.display(), ext);
            for entry in glob::glob(&glob_pattern)? {
                files.push(entry?);
            }
        }
        files.sort();
        return Ok(files);
    }

    // Otherwise treat as a glob pattern
    let mut files: Vec<PathBuf> = glob::glob(pattern)?
        .filter_map(|e| e.ok())
        .filter(|p| p.is_file())
        .collect();
    files.sort();
    Ok(files)
}

/// Compute the output path for a batch-processed file.
fn output_path_for(input: &Path, output_dir: &Path) -> PathBuf {
    let stem = input
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    let ext = input
        .extension()
        .unwrap_or_default()
        .to_string_lossy();
    let ext = if ext.is_empty() { "png" } else { &ext };
    output_dir.join(format!("{}_normalized.{}", stem, ext))
}

/// Process multiple images in parallel with a shared pipeline config.
pub fn run_batch(
    inputs: &[PathBuf],
    output_dir: &Path,
    config: &PipelineConfig,
    overwrite: bool,
) -> Result<BatchResult> {
    let bar = ProgressBar::new(inputs.len() as u64);
    bar.set_style(
        ProgressStyle::default_bar()
            .template("[{elapsed_precise}] {bar:40.cyan/blue} {pos}/{len} {msg}")
            .unwrap()
            .progress_chars("##-"),
    );

    let results: Vec<Result<(), (PathBuf, String)>> = inputs
        .par_iter()
        .map(|input_path| {
            let out = output_path_for(input_path, output_dir);

            if out.exists() && !overwrite {
                bar.inc(1);
                return Err((
                    input_path.clone(),
                    format!("Output already exists: {}", out.display()),
                ));
            }

            let result = (|| -> Result<(), String> {
                let image = load_image(input_path)
                    .map_err(|e| format!("Failed to load: {}", e))?;
                let state = run_pipeline(image, config)
                    .map_err(|e| format!("Pipeline failed: {}", e))?;
                save_image(&state.image, &out)
                    .map_err(|e| format!("Failed to save: {}", e))?;
                Ok(())
            })();

            bar.inc(1);

            match result {
                Ok(()) => {
                    bar.set_message(format!(
                        "{}",
                        input_path.file_name().unwrap_or_default().to_string_lossy()
                    ));
                    Ok(())
                }
                Err(e) => Err((input_path.clone(), e)),
            }
        })
        .collect();

    bar.finish_with_message("done");

    let mut succeeded = 0u32;
    let mut failed = Vec::new();
    for r in results {
        match r {
            Ok(()) => succeeded += 1,
            Err(e) => failed.push(e),
        }
    }

    Ok(BatchResult { succeeded, failed })
}
