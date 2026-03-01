use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Tabs};
use ratatui::Frame;
use ratatui_image::StatefulImage;

use super::app::{App, SettingId, StatusLevel, Tab};

// ── Catppuccin Mocha theme ──────────────────────────────────────────────────

mod theme {
    use ratatui::style::Color;

    pub const BASE: Color = Color::Rgb(30, 30, 46);
    pub const MANTLE: Color = Color::Rgb(24, 24, 37);
    pub const CRUST: Color = Color::Rgb(17, 17, 27);
    pub const SURFACE0: Color = Color::Rgb(49, 50, 68);
    pub const SURFACE2: Color = Color::Rgb(88, 91, 112);
    pub const OVERLAY0: Color = Color::Rgb(108, 112, 134);
    pub const TEXT: Color = Color::Rgb(205, 214, 244);
    pub const SUBTEXT1: Color = Color::Rgb(186, 194, 222);
    pub const SUBTEXT0: Color = Color::Rgb(166, 173, 200);
    pub const LAVENDER: Color = Color::Rgb(180, 190, 254);
    pub const BLUE: Color = Color::Rgb(137, 180, 250);
    pub const GREEN: Color = Color::Rgb(166, 227, 161);
    pub const PEACH: Color = Color::Rgb(250, 179, 135);
    pub const RED: Color = Color::Rgb(243, 139, 168);
    pub const YELLOW: Color = Color::Rgb(249, 226, 175);
    pub const MAUVE: Color = Color::Rgb(203, 166, 247);
    pub const TEAL: Color = Color::Rgb(148, 226, 213);
}

// ── ASCII art logo ──────────────────────────────────────────────────────────

const LOGO_ART: [&str; 5] = [
    r"        _  __",
    r" _ __  (_)/ _|_  _",
    r"| '_ \ | |  _\ \/ /",
    r"| .__/ |_|_|  >  < ",
    r"|_|          /_/\_\",
];

// ── Main draw ───────────────────────────────────────────────────────────────

pub fn draw(frame: &mut Frame, app: &mut App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(4), // Header: title + tabs
            Constraint::Min(6),   // Content
            Constraint::Length(1), // Status
            Constraint::Length(1), // Keybindings
        ])
        .split(frame.area());

    draw_header(frame, app, chunks[0]);

    match app.active_tab {
        Tab::Preview => draw_preview_tab(frame, app, chunks[1]),
        Tab::Settings => draw_settings_tab(frame, app, chunks[1]),
        Tab::Diagnostics => draw_diagnostics_tab(frame, app, chunks[1]),
    }

    draw_status_bar(frame, app, chunks[2]);
    draw_keybindings(frame, app, chunks[3]);

    if app.text_input_mode.is_some() {
        draw_text_input(frame, app);
    }
}

// ── Header with logo + tabs ─────────────────────────────────────────────────

fn draw_header(frame: &mut Frame, app: &App, area: Rect) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme::SURFACE2))
        .style(Style::default().bg(theme::MANTLE));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1), // Title
            Constraint::Length(1), // Tabs
        ])
        .split(inner);

    // Title line
    let title = Line::from(vec![
        Span::styled(
            " normalize-pixelart",
            Style::default()
                .fg(theme::LAVENDER)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(" v0.1.0", Style::default().fg(theme::OVERLAY0)),
    ]);
    frame.render_widget(Paragraph::new(title), rows[0]);

    // Tabs
    let titles: Vec<Line> = Tab::ALL
        .iter()
        .enumerate()
        .map(|(i, t)| Line::from(format!(" {} {} ", i + 1, t.title())))
        .collect();

    let selected = Tab::ALL
        .iter()
        .position(|t| *t == app.active_tab)
        .unwrap_or(0);

    let tabs = Tabs::new(titles)
        .select(selected)
        .style(Style::default().fg(theme::SUBTEXT0).bg(theme::MANTLE))
        .highlight_style(
            Style::default()
                .fg(theme::LAVENDER)
                .bg(theme::SURFACE0)
                .add_modifier(Modifier::BOLD),
        )
        .divider(Span::styled(" | ", Style::default().fg(theme::SURFACE2)));

    frame.render_widget(tabs, rows[1]);
}

