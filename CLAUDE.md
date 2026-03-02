# Project Instructions for Claude

## Agent Usage Rules

**Automatically use the appropriate agent when their expertise is relevant:**

| When doing... | Use agent |
|---------------|-----------|
| Rust code, algorithms, performance optimization | `code-reviewer` |
| Image processing pipeline, color science | `senior-architect` |
| CLI UX, TUI interface design | `senior-frontend` |

**Do not ask before using these agents.** Use them proactively as tasks arise.

## Project Context

- **Product**: pixfix (normalize-pixelart)
- **Purpose**: Clean up AI-generated pixel art — snap to grid, remove AA fuzz, reduce to palette, remove backgrounds
- **Target users**: Pixel artists, game developers, anyone working with AI-generated pixel art
- **Scope**: Desktop app (macOS, Windows, Linux) + CLI tool

## Tech Stack (Decided)

- Language: Rust (edition 2021)
- Image processing: `image` crate + custom OKLAB pipeline
- CLI: clap (derive)
- Parallelism: rayon
- TUI: ratatui + crossterm (optional feature)
- Color science: `palette` crate + custom OKLAB implementation
- Error handling: anyhow + thiserror
- Config: TOML via `serde` + `toml`

## Way of Working

### Plan First
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Write plan to `tasks/todo.md` with checkable items, check in before implementing
- Mark items complete as you go, add review/results when done

### Subagent Strategy
- Offload research, exploration, and parallel analysis to subagents to keep main context clean
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### Verify Before Done
- Never mark a task complete without proving it works
- Run `cargo build` and `cargo test` before declaring anything done
- Run `cargo clippy` to catch lint issues
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"

### Self-Improvement
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules that prevent the same mistake recurring
- Review lessons at session start for relevant project context

### Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky, step back and implement the elegant solution
- Skip this for simple, obvious fixes - don't over-engineer

### Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests -> then resolve them
- Zero context switching required from the user

## Architecture Overview

```
src/
├── main.rs              # Entry point, CLI dispatch
├── cli.rs               # clap CLI definitions
├── lib.rs               # Library root
├── config.rs            # TOML config parsing
├── error.rs             # Error types
├── batch.rs             # Batch processing
├── spritesheet.rs       # Sprite sheet splitting
├── pipeline/            # Core processing pipeline
│   ├── grid_detect.rs   # Grid size + phase detection
│   ├── aa_removal.rs    # Anti-aliasing artifact removal
│   ├── downscale.rs     # Snap/downscale modes
│   ├── quantize.rs      # Color quantization
│   └── background.rs    # Background removal
├── color/               # Color science
│   ├── oklab.rs         # OKLAB color space
│   ├── kmeans.rs        # K-means clustering
│   ├── palette_match.rs # Palette snapping
│   ├── palettes.rs      # Built-in palettes
│   └── lospec.rs        # Lospec API integration
├── image_util/          # Image helpers
│   ├── io.rs            # Image I/O
│   ├── histogram.rs     # Color histogram
│   └── neighbors.rs     # Pixel neighbor analysis
└── tui/                 # Terminal UI (optional feature)
    ├── app.rs           # App state
    ├── event.rs         # Event handling
    └── ui.rs            # UI rendering
```

## Key Principles

- **Simplicity First**: Make every change as simple as possible. Minimal code impact.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
- **Performance matters**: This processes images — keep hot paths fast, use rayon for parallelism
- **OKLAB everywhere**: All color comparisons must use OKLAB space for perceptual accuracy
- **Cargo conventions**: Follow standard Rust project structure and idioms
