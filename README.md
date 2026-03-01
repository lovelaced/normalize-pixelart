# normalize-pixelart

A fast Rust CLI tool that normalizes AI-generated pixel art into clean, grid-aligned game assets.

AI image generators produce "pixel art" riddled with **mixels** (mixed-resolution pixels), anti-aliasing artifacts, and colors that don't snap to any grid. This tool takes that messy output and produces clean, uniform pixel art — while preserving the vibrancy and character of the original.

## Features

- **Grid detection** — automatically finds the pixel grid size and phase offset in upscaled art
- **Grid snapping** — enforces a clean pixel grid at original resolution, eliminating mixels
- **Phase alignment** — auto-detects optimal grid offset so block boundaries align with real edges
- **Color quantization** — snap to built-in palettes (PICO-8, Sweetie-16, etc.), fetch from [Lospec](https://lospec.com), or auto-extract palettes via k-means in OKLAB space
- **Anti-aliasing removal** — detects and removes interpolation artifacts between pixel boundaries
- **Background removal** — auto-detect and remove solid backgrounds via flood-fill or global replacement
- **Config files** — save your settings in `.normalize-pixelart.toml`
- **Batch processing** — normalize an entire directory of sprites in one command, with a progress bar
- **Sprite sheet support** — split a sheet into tiles, normalize each in parallel, and reassemble
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
| `--lospec <SLUG>` | Fetch a palette from [Lospec](https://lospec.com) by slug (requires `lospec` feature) |
| `--colors <N>` | Auto-extract N colors via k-means clustering |
| `--no-quantize` | Skip color quantization entirely |

Priority: `--palette-file` > `--lospec` > `--palette` > `--colors`

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

### `batch` — Normalize a directory of images

```
normalize-pixelart batch [OPTIONS] <INPUT> <OUTPUT>
```

Process multiple images in parallel. `INPUT` can be a directory or a glob pattern. `OUTPUT` is the directory where normalized images are written (created if needed).

| Flag | Description |
|------|-------------|
| `--overwrite` | Overwrite existing output files |

All pipeline flags from `process` are available (`--grid-size`, `--palette`, `--colors`, etc.).

```bash
# Process all PNGs in a directory
normalize-pixelart batch sprites/ output/ --grid-size 4

# Process with a glob pattern
normalize-pixelart batch "assets/**/*.png" output/ --grid-size 4 --palette pico-8

# Overwrite existing outputs
normalize-pixelart batch sprites/ output/ --grid-size 4 --overwrite
```

Output files are named `<input_stem>_normalized.<ext>` in the output directory.

### `sheet` — Normalize a sprite sheet

```
normalize-pixelart sheet [OPTIONS] <INPUT> [OUTPUT]
```

Split a sprite sheet into individual tiles, normalize each tile through the pipeline in parallel, and reassemble into a clean sheet. Output defaults to `<input>_normalized.png`.

Two modes:

1. **Fixed grid** — specify `--tile-width` and `--tile-height` for sheets with a known, regular tile layout
2. **Auto-split** — omit tile dimensions to auto-detect sprite boundaries in messy AI-generated sheets

#### Fixed Grid Mode

| Flag | Description |
|------|-------------|
| `--tile-width <N>` | Tile width in pixels |
| `--tile-height <N>` | Tile height in pixels |
| `--spacing <N>` | Gap between tiles in pixels (default: 0) |
| `--margin <N>` | Border around the entire sheet in pixels (default: 0) |
| `--overwrite` | Overwrite output file if it exists |

```bash
# Normalize a 64x64 tile sheet
normalize-pixelart sheet tileset.png --tile-width 64 --tile-height 64 --grid-size 4

# Sheet with spacing between tiles
normalize-pixelart sheet tileset.png clean_tileset.png \
  --tile-width 32 --tile-height 32 --spacing 2 --grid-size 4

# Sheet with margin and palette
normalize-pixelart sheet sprites.png \
  --tile-width 48 --tile-height 48 --margin 4 \
  --grid-size 4 --palette sweetie-16
```

#### Auto-Split Mode

When `--tile-width` and `--tile-height` are omitted, the tool auto-detects sprite boundaries by finding rows and columns of background pixels, extracts each sprite, trims to tight bounding boxes, and reassembles into a uniform grid. This works well with AI-generated "sprite sheets" (Midjourney, DALL-E, etc.) that have uneven spacing and sizes.

| Flag | Description |
|------|-------------|
| `--separator-threshold <0.0-1.0>` | Fraction of bg pixels to classify a row/col as separator (default: 0.90) |
| `--min-sprite-size <N>` | Minimum sprite dimension in pixels — filters noise (default: 8) |
| `--pad <N>` | Padding around each sprite in the output sheet (default: 0) |
| `--output-dir <PATH>` | Also save individual sprite files as `sprite_RR_CC.png` |
| `--no-normalize` | Skip the normalization pipeline (just split and reassemble) |
| `--overwrite` | Overwrite output file if it exists |

Background detection reuses `--bg-color` and `--bg-tolerance` from the pipeline flags. If neither is set, the tool auto-detects transparency or the dominant border color.

```bash
# Auto-detect sprites in an AI-generated sheet
normalize-pixelart sheet ai_sheet.png

# With explicit background color and tolerance
normalize-pixelart sheet ai_sheet.png --bg-color FFFFFF --bg-tolerance 0.1

# Lower separator threshold for sheets with less clean gutters
normalize-pixelart sheet ai_sheet.png --separator-threshold 0.85

# Save individual sprites and the reassembled sheet
normalize-pixelart sheet ai_sheet.png --output-dir sprites/

# Just split and reassemble without normalizing
normalize-pixelart sheet ai_sheet.png --no-normalize

# Auto-split + normalize with palette
normalize-pixelart sheet ai_sheet.png --grid-size 4 --palette sweetie-16
```

### `tui` — Interactive editor

```
normalize-pixelart tui [OPTIONS] [INPUT]
```

Launch an interactive terminal-based editor for tuning pipeline parameters with live image preview. Uses Sixel graphics for high-fidelity image rendering in supported terminals (iTerm2, WezTerm, foot, etc.), with Unicode halfblock fallback for other terminals.

All pipeline flags from `process` are available for initial settings.

```bash
# Launch empty, open an image from within
normalize-pixelart tui

# Launch with an image pre-loaded
normalize-pixelart tui input.png

# Pre-configure pipeline settings
normalize-pixelart tui input.png --grid-size 4 --palette pico-8
```

**Tabs:**

| Tab | Description |
|-----|-------------|
| Preview | Side-by-side original/processed image preview |
| Settings | Adjust pipeline parameters with keyboard controls |
| Diagnostics | Grid detection scores and color histogram |

**Key bindings:**

| Key | Action |
|-----|--------|
| `q` / `Ctrl-C` | Quit |
| `Tab` | Switch between tabs |
| `Space` | Run pipeline with current settings |
| `o` | Open a file (text input prompt) |
| `s` | Save processed image (text input prompt) |
| `r` | Reset settings to initial values |
| `↑` / `↓` | Select setting (Settings tab) |
| `←` / `→` | Adjust setting value (Settings tab) |

Requires the `tui` feature (enabled by default). Build without it using `cargo build --no-default-features --features lospec`.

### `palette list` — Show built-in palettes

```
normalize-pixelart palette list
```

### `palette fetch` — Download a palette from Lospec

```
normalize-pixelart palette fetch [OPTIONS] <SLUG>
```

Fetches a palette from the [Lospec palette database](https://lospec.com/palette-list) by slug. Downloaded palettes are cached locally so subsequent requests don't hit the network.

| Flag | Description |
|------|-------------|
| `-o, --output <PATH>` | Save palette as a `.hex` file |

```bash
# Browse and display a palette
normalize-pixelart palette fetch endesga-32

# Download and save as .hex file
normalize-pixelart palette fetch apollo -o apollo.hex

# Use directly when processing
normalize-pixelart process input.png output.png --lospec endesga-32 --grid-size 4
```

Requires the `lospec` feature (enabled by default). Build without it using `cargo build --no-default-features`.

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

## Lospec Palettes

Access thousands of curated pixel art palettes from [Lospec](https://lospec.com/palette-list) using `--lospec <slug>` or the `palette fetch` command. The slug is the URL-friendly name shown in the Lospec URL (e.g., `https://lospec.com/palette-list/endesga-32` → slug is `endesga-32`).

Downloaded palettes are cached at `~/Library/Caches/normalize-pixelart/palettes/` (macOS) or `~/.cache/normalize-pixelart/palettes/` (Linux) to avoid repeated network requests.

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

# Fetch a Lospec palette and use it
normalize-pixelart palette fetch endesga-32
normalize-pixelart process input.png output.png --lospec endesga-32 --grid-size 4

# Process with config file
normalize-pixelart process input.png output.png --config my-settings.toml

# Batch process an entire directory
normalize-pixelart batch sprites/ cleaned/ --grid-size 4 --palette sweetie-16

# Normalize a sprite sheet (64x64 tiles, no spacing)
normalize-pixelart sheet tileset.png --tile-width 64 --tile-height 64 --grid-size 4

# Auto-split an AI-generated sprite sheet
normalize-pixelart sheet ai_sheet.png --output-dir sprites/
```

## Performance

Processing is parallelized via rayon:

- Grid detection runs candidate evaluation and phase scanning in parallel
- AA removal processes rows in parallel with pre-computed OKLAB values
- Batch mode processes multiple files in parallel with a progress bar
- Sprite sheet mode processes all tiles in parallel
- A 1024x1024 image typically processes in under 1 second on a modern multi-core CPU

## License

MIT
