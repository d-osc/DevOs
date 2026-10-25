import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, GLib, Gio, createRoot, setActiveTheme} from '@dev-os/core';
import {Vte} from '@dev-os/core/vte';
import {ROOT} from '@dev-os/config';
import {ExtensionManager} from '@dev-os/extensions';
import {TerminalSettings} from '../extensions/org.devos.terminal/settings-view.js';
import {terminalOptions, validTerminalFont, applyTerminalOptions} from '../extensions/org.devos.terminal/options.js';
Gtk.init(null);
setActiveTheme('light');
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function verify() {
    assert(terminalOptions().font === 'Monospace 11' && terminalOptions({scrollback: NaN}).scrollback === 10000, 'Safe defaults preserve previous appearance');
    assert(validTerminalFont('Monospace 12') && !validTerminalFont('') && !validTerminalFont('Monospace 99'), 'Font validation requires a bounded size');
    const temporary = GLib.dir_make_tmp('devos-terminal-ui-XXXXXX');
    const preferences = new ExtensionManager({bundled: `${ROOT}/extensions`, user: `${temporary}/packages`, preferences: `${temporary}/preferences`});
    const window = new Gtk.OffscreenWindow(); window.name = 'settings'; window.set_size_request(760, 1150);
    const container = new Gtk.Box(); window.add(container); const root = createRoot(container);
    const theme = new Gtk.CssProvider(); theme.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, theme, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(container).find(widget => widget.name === id) as T;
    const terminal = new Vte.Terminal();
    const unsubscribe = preferences.subscribe(() => applyTerminalOptions(terminal, preferences.get('org.devos.terminal').state.values));
    applyTerminalOptions(terminal, preferences.get('org.devos.terminal').state.values);
    try {
        root.render(<TerminalSettings preferences={preferences} />); await wait();
        find<Gtk.Button>('terminal-font-14').emit('clicked');
        find<Gtk.SpinButton>('terminal-scrollback').set_value(20000);
        find<Gtk.Switch>('terminal-audibleBell').set_active(true);
        find<Gtk.Switch>('terminal-allowHyperlinks').set_active(false);
        find<Gtk.Switch>('terminal-scrollOnOutput').set_active(true);
        find<Gtk.Switch>('terminal-scrollOnKeystroke').set_active(false);
        find<Gtk.Switch>('terminal-suggestions').set_active(false);
        find<Gtk.Switch>('terminal-rightClickCopy').set_active(false);
        assert(terminal.get_font()!.to_string() === 'Monospace 11' && preferences.get('org.devos.terminal').state.values.scrollback === 10000, 'Preview does not change existing terminal settings');
        find<Gtk.Button>('terminal-settings-apply').emit('clicked');
        assert(terminal.get_font()!.to_string() === 'Monospace 14' && terminal.get_scrollback_lines() === 20000 && terminal.get_audible_bell(), 'Apply updates real VTE font, scrollback and bell');
        assert(!terminal.get_allow_hyperlink() && terminal.get_scroll_on_output() && !terminal.get_scroll_on_keystroke(), 'Real VTE behavior follows preferences');
        assert(preferences.get('org.devos.terminal').state.values.suggestions === false, 'Command suggestions can be disabled and persisted');
        assert(preferences.get('org.devos.terminal').state.values.rightClickCopy === false, 'Right-click copy can be switched off and persisted');
        const background = terminal.get_color_background_for_draw();
        assert(Math.abs(background.red - 0xfa / 255) < .01 && Math.abs(background.blue - 0xfd / 255) < .01, 'Real VTE background follows the active (Light) theme');
        setActiveTheme('dark'); applyTerminalOptions(terminal, preferences.get('org.devos.terminal').state.values);
        assert(Math.abs(terminal.get_color_background_for_draw().red - 0x19 / 255) < .01, 'Switching the theme recolors an open VTE terminal');
        assert(terminal.get_bold_is_bright(), 'Dark uses bright colors for bold text so the prompt stays readable');
        find<Gtk.Entry>('terminal-font').set_text('Monospace 99');
        assert(!find('terminal-settings-apply').sensitive, 'Invalid font cannot be applied');
        find<Gtk.Button>('terminal-settings-reset').emit('clicked');
        assert(find<Gtk.Entry>('terminal-font').get_text() === 'Monospace 14', 'Reset restores saved preferences');
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT');
        if (screenshot) {window.show_all(); await wait(); window.get_pixbuf()!.savev(screenshot, 'png', [], []);}
    } finally {
        unsubscribe(); terminal.destroy(); root.unmount(); window.destroy(); preferences.dispose();
        for (const relative of ['preferences/org.devos.terminal.json', 'preferences', '']) {const file = Gio.File.new_for_path(`${temporary}/${relative}`); if (file.query_exists(null)) file.delete(null);}
    }
    print('PASS: Terminal draft isolation, Apply/Reset, invalid fonts and real VTE appearance/behavior updates');
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
