use std::path::PathBuf;
use std::time::Duration;

use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::Terminal;
use ratatui::backend::CrosstermBackend;

use super::app::{App, Tab, TextInputMode};
use super::ui;

pub fn run_event_loop(
    terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    app: &mut App,
) -> Result<()> {
    loop {
        terminal.draw(|frame| ui::draw(frame, app))?;

        if event::poll(Duration::from_millis(50))? {
            match event::read()? {
                Event::Key(key) if key.kind == KeyEventKind::Press => {
                    // Text input mode intercepts all keys
                    if app.text_input_mode.is_some() {
                        handle_text_input(app, key.code);
                    } else {
                        handle_key(app, key.code, key.modifiers);
                    }
                }
                _ => {}
            }
        }

        if app.should_quit {
            return Ok(());
        }
    }
}

fn handle_key(app: &mut App, code: KeyCode, modifiers: KeyModifiers) {
    // Global keys
    match code {
        KeyCode::Char('q') => {
            app.should_quit = true;
            return;
        }
        KeyCode::Char('c') if modifiers.contains(KeyModifiers::CONTROL) => {
            app.should_quit = true;
            return;
        }
        KeyCode::Tab => {
            app.cycle_tab();
            return;
        }
        KeyCode::Char(' ') => {
            app.run_pipeline();
            return;
        }
        KeyCode::Char('o') => {
            app.text_input_mode = Some(TextInputMode::OpenFile);
            app.text_input_buffer = app
                .input_path
                .as_ref()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| {
                    std::env::current_dir()
                        .map(|d| format!("{}/", d.display()))
                        .unwrap_or_default()
                });
            return;
        }
        KeyCode::Char('s') => {
            app.text_input_mode = Some(TextInputMode::SaveFile);
            app.text_input_buffer = app.default_output_path();
            return;
        }
        KeyCode::Char('r') => {
            app.reset_config();
            return;
        }
        // Number keys to jump directly to tabs
        KeyCode::Char('1') => {
            app.active_tab = Tab::Preview;
            return;
        }
        KeyCode::Char('2') => {
            app.active_tab = Tab::Settings;
            return;
        }
        KeyCode::Char('3') => {
            app.active_tab = Tab::Diagnostics;
            return;
        }
        _ => {}
    }

    // Tab-specific keys
    match app.active_tab {
        Tab::Settings => match code {
            KeyCode::Up | KeyCode::Char('k') => app.settings_prev(),
            KeyCode::Down | KeyCode::Char('j') => app.settings_next(),
            KeyCode::Left | KeyCode::Char('h') => {
                app.adjust_setting(-1);
                app.run_pipeline();
            }
            KeyCode::Right | KeyCode::Char('l') => {
                app.adjust_setting(1);
                app.run_pipeline();
            }
            _ => {}
        },
        Tab::Preview | Tab::Diagnostics => {}
    }
}

fn handle_text_input(app: &mut App, code: KeyCode) {
    match code {
        KeyCode::Enter => {
            let expanded = shellexpand::tilde(&app.text_input_buffer);
            let path = PathBuf::from(expanded.as_ref());
            match app.text_input_mode {
                Some(TextInputMode::OpenFile) => app.load_image(&path),
                Some(TextInputMode::SaveFile) => app.save_image(&path),
                None => {}
            }
            app.text_input_mode = None;
            app.text_input_buffer.clear();
        }
        KeyCode::Esc => {
            app.text_input_mode = None;
            app.text_input_buffer.clear();
        }
        KeyCode::Backspace => {
            app.text_input_buffer.pop();
        }
        KeyCode::Char(c) => {
            app.text_input_buffer.push(c);
        }
        _ => {}
    }
}
