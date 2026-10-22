import {Gdk, Pango, type SettingsValues, type VteTypes as Vte} from '@dev-os/core';
export const terminalSchemes = {
    midnight: {title: 'Midnight', background: '#181b21', foreground: '#dfe3eb', accent: '#88e0c0'},
    slate: {title: 'Slate', background: '#21323d', foreground: '#e0edf0', accent: '#91d8ed'},
    paper: {title: 'Paper', background: '#f3eee4', foreground: '#28333d', accent: '#276657'},
};
export function terminalOptions(values: SettingsValues = {}) {
    const scrollback = typeof values.scrollback === 'number' && Number.isFinite(values.scrollback) ? Math.max(100, Math.min(100000, Math.round(values.scrollback))) : 10000;
    return {font: typeof values.font === 'string' && values.font.trim() ? values.font.trim() : 'Monospace 11', scrollback,
        scheme: Object.hasOwn(terminalSchemes, String(values.scheme)) ? String(values.scheme) as keyof typeof terminalSchemes : 'midnight',
        audibleBell: values.audibleBell === true, allowHyperlinks: values.allowHyperlinks !== false,
        scrollOnOutput: values.scrollOnOutput === true, scrollOnKeystroke: values.scrollOnKeystroke !== false};
}
export function validTerminalFont(font: string) {
    if (!font.trim() || font.length > 160) return false;
    const description = Pango.FontDescription.from_string(font);
    const size = description.get_size() / Pango.SCALE;
    return Boolean(description.get_family()) && size >= 6 && size <= 48;
}
export function applyTerminalOptions(terminal: Vte.Terminal, values: SettingsValues) {
    const options = terminalOptions(values), scheme = terminalSchemes[options.scheme];
    terminal.set_font(Pango.FontDescription.from_string(validTerminalFont(options.font) ? options.font : 'Monospace 11'));
    terminal.set_scrollback_lines(options.scrollback);
    terminal.set_audible_bell(options.audibleBell); terminal.set_allow_hyperlink(options.allowHyperlinks);
    terminal.set_scroll_on_output(options.scrollOnOutput); terminal.set_scroll_on_keystroke(options.scrollOnKeystroke);
    const foreground = new Gdk.RGBA(), background = new Gdk.RGBA();
    foreground.parse(scheme.foreground); background.parse(scheme.background); terminal.set_colors(foreground, background, null);
}
