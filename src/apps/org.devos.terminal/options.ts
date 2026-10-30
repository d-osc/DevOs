import {Gdk, Pango, activeFamily, activeTheme, type SettingsValues, type ThemeFamily, type ThemeName, type VteTypes as Vte} from '@dev-os/core';
import {terminalScheme, terminalSchemes, currentTerminalScheme} from './colors.js';
export {terminalScheme, terminalSchemes, currentTerminalScheme};
export function terminalOptions(values: SettingsValues = {}) {
    const scrollback = typeof values.scrollback === 'number' && Number.isFinite(values.scrollback) ? Math.max(100, Math.min(100000, Math.round(values.scrollback))) : 10000;
    return {font: typeof values.font === 'string' && values.font.trim() ? values.font.trim() : 'Monospace 11', scrollback,
        audibleBell: values.audibleBell === true, allowHyperlinks: values.allowHyperlinks !== false, suggestions: values.suggestions !== false,
        scrollOnOutput: values.scrollOnOutput === true, scrollOnKeystroke: values.scrollOnKeystroke !== false, rightClickPaste: values.rightClickPaste !== false};
}
export function validTerminalFont(font: string) {
    if (!font.trim() || font.length > 160) return false;
    const description = Pango.FontDescription.from_string(font);
    const size = description.get_size() / Pango.SCALE;
    return Boolean(description.get_family()) && size >= 6 && size <= 48;
}
export function applyTerminalOptions(terminal: Vte.Terminal, values: SettingsValues, theme: ThemeName = activeTheme(), family: ThemeFamily = activeFamily()) {
    const options = terminalOptions(values), scheme = terminalScheme(theme, family);
    terminal.set_font(Pango.FontDescription.from_string(validTerminalFont(options.font) ? options.font : 'Monospace 11'));
    terminal.set_scrollback_lines(options.scrollback);
    terminal.set_audible_bell(options.audibleBell); terminal.set_allow_hyperlink(options.allowHyperlinks);
    terminal.set_scroll_on_output(options.scrollOnOutput); terminal.set_scroll_on_keystroke(options.scrollOnKeystroke);
    const color = (hex: string) => {const rgba = new Gdk.RGBA(); rgba.parse(hex); return rgba;};
    terminal.set_colors(color(scheme.foreground), color(scheme.background), scheme.palette.map(color));
    terminal.set_color_bold(color(scheme.foreground));
    terminal.set_bold_is_bright(scheme.boldIsBright);
    terminal.set_color_cursor(color(scheme.accent));
    terminal.set_color_cursor_foreground(color(scheme.background));
    terminal.set_color_highlight(color(scheme.selection));
    terminal.set_color_highlight_foreground(color(scheme.foreground));
}