// ── Preview tab ─────────────────────────────────────────────────────────────

fn draw_preview_tab(frame: &mut Frame, app: &mut App, area: Rect) {
    // If no image at all, show welcome screen
    if app.original_image.is_none() {
        draw_welcome_screen(frame, area);
        return;
    }

    let columns = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(area);

    // Left: Original — no explicit bg so ratatui-image can control cell colors
    let left_block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme::SURFACE2))
        .title(Span::styled(" Original ", Style::default().fg(theme::SUBTEXT1)));
    let left_inner = left_block.inner(columns[0]);
    frame.render_widget(left_block, columns[0]);

    if let Some(ref mut protocol) = app.original_protocol {
        let image_widget = StatefulImage::default();
        frame.render_stateful_widget(image_widget, left_inner, protocol);
    }

    // Right: Processed
    let right_block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme::SURFACE2))
        .title(Span::styled(
            " Processed ",
            Style::default().fg(theme::SUBTEXT1),
        ));
    let right_inner = right_block.inner(columns[1]);
    frame.render_widget(right_block, columns[1]);

    if let Some(ref mut protocol) = app.processed_protocol {
        let image_widget = StatefulImage::default();
        frame.render_stateful_widget(image_widget, right_inner, protocol);
    } else {
        let placeholder = Paragraph::new("Press Space to process")
            .alignment(Alignment::Center)
            .style(Style::default().fg(theme::OVERLAY0));
        frame.render_widget(placeholder, right_inner);
    }
}

// ── Welcome screen (no image loaded) ────────────────────────────────────────

fn draw_welcome_screen(frame: &mut Frame, area: Rect) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme::SURFACE2))
        .style(Style::default().bg(theme::BASE));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let mut lines = vec![
        Line::from(""),
        Line::from(""),
    ];

    // ASCII art logo
    for art_line in &LOGO_ART {
        lines.push(Line::from(Span::styled(
            *art_line,
            Style::default().fg(theme::MAUVE),
        )));
    }

    lines.extend([
        Line::from(""),
        Line::from(Span::styled(
            "normalize-pixelart",
            Style::default()
                .fg(theme::LAVENDER)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(Span::styled(
            "Clean pixel art, one grid at a time",
            Style::default().fg(theme::SUBTEXT0),
        )),
        Line::from(""),
        Line::from(""),
        Line::from(vec![
            Span::styled("  Press ", Style::default().fg(theme::SUBTEXT0)),
            Span::styled(
                " o ",
                Style::default()
                    .fg(theme::LAVENDER)
                    .bg(theme::SURFACE0)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(" to open an image", Style::default().fg(theme::SUBTEXT0)),
        ]),
        Line::from(""),
        Line::from(Span::styled(
            "or run: normalize-pixelart tui <path>",
            Style::default().fg(theme::OVERLAY0),
        )),
    ]);

    let p = Paragraph::new(lines).alignment(Alignment::Center);
    frame.render_widget(p, inner);
}

// ── Settings tab (side-by-side with preview) ────────────────────────────────

fn draw_settings_tab(frame: &mut Frame, app: &mut App, area: Rect) {
    let columns = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Length(42), Constraint::Fill(1)])
        .split(area);

    draw_settings_panel(frame, app, columns[0]);
    draw_settings_preview(frame, app, columns[1]);
}

