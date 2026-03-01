# normalize-pixelart

A fast Rust CLI tool that normalizes AI-generated pixel art into clean, grid-aligned game assets.

AI image generators produce "pixel art" riddled with **mixels** (mixed-resolution pixels), anti-aliasing artifacts, and colors that don't snap to any grid. This tool takes that messy output and produces clean, uniform pixel art — while preserving the vibrancy and character of the original.

## Features

- **Grid detection** — automatically finds the pixel grid size and phase offset in upscaled art
- **Grid snapping** — enforces a clean pixel grid at original resolution, eliminating mixels
- **Phase alignment** — auto-detects optimal grid offset so block boundaries align with real edges
- **Color quantization** — snap to built-in palettes (PICO-8, Sweetie-16, etc.) or auto-extract palettes via k-means in OKLAB space
- **Anti-aliasing removal** — detects and removes interpolation artifacts between pixel boundaries
- **Background removal** — auto-detect and remove solid backgrounds via flood-fill or global replacement
- **Config files** — save your settings in `.normalize-pixelart.toml`
- **Fast** — parallel processing via rayon; handles 1024x1024 images in under a second

## Installation

```bash
# Clone and build from source
git clone https://github.com/your-username/normalize-pixelart.git
cd normalize-pixelart
cargo build --release

# Binary will be at target/release/normalize-pixelart
```

Requires Rust 1.70+.

## Quick Start

```bash
# Basic usage — auto-detect grid, output same size as input
normalize-pixelart process input.png output.png

# Specify grid size (pixels per logical pixel)
normalize-pixelart process input.png output.png --grid-size 4

# Snap to PICO-8 palette
normalize-pixelart process input.png output.png --grid-size 4 --palette pico-8

# Remove background
normalize-pixelart process input.png output.png --grid-size 4 --remove-bg

# Verbose output to see what's happening
normalize-pixelart process input.png output.png --grid-size 4 -vv
```

## How It Works

The tool runs a multi-stage pipeline on each image:

```
Input Image
    │
    ▼
┌─────────────────┐
│  Grid Detection  │  Find the NxN pixel grid size and phase offset
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

### Grid Detection

For each candidate grid size (2..max), the tool measures **edge alignment**: the ratio of color gradients at grid boundaries vs. non-boundary positions. The correct grid size maximizes this ratio because all color transitions align to its grid lines.

Phase detection scans all possible offsets to find where the grid starts. This runs automatically even when you override `--grid-size`, so block boundaries align with the real edges in your image.

### Grid Normalization (Snap Mode)

The default **snap** mode enforces a clean grid at original resolution. For each NxN block:

1. Find the dominant color using center-weighted majority voting
2. Paint every pixel in the block with that single color

This eliminates mixels and stray pixels while preserving dithering patterns across blocks (adjacent blocks can have different colors). The output stays at the original resolution — a 1024x1024 input produces a 1024x1024 output.

### Color Quantization

All color operations use **OKLAB color space**, which is perceptually uniform — Euclidean distance in OKLAB closely matches how humans perceive color differences. This means:

- K-means clustering produces vibrant, meaningful centroids (not muddy averages)
- Palette snapping picks the perceptually closest match
- Anti-aliasing detection accurately identifies interpolated pixels

### Anti-Aliasing Removal

For each pixel, examines its 8-connected neighbors. If the pixel lies "between" the two most dominant neighbor colors in OKLAB space (triangle inequality test), it's identified as an AA artifact and snapped to the closer neighbor.

**Off by default** for AI art, which has intentional edge detail that this can destroy. Enable with `--aa-threshold` when processing cleanly upscaled pixel art.

## Commands

### `process` — Normalize a single image

```
normalize-pixelart process [OPTIONS] <INPUT> [OUTPUT]
```

Output defaults to `<input>_normalized.png` if not specified.

#### Grid Detection Options

| Flag | Description |
|------|-------------|
| `--grid-size <N>` | Override auto-detected grid size (pixels per logical pixel) |
| `--grid-phase <X,Y>` | Override grid phase offset (default: auto-detect) |
| `--no-grid-detect` | Skip grid detection entirely (requires `--grid-size`) |
| `--max-grid-candidate <N>` | Maximum grid size to test during detection (default: 32) |

**Choosing a grid size:** The grid size is how many input pixels make up one "logical pixel" in the art. For a 1024x1024 image:

| `--grid-size` | Logical Resolution | Use Case |
|---------------|--------------------|----------|
| 2 | 512x512 | High detail, subtle cleanup |
| 4 | 256x256 | Good balance for most AI art |
| 6 | 170x170 | Chunkier retro look |
| 8 | 128x128 | Classic low-res pixel art |
| 16 | 64x64 | Very chunky, icon-sized |

#### Downscale Mode Options

| Flag | Description |
|------|-------------|
| `--downscale-mode <MODE>` | Downscale strategy (default: `snap`) |

Available modes:

| Mode | Description |
|------|-------------|
| `snap` | **Default.** Enforces grid at original resolution — 1 dominant color per block, output stays at input size. Best for AI art. |
| `center-weighted` | Reduces to logical resolution. Center pixels have more voting weight (quadratic falloff). |
| `majority-vote` | Reduces to logical resolution. Pure mode — most common color wins, center tie-break. |
| `center-pixel` | Reduces to logical resolution. Uses center pixel of each block directly. Fastest. |

All non-snap modes produce a smaller image at logical resolution, then the pipeline upscales back to the original dimensions (or your specified `--target-width`/`--target-height`) using nearest-neighbor.

#### Output Size Options

| Flag | Description |
|------|-------------|
| `--target-width <N>` | Explicit output width (default: same as input) |
| `--target-height <N>` | Explicit output height (default: same as input) |

#### Anti-Aliasing Options

| Flag | Description |
|------|-------------|
| `--aa-threshold <0.0-1.0>` | Enable AA removal with this sensitivity. Lower = more aggressive. Off by default. |

Only useful for cleanly upscaled pixel art. AI-generated art has intentional edge detail that AA removal can destroy.

#### Color Quantization Options

| Flag | Description |
|------|-------------|
| `--palette <NAME>` | Use a built-in palette (see below) |
| `--palette-file <PATH>` | Load a custom palette from a `.hex` file |
| `--colors <N>` | Auto-extract N colors via k-means clustering |
| `--no-quantize` | Skip color quantization entirely |

#### Background Removal Options

| Flag | Description |
|------|-------------|
| `--remove-bg` | Enable background detection and removal |
| `--bg-color <HEX>` | Explicit background color (e.g., `FF00FF` or `#FF00FF`) |
| `--bg-threshold <0.0-1.0>` | Min fraction of border pixels for auto-detection (default: 0.4) |
| `--bg-tolerance <N>` | Color tolerance for matching in OKLAB space (default: 0.05) |
| `--no-flood-fill` | Use global replacement instead of flood-fill (removes interior background too) |

