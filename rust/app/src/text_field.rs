//! A single-line native text field. GPUI's input handler keeps IME composition and UTF-16
//! selection separate from committed text, including names entered with non-Latin keyboards.
use gpui::{prelude::*, *};
use std::ops::Range;

pub struct TextField {
    pub text: String,
    pub high_contrast: bool,
    focus: FocusHandle,
    selection: Range<usize>,
    marked: Option<Range<usize>>,
    label: &'static str,
    line: Option<ShapedLine>,
    bounds: Option<Bounds<Pixels>>,
}

pub struct Submitted(pub String);
pub struct Changed;
impl EventEmitter<Changed> for TextField {}
impl EventEmitter<Submitted> for TextField {}

fn byte_offset(text: &str, utf16: usize) -> usize {
    let mut units = 0;
    for (offset, ch) in text.char_indices() {
        if units + ch.len_utf16() > utf16 {
            return offset;
        }
        units += ch.len_utf16();
    }
    text.len()
}

impl TextField {
    pub fn set_text(&mut self, text: String, cx: &mut Context<Self>) {
        self.text = text;
        self.selection = 0..self.text.len();
        self.marked = None;
        cx.notify();
    }
    pub fn new(text: String, label: &'static str, cx: &mut Context<Self>) -> Self {
        let end = text.len();
        Self {
            text,
            high_contrast: false,
            label,
            focus: cx.focus_handle(),
            selection: 0..end,
            marked: None,
            line: None,
            bounds: None,
        }
    }
    fn bytes(&self, range: Range<usize>) -> Range<usize> {
        byte_offset(&self.text, range.start)..byte_offset(&self.text, range.end)
    }
    fn units(&self, range: Range<usize>) -> Range<usize> {
        self.text[..range.start].encode_utf16().count()..self.text[..range.end].encode_utf16().count()
    }
    fn changed(&self, window: &mut Window, cx: &mut Context<Self>) {
        cx.emit(Changed);
        window.notify_text_input_changed(&self.focus);
        cx.notify();
    }
    fn key(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let key = event.keystroke.key.as_str();
        let command = event.keystroke.modifiers.control || event.keystroke.modifiers.platform;
        match key {
            "enter" if self.marked.is_none() => cx.emit(Submitted(self.text.clone())),
            "a" if command => self.selection = 0..self.text.len(),
            "c" | "x" if command => {
                cx.write_to_clipboard(ClipboardItem::new_string(self.text[self.selection.clone()].into()));
                if key == "x" {
                    self.replace_text_in_range(None, "", window, cx);
                }
            }
            "v" if command => {
                if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
                    self.replace_text_in_range(None, &text, window, cx);
                }
            }
            "backspace" | "delete" => {
                if self.selection.is_empty() {
                    if key == "backspace" {
                        self.selection.start =
                            self.text[..self.selection.start].char_indices().next_back().map_or(0, |(i, _)| i);
                    } else {
                        self.selection.end += self.text[self.selection.end..].chars().next().map_or(0, char::len_utf8);
                    }
                }
                self.replace_text_in_range(None, "", window, cx);
            }
            "left" | "right" | "home" | "end" => {
                let cursor = match key {
                    "left" => self.text[..self.selection.start].char_indices().next_back().map_or(0, |(i, _)| i),
                    "right" => {
                        self.selection.end + self.text[self.selection.end..].chars().next().map_or(0, char::len_utf8)
                    }
                    "home" => 0,
                    _ => self.text.len(),
                };
                self.selection = cursor..cursor;
            }
            _ => return,
        }
        cx.stop_propagation();
        self.changed(window, cx);
    }
}