fn draw_settings_panel(frame: &mut Frame, app: &App, area: Rect) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme::SURFACE2))
        .title(Span::styled(
            " Settings ",
            Style::default().fg(theme::PEACH).add_modifier(Modifier::BOLD),
        ))
        .style(Style::default().bg(theme::BASE));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let mut items: Vec<ListItem> = Vec::new();

    // Grid section header
    items.push(make_section_header("Grid", inner.width));

    for (i, &id) in app.settings.iter().enumerate() {
        // Insert section headers before groups
        if id == SettingId::PaletteName {
            items.push(ListItem::new(Line::from("")));
            items.push(make_section_header("Colors", inner.width));
        }
        if id == SettingId::RemoveBg {
            items.push(ListItem::new(Line::from("")));
            items.push(make_section_header("Background", inner.width));
        }

        let is_selected = i == app.settings_selected;
        let is_changed = app.is_setting_changed(id);
        let label = App::setting_label(id);
        let value = app.setting_display(id);

        // Determine value color
        let value_color = if is_changed {
            theme::YELLOW
        } else if is_selected {
            theme::PEACH
        } else {
            theme::TEXT
        };

        let label_style = if is_selected {
            Style::default()
                .fg(theme::PEACH)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(theme::SUBTEXT1)
        };

        let prefix = if is_selected { " \u{25b6} " } else { "   " };
        let arrows = if is_selected { "\u{25c0} " } else { "  " };
        let arrows_r = if is_selected { " \u{25b6}" } else { "" };

        let line = Line::from(vec![
            Span::styled(prefix, label_style),
            Span::styled(format!("{:<16}", label), label_style),
            Span::styled(arrows, Style::default().fg(theme::OVERLAY0)),
            Span::styled(
                format!("{:^10}", value),
                Style::default().fg(value_color).add_modifier(if is_selected {
                    Modifier::BOLD
                } else {
                    Modifier::empty()
                }),
            ),
            Span::styled(arrows_r, Style::default().fg(theme::OVERLAY0)),
        ]);

        if is_selected {
            items.push(ListItem::new(line).style(Style::default().bg(theme::SURFACE0)));
        } else {
            items.push(ListItem::new(line));
        }

        // Inline description for selected setting
        if is_selected {
            let desc = App::setting_description(id);
            items.push(ListItem::new(Line::from(vec![
                Span::raw("     "),
                Span::styled(desc, Style::default().fg(theme::OVERLAY0)),
            ])));
        }
    }

    let list = List::new(items);
    frame.render_widget(list, inner);
}

fn make_section_header(title: &str, width: u16) -> ListItem<'static> {
    let rule_len = width.saturating_sub(title.len() as u16 + 5) as usize;
    let rule = "\u{2500}".repeat(rule_len);
    ListItem::new(Line::from(vec![
        Span::styled(
            format!(" {} ", title),
            Style::default()
                .fg(theme::MAUVE)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(rule, Style::default().fg(theme::SURFACE2)),
    ]))
}

fn draw_settings_preview(frame: &mut Frame, app: &mut App, area: Rect) {
    // No explicit bg — let ratatui-image control cell colors for image rendering
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme::SURFACE2))
        .title(Span::styled(
            " Preview ",
            Style::default().fg(theme::SUBTEXT1),
        ));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    if let Some(ref mut protocol) = app.processed_protocol {
        let image_widget = StatefulImage::default();
        frame.render_stateful_widget(image_widget, inner, protocol);
    } else if let Some(ref mut protocol) = app.original_protocol {
        let image_widget = StatefulImage::default();
        frame.render_stateful_widget(image_widget, inner, protocol);
    } else {
        let placeholder = Paragraph::new("No image loaded")
            .alignment(Alignment::Center)
            .style(Style::default().fg(theme::OVERLAY0));
        frame.render_widget(placeholder, inner);
    }
}

// ── Diagnostics tab ─────────────────────────────────────────────────────────

fn draw_diagnostics_tab(frame: &mut Frame, app: &App, area: Rect) {
    let columns = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(45), Constraint::Percentage(55)])
        .split(area);

    draw_grid_scores(frame, app, columns[0]);
    draw_color_histogram(frame, app, columns[1]);
}