#### Other Options

| Flag | Description |
|------|-------------|
| `--overwrite` | Overwrite output file if it exists |

### `palette list` — Show built-in palettes

```
normalize-pixelart palette list
```

### `palette extract` — Extract a palette from an image

```
normalize-pixelart palette extract [OPTIONS] <INPUT>
```

Uses k-means++ clustering in OKLAB space to find representative colors.

| Flag | Description |
|------|-------------|
| `--colors <N>` | Number of colors to extract (default: 16) |
| `-o, --output <PATH>` | Save palette as a `.hex` file |

## Built-in Palettes

| Palette | Colors | Flag |
|---------|--------|------|
| PICO-8 | 16 | `--palette pico-8` |
| Sweetie 16 | 16 | `--palette sweetie-16` |
| Endesga 32 | 32 | `--palette endesga-32` |
| Endesga 64 | 64 | `--palette endesga-64` |
| Game Boy | 4 | `--palette gameboy` |
| NES | 26 | `--palette nes` |

## Custom Palette Files

Load a custom palette from a `.hex` file with `--palette-file`. Format is one hex color per line:

```
FF0000
00FF00
0000FF
; This is a comment
// This is also a comment
#AABBCC
```

Colors can be specified with or without a `#` prefix. Lines starting with `;` or `//` are treated as comments.

## Config File

Save your preferred settings in `.normalize-pixelart.toml` in the working directory, or specify a path with `--config <PATH>`. All fields are optional — CLI arguments override config values.

```toml
[grid]
size = 4
max_candidate = 16
skip = false

[aa]
threshold = 0.3
skip = false

[quantize]
colors = 16
palette = "pico-8"
skip = false

[background]
enabled = true
color = "FF00FF"
border_threshold = 0.4
color_tolerance = 0.05
flood_fill = true

[output]
overwrite = false
```

## Global Options

| Flag | Description |
|------|-------------|
| `-v, --verbose` | Increase verbosity (`-v` info, `-vv` debug, `-vvv` trace) |
| `-q, --quiet` | Suppress all output except errors |
| `--config <PATH>` | Path to config file |

## Examples

```bash
# Normalize with auto-detected grid, see diagnostics
normalize-pixelart process input.png output.png -vv

# Force grid size 4, snap to Sweetie-16 palette, remove background
normalize-pixelart process input.png output.png \
  --grid-size 4 \
  --palette sweetie-16 \
  --remove-bg

# Extract 8-color palette from reference art, save as .hex
normalize-pixelart palette extract reference.png --colors 8 -o my-palette.hex

# Use extracted palette on a new image
normalize-pixelart process input.png output.png \
  --grid-size 4 \
  --palette-file my-palette.hex

# Downscale to logical resolution (64x64 from 1024x1024)
normalize-pixelart process input.png output.png \
  --grid-size 16 \
  --downscale-mode majority-vote \
  --target-width 64 \
  --target-height 64

# Clean up already-upscaled pixel art with AA removal
normalize-pixelart process upscaled.png clean.png \
  --grid-size 4 \
  --aa-threshold 0.3

# Process with config file
normalize-pixelart process input.png output.png --config my-settings.toml
```

## Performance

Processing is parallelized via rayon:

- Grid detection runs candidate evaluation and phase scanning in parallel
- AA removal processes rows in parallel with pre-computed OKLAB values
- A 1024x1024 image typically processes in under 1 second on a modern multi-core CPU

## License

MIT
