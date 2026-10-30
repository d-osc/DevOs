import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, GLib, createRoot} from '@dev-os/core';
import {MicrophoneSettings} from '../src/apps/org.devos.microphone/settings-view.js';
import type {AudioControls, AudioState} from '../src/apps/org.devos.settings/audio.js';
Gtk.init(null);
const base = GLib.getenv('DEV_OS_ROOT')!;
const css = new Gtk.CssProvider();
css.load_from_data(new TextDecoder().decode(GLib.file_get_contents(`${base}/src/apps/org.devos.theme/style.css`)[1]).replace(/^/, testTheme()));
Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
const state: AudioState = {inputs: [{id: 1, name: 'internal-mic', title: 'Built-in Microphone', volume: 70, muted: false}], outputs: [], applications: [], defaultInput: 'internal-mic', defaultOutput: ''};
const controls: AudioControls = {async load() {return state;}, async volume() {}, async mute(_kind, _id, value) {state.inputs[0].muted = value;}, async select() {}, async route() {}, destroy() {}};
const window = new Gtk.OffscreenWindow(); window.name = 'settings'; window.set_size_request(800, 850);
const body = new Gtk.Box(); window.add(body); const root = createRoot(body);
let opened = false;
const noise = {async request() {return {supported: true, reason: '', mode: 'authentic' as const, active: 'authentic' as const, running: false, sources: [], device: '', noise: {available: true, reason: ''}, warning: ''};}, destroy() {}};
root.render(<MicrophoneSettings controls={controls} noise={noise} open={() => {opened = true;}} />);
const loop = new GLib.MainLoop(null, false); let failed: unknown;
function all(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(all) : [])];}
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
    try {
        window.show_all();
        const button = all(body).find(widget => widget.name === 'microphone-settings-open') as Gtk.Button;
        button.emit('clicked'); if (!opened) throw new Error('Microphone launch action failed');
        if (!all(body).some(widget => widget.name === 'audio-device-source')) throw new Error('Input selector missing');
        if (all(body).some(widget => widget.name === 'audio-device-sink')) throw new Error('Output settings leaked into microphone page');
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            try {window.get_pixbuf()!.savev(`${base}/build/microphone-settings.png`, 'png', [], []); print('PASS: microphone settings controls, launch action and GTK render (fixture device)');}
            catch (error) {failed = error;}
            loop.quit(); return GLib.SOURCE_REMOVE;
        });
    } catch (error) {failed = error; loop.quit();}
    return GLib.SOURCE_REMOVE;
});
loop.run(); root.unmount(); window.destroy(); if (failed) throw failed;