fn draw_grid_scores(frame: &mut Frame, app: &App, area: Rect) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme::SURFACE2))
        .title(Span::styled(
            " Grid Detection ",
            Style::default().fg(theme::TEAL).add_modifier(Modifier::BOLD),
        ))
        .style(Style::default().bg(theme::BASE));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let Some(ref diag) = app.diagnostics else {
        let p = Paragraph::new("No data \u{2014} process an image first")
            .style(Style::default().fg(theme::OVERLAY0));
        frame.render_widget(p, inner);
        return;
    };

    if diag.grid_variance_scores.is_empty() {
        let p = Paragraph::new("Grid detection was skipped")
            .style(Style::default().fg(theme::OVERLAY0));
        frame.render_widget(p, inner);
        return;
    }

    let max_score = diag
        .grid_variance_scores
        .iter()
        .map(|(_, s)| *s)
        .fold(0.0f32, f32::max);
    let best_size = diag
        .grid_variance_scores
        .iter()
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(s, _)| *s);

    let bar_width = inner.width.saturating_sub(16) as f32;

    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line::from(""));
    for &(size, score) in &diag.grid_variance_scores {
        let fill = if max_score > 0.0 {
            ((score / max_score) * bar_width) as usize
        } else {
            0
        };
        let bar: String = "\u{2588}".repeat(fill);
        let marker = if Some(size) == best_size {
            " \u{25c0}"
        } else {
            ""
        };
        let (bar_color, label_color) = if Some(size) == best_size {
            (theme::GREEN, theme::GREEN)
        } else {
            (theme::BLUE, theme::SUBTEXT0)
        };
        lines.push(Line::from(vec![
            Span::styled(
                format!("  {:>2}: ", size),
                Style::default().fg(theme::SUBTEXT1),
            ),
            Span::styled(bar, Style::default().fg(bar_color)),
            Span::styled(
                format!(" {:.1}{}", score, marker),
                Style::default().fg(label_color),
            ),
        ]));
    }

    if let Some(conf) = diag.grid_confidence {
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled("  Confidence: ", Style::default().fg(theme::SUBTEXT1)),
            Span::styled(
                format!("{:.0}%", conf * 100.0),
                Style::default()
                    .fg(theme::TEAL)
                    .add_modifier(Modifier::BOLD),
            ),
        ]));
    }

    let p = Paragraph::new(lines);
    frame.render_widget(p, inner);
}

fn draw_color_histogram(frame: &mut Frame, app: &App, area: Rect) {
    let title = format!(" Top Colors ({} unique) ", app.unique_colors);
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme::SURFACE2))
        .title(Span::styled(
            title,
            Style::default().fg(theme::PEACH).add_modifier(Modifier::BOLD),
        ))
        .style(Style::default().bg(theme::BASE));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let Some(ref histogram) = app.color_histogram else {
        let p = Paragraph::new("No data \u{2014} process an image first")
            .style(Style::default().fg(theme::OVERLAY0));
        frame.render_widget(p, inner);
        return;
    };

    let total: u32 = histogram.iter().map(|(_, c)| *c).sum();

    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line::from(""));
    for (color, count) in histogram {
        let pct = if total > 0 {
            *count as f64 / total as f64 * 100.0
        } else {
            0.0
        };
        let swatch_style = Style::default().bg(Color::Rgb(color[0], color[1], color[2]));
        lines.push(Line::from(vec![
            Span::raw("  "),
            Span::styled("  ", swatch_style),
            Span::styled(
                format!(" #{:02X}{:02X}{:02X}", color[0], color[1], color[2]),
                Style::default().fg(theme::SUBTEXT0),
            ),
            Span::styled(format!("  {:5.1}%", pct), Style::default().fg(theme::TEXT)),
        ]));
    }

    // Image dimensions info
    if let Some(ref img) = app.original_image {
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled("  Dimensions: ", Style::default().fg(theme::SUBTEXT1)),
            Span::styled(
                format!("{}x{}", img.width(), img.height()),
                Style::default().fg(theme::TEXT),
            ),
        ]));
        if let Some(ref diag) = app.diagnostics {
            if let Some(best) = diag
                .grid_variance_scores
                .iter()
                .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
            {
                if best.0 > 1 {
                    lines.push(Line::from(vec![
                        Span::styled("  Logical: ", Style::default().fg(theme::SUBTEXT1)),
                        Span::styled(
                            format!("{}x{}", img.width() / best.0, img.height() / best.0),
                            Style::default().fg(theme::TEAL),
                        ),
                    ]));
                }
            }
        }
    }

    let p = Paragraph::new(lines);
    frame.render_widget(p, inner);
}

// ── Status bar ──────────────────────────────────────────────────────────────

