mod app;
mod event;
mod ui;

use std::path::PathBuf;

use anyhow::Result;
use crossterm::ExecutableCommand;

use crate::pipeline::PipelineConfig;

/// Entry point for the TUI application.
pub fn run_tui(initial_path: Option<PathBuf>, config: PipelineConfig) -> Result<()> {
    // 1. Query terminal for image protocol support.
    //    Try auto-detection first; if it picks a protocol that fails to render,
    //    the user can press 'p' to cycle to halfblocks.
    let mut picker = ratatui_image::picker::Picker::from_query_stdio()
        .unwrap_or_else(|_| ratatui_image::picker::Picker::halfblocks());
    let proto_name = format!("{:?}", picker.protocol_type());
    // Force halfblocks — graphical protocols (Kitty/iTerm2/Sixel) can fail
    // to display in some terminals. Halfblocks always works.
    picker.set_protocol_type(ratatui_image::picker::ProtocolType::Halfblocks);

    // 2. Install panic hook to restore terminal on crash
    let original_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        let _ = crossterm::terminal::disable_raw_mode();
        let _ = std::io::stdout().execute(crossterm::terminal::LeaveAlternateScreen);
        original_hook(panic_info);
    }));

    // 3. Enter alternate screen and enable raw mode
    crossterm::terminal::enable_raw_mode()?;
    let mut stdout = std::io::stdout();
    crossterm::execute!(
        stdout,
        crossterm::terminal::EnterAlternateScreen,
    )?;
    let backend = ratatui::backend::CrosstermBackend::new(stdout);
    let mut terminal = ratatui::Terminal::new(backend)?;

    // 4. Build App state
    let mut app = app::App::new(picker, config, &proto_name);

    // 5. Load initial image if provided
    if let Some(ref path) = initial_path {
        app.load_image(path);
    }

    // 6. Run event loop
    let result = event::run_event_loop(&mut terminal, &mut app);

    // 7. Restore terminal (always, even on error)
    crossterm::terminal::disable_raw_mode()?;
    crossterm::execute!(
        terminal.backend_mut(),
        crossterm::terminal::LeaveAlternateScreen,
    )?;
    terminal.show_cursor()?;

    result
}
