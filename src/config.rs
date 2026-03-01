use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::Path;

/// TOML configuration file structure.
/// All fields are optional — CLI args override anything set here.
#[derive(Debug, Deserialize, Default)]
pub struct ConfigFile {
    #[serde(default)]
    pub grid: GridConfig,
    #[serde(default)]
    pub aa: AaConfig,
    #[serde(default)]
    pub quantize: QuantizeFileConfig,
    #[serde(default)]
    pub background: BackgroundFileConfig,
    #[serde(default)]
    pub output: OutputConfig,
}

#[derive(Debug, Deserialize, Default)]
pub struct GridConfig {
    pub size: Option<u32>,
    pub phase_x: Option<u32>,
    pub phase_y: Option<u32>,
    pub max_candidate: Option<u32>,
    pub skip: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
pub struct AaConfig {
    pub threshold: Option<f32>,
    pub skip: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
pub struct QuantizeFileConfig {
    pub colors: Option<u32>,
    pub palette: Option<String>,
    pub skip: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
pub struct BackgroundFileConfig {
    pub enabled: Option<bool>,
    pub color: Option<String>,
    pub border_threshold: Option<f32>,
    pub color_tolerance: Option<f32>,
    pub flood_fill: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
pub struct OutputConfig {
    pub overwrite: Option<bool>,
}

/// Default config file name.
pub const CONFIG_FILE_NAME: &str = ".normalize-pixelart.toml";

/// Try to load a config file. Returns Default if not found.
pub fn load_config(path: Option<&Path>) -> Result<ConfigFile> {
    let path = if let Some(p) = path {
        p.to_path_buf()
    } else {
        // Look in current directory
        let cwd_config = Path::new(CONFIG_FILE_NAME).to_path_buf();
        if !cwd_config.exists() {
            return Ok(ConfigFile::default());
        }
        cwd_config
    };

    if !path.exists() {
        return Ok(ConfigFile::default());
    }

    let content = std::fs::read_to_string(&path)
        .with_context(|| format!("Failed to read config file: {}", path.display()))?;

    let config: ConfigFile = toml::from_str(&content)
        .with_context(|| format!("Failed to parse config file: {}", path.display()))?;

    Ok(config)
}

/// Parse a hex color string like "#FF0000" or "FF0000" into [r, g, b].
pub fn parse_hex_color(s: &str) -> Result<[u8; 3], String> {
    let s = s.trim().trim_start_matches('#');
    if s.len() != 6 {
        return Err(format!("Invalid hex color '{}': must be 6 hex digits", s));
    }
    let r = u8::from_str_radix(&s[0..2], 16)
        .map_err(|e| format!("Invalid hex color '{}': {}", s, e))?;
    let g = u8::from_str_radix(&s[2..4], 16)
        .map_err(|e| format!("Invalid hex color '{}': {}", s, e))?;
    let b = u8::from_str_radix(&s[4..6], 16)
        .map_err(|e| format!("Invalid hex color '{}': {}", s, e))?;
    Ok([r, g, b])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_hex_color() {
        assert_eq!(parse_hex_color("#FF0000"), Ok([255, 0, 0]));
        assert_eq!(parse_hex_color("00FF00"), Ok([0, 255, 0]));
        assert_eq!(parse_hex_color("#1a2b3c"), Ok([0x1a, 0x2b, 0x3c]));
    }

    #[test]
    fn test_parse_hex_color_invalid() {
        assert!(parse_hex_color("FFF").is_err());
        assert!(parse_hex_color("GGGGGG").is_err());
    }

    #[test]
    fn test_parse_config_toml() {
        let toml_str = r#"
[grid]
max_candidate = 16

[aa]
threshold = 0.3

[quantize]
colors = 16
palette = "pico-8"

[background]
enabled = true
border_threshold = 0.5
"#;
        let config: ConfigFile = toml::from_str(toml_str).unwrap();
        assert_eq!(config.grid.max_candidate, Some(16));
        assert_eq!(config.aa.threshold, Some(0.3));
        assert_eq!(config.quantize.colors, Some(16));
        assert_eq!(config.quantize.palette, Some("pico-8".to_string()));
        assert_eq!(config.background.enabled, Some(true));
    }

    #[test]
    fn test_empty_config() {
        let config: ConfigFile = toml::from_str("").unwrap();
        assert!(config.grid.size.is_none());
        assert!(config.aa.threshold.is_none());
    }

    #[test]
    fn test_load_missing_file() {
        let config = load_config(Some(Path::new("/nonexistent/config.toml"))).unwrap();
        assert!(config.grid.size.is_none());
    }
}