fn draw_status_bar(frame: &mut Frame, app: &App, area: Rect) {
    let text_color = match app.status_level {
        StatusLevel::Info => theme::BLUE,
        StatusLevel::Success => theme::GREEN,
        StatusLevel::Error => theme::RED,
    };

    let icon = match app.status_level {
        StatusLevel::Info => "\u{25cf} ",
        StatusLevel::Success => "\u{2713} ",
        StatusLevel::Error => "\u{2717} ",
    };

    let status = Paragraph::new(Line::from(vec![
        Span::styled(" ", Style::default()),
        Span::styled(icon, Style::default().fg(text_color)),
        Span::styled(&app.status_message, Style::default().fg(text_color)),
    ]))
    .style(Style::default().bg(theme::MANTLE));
    frame.render_widget(status, area);
}

// ── Keybinding bar ──────────────────────────────────────────────────────────

fn draw_keybindings(frame: &mut Frame, app: &App, area: Rect) {
    let bindings: &[(&str, &str)] = match app.active_tab {
        Tab::Preview => &[
            ("q", "Quit"),
            ("Tab", "Next"),
            ("Space", "Process"),
            ("o", "Open"),
            ("s", "Save"),
            ("r", "Reset"),
        ],
        Tab::Settings => &[
            ("q", "Quit"),
            ("Tab", "Next"),
            ("\u{2191}\u{2193}/jk", "Select"),
            ("\u{2190}\u{2192}/hl", "Adjust"),
            ("r", "Reset"),
        ],
        Tab::Diagnostics => &[
            ("q", "Quit"),
            ("Tab", "Next"),
            ("Space", "Process"),
        ],
    };

    let mut spans: Vec<Span> = vec![Span::raw(" ")];
    for (i, (key, desc)) in bindings.iter().enumerate() {
        if i > 0 {
            spans.push(Span::raw("  "));
        }
        spans.push(Span::styled(
            format!(" {} ", key),
            Style::default()
                .fg(theme::CRUST)
                .bg(theme::LAVENDER)
                .add_modifier(Modifier::BOLD),
        ));
        spans.push(Span::styled(
            format!(" {}", desc),
            Style::default().fg(theme::SUBTEXT0),
        ));
    }

    let p = Paragraph::new(Line::from(spans)).style(Style::default().bg(theme::CRUST));
    frame.render_widget(p, area);
}

// ── Text input modal ────────────────────────────────────────────────────────

fn draw_text_input(frame: &mut Frame, app: &App) {
    let area = frame.area();
    // Center a popup — wider than before
    let popup_w = (area.width.saturating_sub(4)).min(80);
    let popup_h = 7;
    let x = (area.width.saturating_sub(popup_w)) / 2;
    let y = (area.height.saturating_sub(popup_h)) / 2;
    let popup = Rect::new(x, y, popup_w, popup_h);

    frame.render_widget(Clear, popup);

    let title = match app.text_input_mode {
        Some(super::app::TextInputMode::OpenFile) => " Open File ",
        Some(super::app::TextInputMode::SaveFile) => " Save File ",
        None => "",
    };

    // Check if the expanded path exists (for visual feedback)
    let expanded = shellexpand::tilde(&app.text_input_buffer);
    let path_exists = std::path::Path::new(expanded.as_ref()).exists();

    let border_color = if app.text_input_buffer.is_empty() {
        theme::SURFACE2
    } else if path_exists {
        theme::GREEN
    } else {
        theme::SURFACE2
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(border_color))
        .title(Span::styled(
            title,
            Style::default()
                .fg(theme::LAVENDER)
                .add_modifier(Modifier::BOLD),
        ))
        .style(Style::default().bg(theme::SURFACE0));
    let inner = block.inner(popup);
    frame.render_widget(block, popup);

    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1), // Hint
            Constraint::Length(1), // Spacer
            Constraint::Length(1), // Input
            Constraint::Min(0),   // Remaining
        ])
        .split(inner);

    // Hint line
    let hint = Paragraph::new(Line::from(vec![
        Span::styled(
            "Enter path (~ expands to home dir):",
            Style::default().fg(theme::OVERLAY0),
        ),
    ]));
    frame.render_widget(hint, rows[0]);

    // Input with cursor
    let text = format!("{}\u{2588}", app.text_input_buffer);
    let input = Paragraph::new(text).style(Style::default().fg(theme::TEXT));
    frame.render_widget(input, rows[2]);
}
