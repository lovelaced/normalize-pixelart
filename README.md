```
        _       __ _
  _ __ (_)_  __/ _(_)_  __
 | '_ \| \ \/ / |_| \ \/ /
 | |_) | |>  <|  _| |>  <
 | .__/|_/_/\_\_| |_/_/\_\
 |_|
```

<div align="center">

**Clean up AI-generated pixel art.**<br>
Snap to grid. Remove AA fuzz. Reduce to a palette. Remove backgrounds.

[![CI](https://github.com/lovelaced/normalize-pixelart/actions/workflows/ci.yml/badge.svg)](https://github.com/lovelaced/normalize-pixelart/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/lovelaced/normalize-pixelart?include_prereleases&label=release)](https://github.com/lovelaced/normalize-pixelart/releases)

[Download](#install) · [Features](#features) · [CLI Reference](#cli-reference) · [How It Works](#how-it-works)

</div>

<br>

<p align="center">
  <img src="screenshots/welcome.png" width="720" alt="pixfix welcome screen">
</p>

<p align="center">
  <img src="screenshots/settings.png" width="720" alt="pixfix settings with live preview">
</p>

<br>

---

AI image generators produce "pixel art" riddled with **mixels** (mixed-resolution pixels), anti-aliasing artifacts, and colors that don't snap to any grid. pixfix takes that messy output and produces clean, uniform pixel art — while preserving the vibrancy and character of the original.

Available as a **native desktop app** (macOS, Windows, Linux) and a **CLI tool** for scripting and automation.

---

## Features

<table>
<tr>
<td width="50%" valign="top">

**Desktop App**

- Side-by-side original / processed preview
- Live settings — tweak parameters, see results instantly
- Grid detection diagnostics and color histograms
- 3000+ palettes via Lospec, or load custom `.hex` files
- Sprite sheet auto-splitter with GIF animation export
- Batch processing — drag in a folder, process everything
- Full keyboard navigation

</td>
<td width="50%" valign="top">

**Processing Pipeline**

- Auto-detect pixel grid size and phase offset
- Snap mode — enforces clean grid at original resolution
- Multiple downscale modes (center-weighted, majority-vote, center-pixel)
- OKLAB color quantization — perceptually accurate palette matching
- Anti-aliasing removal via triangle inequality in OKLAB space
- Background removal — flood-fill or global replacement
- Output resize — upscale for game engines (2x, 3x...)

</td>
</tr>
</table>

---

## Install

### Desktop App

Download the latest release for your platform:

<div align="center">

| Platform | Download |
|:---------|:---------|
| **macOS** (Apple Silicon) | [`.dmg`](https://github.com/lovelaced/normalize-pixelart/releases/latest) |
| **macOS** (Intel) | [`.dmg`](https://github.com/lovelaced/normalize-pixelart/releases/latest) |
| **Windows** | [`.msi`](https://github.com/lovelaced/normalize-pixelart/releases/latest) · [`.exe` installer](https://github.com/lovelaced/normalize-pixelart/releases/latest) |
| **Linux** | [`.deb`](https://github.com/lovelaced/normalize-pixelart/releases/latest) · [`.AppImage`](https://github.com/lovelaced/normalize-pixelart/releases/latest) |

</div>

### CLI

```bash
# From source (requires Rust 1.70+)
git clone https://github.com/lovelaced/normalize-pixelart.git
cd normalize-pixelart
cargo build --release

# Binary at target/release/normalize-pixelart
```

Pre-built CLI binaries for all platforms are also available on the [Releases](https://github.com/lovelaced/normalize-pixelart/releases) page.

---

## Desktop App

### Keyboard Shortcuts

| Key | Action |
|:---:|--------|
| <kbd>O</kbd> | Open image |
| <kbd>S</kbd> | Save processed image |
| <kbd>Space</kbd> | Reprocess with current settings |
| <kbd>R</kbd> | Reset settings to defaults |
| <kbd>Tab</kbd> | Switch tabs |
| <kbd>Esc</kbd> | Back to Preview |

### Tabs

| Tab | What it does |
|-----|-------------|
| **Preview** | Side-by-side original vs. processed |
| **Settings** | All pipeline parameters with live preview |
| **Diagnostics** | Grid detection scores, color histogram |
| **Batch** | Process multiple images at once |
| **Sheet** | Split sprite sheets, normalize tiles, export GIFs |

---

## CLI Quick Start

```bash
# Auto-detect grid, normalize
normalize-pixelart process input.png output.png

# Force grid size, snap to PICO-8 palette
normalize-pixelart process input.png output.png --grid-size 4 --palette pico-8

# Remove background
normalize-pixelart process input.png output.png --grid-size 4 --remove-bg

# Batch process a folder
normalize-pixelart batch sprites/ output/ --grid-size 4 --palette sweetie-16

# Auto-split an AI sprite sheet
normalize-pixelart sheet ai_sheet.png --output-dir sprites/

# Interactive terminal editor (Sixel/halfblock preview)
normalize-pixelart tui input.png
```

---

## How It Works

```
Input Image
    │
    ▼
┌─────────────────┐
│  Grid Detection  │  Find NxN pixel grid size and phase offset
└────────┬────────┘
         ▼
┌─────────────────┐
│   AA Removal     │  Remove anti-aliasing artifacts (optional)
└────────┬────────┘
         ▼
┌─────────────────┐
│ Grid Normalize   │  Snap/downscale pixels to the detected grid
└────────┬────────┘
         ▼
┌─────────────────┐
│   Quantize       │  Snap colors to a palette (optional)
└────────┬────────┘
         ▼
┌─────────────────┐
│  Background Rm   │  Remove solid backgrounds (optional)
└────────┬────────┘
         ▼
┌─────────────────┐
│  Final Resize    │  Scale to output dimensions if needed
└────────┬────────┘
         ▼
    Output Image
```

<details>
<summary><strong>Grid Detection</strong></summary>
<br>

For each candidate grid size (2..max), measures **edge alignment** — the ratio of color gradients at grid boundaries vs. non-boundary positions. The correct grid size maximizes this ratio because all real color transitions align to its grid lines. Phase detection scans all possible offsets to find where the grid starts, even when `--grid-size` is manually set.

</details>

<details>
<summary><strong>Snap Mode (Default)</strong></summary>
<br>

For each NxN block, finds the dominant color via center-weighted majority voting and paints every pixel in the block with that single color. Eliminates mixels and stray pixels while preserving dithering patterns across blocks (adjacent blocks can still have different colors). The output stays at the original resolution.

</details>

<details>
<summary><strong>Color Quantization (OKLAB)</strong></summary>
<br>

All color operations use **OKLAB color space**, which is perceptually uniform — Euclidean distance in OKLAB closely matches how humans see color differences. K-means clustering produces vibrant, meaningful centroids instead of muddy averages. Palette snapping picks the perceptually closest match.

</details>

<details>
<summary><strong>Anti-Aliasing Removal</strong></summary>
<br>

For each pixel, examines its 8-connected neighbors. If the pixel lies "between" the two most dominant neighbor colors in OKLAB space (triangle inequality test), it's identified as an AA artifact and snapped to the closer neighbor. Off by default — AI art has intentional edge detail that this can destroy.

</details>

---

## CLI Reference

### `process` — Normalize a single image

```
normalize-pixelart process [OPTIONS] <INPUT> [OUTPUT]
```

Output defaults to `<input>_normalized.png`.

<details>
<summary><strong>All options</strong></summary>
<br>

**Grid**

| Flag | Description |
|------|-------------|
| `--grid-size <N>` | Override auto-detected grid size |
| `--grid-phase <X,Y>` | Override grid phase offset |
| `--no-grid-detect` | Skip grid detection (requires `--grid-size`) |
| `--max-grid-candidate <N>` | Max grid size to test (default: 32) |

**Downscale**

| Mode | Description |
|------|-------------|
| `snap` | **Default.** Clean grid at original resolution. Best for AI art. |
| `center-weighted` | Reduce to logical resolution, center pixels weighted more. |
| `majority-vote` | Reduce to logical resolution, most common color wins. |
| `center-pixel` | Reduce to logical resolution, center pixel only. Fastest. |

**Color**

| Flag | Description |
|------|-------------|
| `--palette <NAME>` | Built-in palette (pico-8, sweetie-16, endesga-32, endesga-64, gameboy, nes) |
| `--palette-file <PATH>` | Custom `.hex` palette file |
| `--lospec <SLUG>` | Fetch palette from [Lospec](https://lospec.com) by slug |
| `--colors <N>` | Auto-extract N colors via k-means |
| `--no-quantize` | Skip quantization |

**Background**

| Flag | Description |
|------|-------------|
| `--remove-bg` | Enable background removal |
| `--bg-color <HEX>` | Explicit background color |
| `--bg-threshold <0-1>` | Border detection threshold (default: 0.4) |
| `--bg-tolerance <N>` | Color tolerance in OKLAB (default: 0.05) |
| `--no-flood-fill` | Global replacement instead of flood-fill |

**Output**

| Flag | Description |
|------|-------------|
| `--target-width <N>` | Output width |
| `--target-height <N>` | Output height |
| `--aa-threshold <0-1>` | Enable AA removal (off by default) |
| `--overwrite` | Overwrite existing output |

</details>

### `batch` — Process multiple images

```
normalize-pixelart batch [OPTIONS] <INPUT> <OUTPUT_DIR>
```

`INPUT` can be a directory or glob pattern. All `process` flags available.

### `sheet` — Sprite sheet processing

```
normalize-pixelart sheet [OPTIONS] <INPUT> [OUTPUT]
```

**Fixed grid** — specify `--tile-width` and `--tile-height` for known layouts.
**Auto-split** — omit tile dimensions to auto-detect sprite boundaries.

<details>
<summary><strong>Sheet options</strong></summary>
<br>

| Flag | Description |
|------|-------------|
| `--tile-width <N>` / `--tile-height <N>` | Fixed tile size (omit for auto-split) |
| `--spacing <N>` | Gap between tiles (default: 0) |
| `--margin <N>` | Sheet border (default: 0) |
| `--separator-threshold <0-1>` | Auto-split separator detection (default: 0.90) |
| `--min-sprite-size <N>` | Filter small artifacts (default: 8) |
| `--pad <N>` | Output padding per sprite (default: 0) |
| `--output-dir <PATH>` | Save individual tiles |
| `--no-normalize` | Split/reassemble only |

</details>

### `tui` — Interactive terminal editor

```bash
normalize-pixelart tui [INPUT]
```

Terminal UI with live image preview (Sixel/halfblock). Requires the `tui` feature (default).

### `palette` — Palette utilities

```bash
normalize-pixelart palette list                        # Show built-in palettes
normalize-pixelart palette fetch endesga-32            # Download from Lospec
normalize-pixelart palette extract input.png -o p.hex  # Extract from image
```

---

## Config File

Save settings in `.normalize-pixelart.toml` — CLI arguments override config values.

<details>
<summary><strong>Example config</strong></summary>

```toml
[grid]
size = 4
max_candidate = 16

[aa]
threshold = 0.3

[quantize]
palette = "pico-8"

[background]
enabled = true
color = "FF00FF"
flood_fill = true

[output]
overwrite = false
```

</details>

---

<div align="center">

**Performance** — parallelized via rayon. Grid detection, AA removal, batch mode, and sprite sheet tiles all process in parallel. A 1024x1024 image typically completes in under 1 second.

<br>

MIT License

</div>
