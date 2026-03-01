//! Fetch palettes from the Lospec palette database (https://lospec.com).
//!
//! Palettes are cached locally at `~/.cache/normalize-pixelart/palettes/{slug}.hex`
//! to avoid repeated network requests.

use std::path::PathBuf;

/// Result of a Lospec palette fetch.
pub struct LospecPalette {
    pub name: String,
    pub slug: String,
    pub colors: Vec<[u8; 3]>,
}

/// Fetch a palette from Lospec by slug (e.g. "pico-8", "sweetie-16").
///
/// Checks the local cache first. On cache miss, fetches from the Lospec API
/// and saves to cache for future use.
pub fn fetch_lospec_palette(slug: &str) -> Result<LospecPalette, String> {
    // Check cache first
    if let Some(cached) = load_cached(slug) {
        return Ok(cached);
    }

    // Fetch from API
    let url = format!("https://lospec.com/palette-list/{}.json", slug);

    let response = ureq::get(&url)
        .call()
        .map_err(|e| match &e {
            ureq::Error::StatusCode(404) => {
                format!("Palette '{}' not found on Lospec. Check the slug at https://lospec.com/palette-list", slug)
            }
            _ => format!("Failed to fetch palette from Lospec: {}", e),
        })?;

    let body = response
        .into_body()
        .read_to_string()
        .map_err(|e| format!("Failed to read Lospec response: {}", e))?;

    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse Lospec JSON: {}", e))?;

    let name = json["name"]
        .as_str()
        .unwrap_or(slug)
        .to_string();

    let colors_arr = json["colors"]
        .as_array()
        .ok_or_else(|| "Lospec response missing 'colors' array".to_string())?;

    let mut colors = Vec::with_capacity(colors_arr.len());
    for (i, val) in colors_arr.iter().enumerate() {
        let hex = val
            .as_str()
            .ok_or_else(|| format!("Color at index {} is not a string", i))?;
        let rgb = parse_hex_rgb(hex)?;
        colors.push(rgb);
    }

    if colors.is_empty() {
        return Err(format!("Palette '{}' has no colors", slug));
    }

    // Cache for future use
    let _ = save_to_cache(slug, &name, &colors);

    Ok(LospecPalette {
        name,
        slug: slug.to_string(),
        colors,
    })
}

/// Parse a hex color string (with or without '#') into [R, G, B].
fn parse_hex_rgb(hex: &str) -> Result<[u8; 3], String> {
    let hex = hex.trim().trim_start_matches('#');
    if hex.len() != 6 {
        return Err(format!("Invalid hex color: '{}' (expected 6 hex digits)", hex));
    }
    let r = u8::from_str_radix(&hex[0..2], 16)
        .map_err(|_| format!("Invalid hex color: '{}'", hex))?;
    let g = u8::from_str_radix(&hex[2..4], 16)
        .map_err(|_| format!("Invalid hex color: '{}'", hex))?;
    let b = u8::from_str_radix(&hex[4..6], 16)
        .map_err(|_| format!("Invalid hex color: '{}'", hex))?;
    Ok([r, g, b])
}

/// Get the cache directory path.
fn cache_dir() -> Option<PathBuf> {
    dirs::cache_dir().map(|d| d.join("normalize-pixelart").join("palettes"))
}

/// Try to load a cached palette.
fn load_cached(slug: &str) -> Option<LospecPalette> {
    let dir = cache_dir()?;
    let path = dir.join(format!("{}.hex", slug));
    let content = std::fs::read_to_string(&path).ok()?;

    let mut colors = Vec::new();
    let mut name = slug.to_string();

    for line in content.lines() {
        let line = line.trim();
        if line.starts_with("; name: ") {
            name = line.trim_start_matches("; name: ").to_string();
            continue;
        }
        if line.is_empty() || line.starts_with(';') || line.starts_with("//") {
            continue;
        }
        if let Ok(rgb) = parse_hex_rgb(line) {
            colors.push(rgb);
        }
    }

    if colors.is_empty() {
        return None;
    }

    Some(LospecPalette {
        name,
        slug: slug.to_string(),
        colors,
    })
}

/// Save a palette to the cache directory.
fn save_to_cache(slug: &str, name: &str, colors: &[[u8; 3]]) -> Result<(), String> {
    let dir = cache_dir().ok_or_else(|| "Could not determine cache directory".to_string())?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create cache directory: {}", e))?;

    let path = dir.join(format!("{}.hex", slug));
    let mut content = format!("; name: {}\n; fetched from https://lospec.com/palette-list/{}\n", name, slug);
    for color in colors {
        content.push_str(&format!("{:02X}{:02X}{:02X}\n", color[0], color[1], color[2]));
    }

    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write cache file: {}", e))?;

    Ok(())
}

/// Format palette colors for display.
pub fn format_palette(palette: &LospecPalette) -> String {
    let mut out = format!("{} ({} colors)\n", palette.name, palette.colors.len());
    for color in &palette.colors {
        out.push_str(&format!("  #{:02X}{:02X}{:02X}\n", color[0], color[1], color[2]));
    }
    out
}

/// Export palette as .hex file content.
pub fn palette_to_hex_string(palette: &LospecPalette) -> String {
    let mut content = String::new();
    for color in &palette.colors {
        content.push_str(&format!("{:02X}{:02X}{:02X}\n", color[0], color[1], color[2]));
    }
    content
}