impl EntityInputHandler for TextField {
    fn text_length_utf16(&mut self, _: &mut Window, _: &mut Context<Self>) -> Option<usize> {
        Some(self.text.encode_utf16().count())
    }
    fn set_selected_text_range(&mut self, range: Range<usize>, window: &mut Window, cx: &mut Context<Self>) {
        self.selection = self.bytes(range);
        window.notify_text_selection_changed(&self.focus);
        cx.notify();
    }
    fn text_for_range(
        &mut self,
        range: Range<usize>,
        actual: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        let range = self.bytes(range);
        *actual = Some(self.units(range.clone()));
        Some(self.text[range].into())
    }
    fn selected_text_range(&mut self, _: bool, _: &mut Window, _: &mut Context<Self>) -> Option<UTF16Selection> {
        Some(UTF16Selection { range: self.units(self.selection.clone()), reversed: false })
    }
    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        self.marked.clone().map(|r| self.units(r))
    }
    fn unmark_text(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.marked = None;
        self.changed(window, cx);
    }
    fn replace_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range.map(|r| self.bytes(r)).or(self.marked.clone()).unwrap_or(self.selection.clone());
        let text = text.replace(['\r', '\n'], "");
        self.text.replace_range(range.clone(), &text);
        let end = range.start + text.len();
        self.selection = end..end;
        self.marked = None;
        self.changed(window, cx);
    }
    fn replace_and_mark_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        selected: Option<Range<usize>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range.map(|r| self.bytes(r)).or(self.marked.clone()).unwrap_or(self.selection.clone());
        self.text.replace_range(range.clone(), text);
        self.marked = (!text.is_empty()).then_some(range.start..range.start + text.len());
        let selected = selected.unwrap_or(text.encode_utf16().count()..text.encode_utf16().count());
        self.selection = range.start + byte_offset(text, selected.start)..range.start + byte_offset(text, selected.end);
        self.changed(window, cx);
    }
    fn bounds_for_range(
        &mut self,
        range: Range<usize>,
        bounds: Bounds<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let range = self.bytes(range);
        let line = self.line.as_ref()?;
        Some(Bounds::from_corners(
            point(bounds.left() + line.x_for_index(range.start), bounds.top()),
            point(bounds.left() + line.x_for_index(range.end), bounds.bottom()),
        ))
    }
    fn character_index_for_point(
        &mut self,
        point: Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        let index = self.line.as_ref()?.closest_index_for_x(point.x - self.bounds?.left());
        Some(self.text[..index].encode_utf16().count())
    }
}

impl Focusable for TextField {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}
impl Render for TextField {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let entity = cx.entity();
        div()
            .id("text-input")
            .role(Role::TextInput)
            .aria_label(self.label)
            .aria_value(self.text.clone())
            .track_focus(&self.focus)
            .tab_index(0)
            .border_1()
            .border_color(rgb(if self.high_contrast { 0xffffff } else { 0x343438 }))
            .rounded(px(7.0))
            .bg(rgb(0x202023))
            .text_color(rgb(0xf4f4f5))
            .text_size(px(if self.label == "Effect color" { 10.0 } else { 11.0 }))
            .when(self.label == "Effect color", |field| {
                field.font_family(if cfg!(target_os = "windows") { "Cascadia Mono" } else { "Menlo" })
            })
            .px(px(7.0))
            .h(px(if self.label == "Effect color" { 30.0 } else { 28.0 }))
            .flex()
            .items_center()
            .overflow_hidden()
            .focus(|s| s.border_color(rgb(0xffffff)))
            .cursor_text()
            .on_click(|_, _, cx| cx.stop_propagation())
            .on_key_down(cx.listener(Self::key))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, event: &MouseDownEvent, window, cx| {
                    cx.stop_propagation();
                    this.focus.focus(window, cx);
                    if let (Some(line), Some(bounds)) = (&this.line, this.bounds) {
                        let index = line.closest_index_for_x(event.position.x - bounds.left());
                        this.selection = index..index;
                    }
                    if event.click_count == 2 {
                        this.selection = 0..this.text.len();
                    }
                    cx.notify();
                }),
            )
            .child(
                canvas(
                    |_, _, _| (),
                    move |bounds, _, window, cx| {
                        let field = entity.read(cx);
                        let focus = field.focus.clone();
                        let text =
                            if field.label == "Effect color" { field.text.to_uppercase() } else { field.text.clone() };
                        let selection = field.selection.clone();
                        let style = window.text_style();
                        let run = TextRun {
                            len: text.len(),
                            font: style.font(),
                            color: style.color,
                            background_color: None,
                            underline: None,
                            strikethrough: None,
                        };
                        let line = window.text_system().shape_line(
                            text.into(),
                            px(if field.label == "Effect color" { 10.0 } else { 11.0 }),
                            &[run],
                            None,
                        );
                        window.handle_input(&focus, ElementInputHandler::new(bounds, entity.clone()), cx);
                        if focus.is_focused(window) {
                            let x = line.x_for_index(selection.start);
                            let end = line.x_for_index(selection.end);
                            window.paint_quad(fill(
                                Bounds::new(
                                    point(bounds.left() + x, bounds.top()),
                                    size((end - x).max(px(1.0)), bounds.size.height),
                                ),
                                rgba(0xffffff55),
                            ));
                        }
                        let _ = line.paint(bounds.origin, px(16.0), TextAlign::Left, None, window, cx);
                        entity.update(cx, |this, _| {
                            this.line = Some(line);
                            this.bounds = Some(bounds);
                        });
                    },
                )
                .w_full()
                .h(px(16.0)),
            )
    }
}
