import {React, Gtk, Gdk, GLib, createRoot, Box} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {PanelLanguage, PanelLanguageChoices, keyboardLabel} from '../extensions/org.devos.panel/view.js';
import type {WindowControls, KeyboardLayout} from '@dev-os/services/windows';
Gtk.init(null);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {resolve(); return GLib.SOURCE_REMOVE;}));
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
async function verify() {
    let layouts: KeyboardLayout[] = [{index: 0, name: 'English (US)', active: true}, {index: 1, name: 'Thai', active: false}];
    const listeners = new Set<() => void>(); let chosen = -1, settings = 0;
    const controls: WindowControls = {state: [], get keyboardLayouts() {return layouts;}, subscribe(listener) {listeners.add(listener); return () => {listeners.delete(listener);};}, activate() {}, toggle() {}, setKeyboardLayout(index) {chosen = index; layouts = layouts.map(layout => ({...layout, active: layout.index === index})); listeners.forEach(listener => listener());}};
    const window = new Gtk.Window(); window.set_default_size(320, 280);
    const root = createRoot(window);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replaceAll('@ACCENT@', '#88e0c0')));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(window).find(widget => widget.name === id) as T;
    try {
        root.render(<Box orientation="vertical"><PanelLanguage controls={controls} showSettings={() => {settings++;}} /><PanelLanguageChoices layouts={layouts} choose={index => controls.setKeyboardLayout!(index)} settings={() => {settings++;}} /></Box>); window.show_all(); await wait();
        assert(find<Gtk.Label>('panel-language-label').get_text() === 'EN', 'Panel reflects actual active keyboard layout');
        find<Gtk.Button>('panel-language-1').emit('clicked'); await wait();
        assert(chosen === 1 && find<Gtk.Label>('panel-language-label').get_text() === 'TH', 'Selecting Thai calls native layout control and updates indicator');
        layouts = layouts.map(layout => ({...layout, active: layout.index === 0})); listeners.forEach(listener => listener()); await wait();
        assert(find<Gtk.Label>('panel-language-label').get_text() === 'EN', 'External shortcut changes update the panel');
        find<Gtk.Button>('panel-language-settings').emit('clicked'); assert(settings === 1, 'Language settings link routes correctly');
        assert(keyboardLabel('English (UK)') === 'EN' && keyboardLabel('German') === 'DE', 'Abbreviations match supported keyboard layouts');
        find<Gtk.Button>('panel-language').emit('clicked'); await wait();
    } finally {root.unmount(); window.destroy(); await wait(); Gtk.StyleContext.remove_provider_for_screen(Gdk.Screen.get_default()!, css);}
    assert(listeners.size === 0, 'Panel releases layout subscription and popup');
    print('PASS: panel EN/TH indicator, language selection, external updates, settings link and cleanup');
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
