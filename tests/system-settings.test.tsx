import {React, Gtk, Gdk, GLib, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {SystemSettings, SystemSound} from '../extensions/org.devos.settings/system-view.js';
import {systemPages, formatBytes, type SystemControls, type SystemState, type SystemPage} from '../extensions/org.devos.settings/system.js';
import type {DeviceControls, DeviceState} from '../extensions/org.devos.panel/devices.js';
Gtk.init(null);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 170, () => {resolve(); return GLib.SOURCE_REMOVE;}));
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
async function verify() {
    let state: SystemState = {hostManaged: false, hostname: 'DevOs workstation', os: 'DevOs 0.1', kernel: 'Linux test kernel', architecture: 'aarch64', cpu: 'ARM processor', processors: 8, memory: 16 * 1024 ** 3, session: 'wayland', desktopBuild: {version: '0.3.6'}, storage: [{path: '/', total: 100 * 1024 ** 3, used: 30 * 1024 ** 3, free: 70 * 1024 ** 3}], batteries: [{name: 'Battery', percent: 76, status: 'Discharging'}], power: {available: true, active: 'balanced', profiles: ['power-saver', 'balanced'], degraded: '', error: ''}, tools: {display: true, sound: true}, hostSettings: false};
    let routed = '', opened = '', profile = '', files = 0, released = 0, fail = false;
    const controls: SystemControls = {async load() {return state;}, async open(page, host) {if (fail) throw new Error('Configuration unavailable'); opened = `${page}/${host}`;}, async profile(id) {profile = id; state = {...state, power: {...state.power, active: id}}; return state;}, destroy() {released++;}};
    const monitors = [{name: 'DevOs monitor', width: 1920, height: 1080, scale: 1, refresh: 60, primary: true}];
    const window = new Gtk.OffscreenWindow(); window.name = 'settings'; window.set_size_request(900, 900); const root = createRoot(window);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replaceAll('@ACCENT@', '#88e0c0'))); Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(window).find(widget => widget.name === id) as T;
    const show = async (page: SystemPage) => {root.render(<SystemSettings page={page} controls={controls} monitors={monitors} navigate={page => {routed = page;}} openFiles={() => {files++;}} />); window.show_all(); await wait();};
    try {
        await show('system');
        for (const page of systemPages) {find<Gtk.Button>(`system-category-${page.id}`).emit('clicked'); assert(routed === page.id, `System routes ${page.title}`);}
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT'); if (screenshot) window.get_pixbuf()!.savev(screenshot, 'png', [], []);
        await show('display'); assert(find<Gtk.Label>('system-display-0').get_text().includes('DevOs monitor'), 'Display shows actual monitor properties');
        find<Gtk.Button>('system-display-configure').emit('clicked'); await wait(); assert(opened === 'display/false', 'Native display configuration route works');
        await show('power'); find<Gtk.ComboBoxText>('system-power-profile').set_active_id('power-saver'); find<Gtk.Button>('system-power-apply').emit('clicked'); await wait(); assert(profile === 'power-saver' && !find<Gtk.Button>('system-power-apply').get_sensitive(), 'Power profiles save to the backend');
        await show('storage'); find<Gtk.Button>('system-storage-files').emit('clicked'); assert(files === 1 && formatBytes(state.memory) === '16.0 GiB', 'Storage links Files and formats actual capacity');
        await show('about'); assert(find<Gtk.Label>('system-about-version').get_text().includes('0.3.6'), 'About identifies DevOs version');
        state = {...state, hostManaged: true, hostSettings: true}; find<Gtk.Button>('system-refresh').emit('clicked'); await wait(); await show('display'); find<Gtk.Button>('system-display-configure').emit('clicked'); await wait(); assert(opened === 'display/true', 'WSL routes display configuration to its host');
        fail = true; find<Gtk.Button>('system-display-configure').emit('clicked'); await wait(); assert(find<Gtk.Label>('system-error').get_text().includes('Configuration unavailable'), 'Launcher failures are visible');
        const listeners = new Set<() => void>(); let volume = -1, muted = 0;
        const soundState: DeviceState = {connected: true, wireless: false, network: '', wifi: null, bluetooth: null, volume: 42, muted: false, battery: null, busy: false, error: ''};
        const sound: DeviceControls = {state: soundState, subscribe(listener) {listeners.add(listener); return () => {listeners.delete(listener);};}, async setVolume(value) {volume = value;}, async toggleMute() {muted++;}, async toggleWifi() {}, async toggleBluetooth() {}};
        root.render(<SystemSound controls={sound} />); await wait(); assert(volume === -1, 'Opening Sound does not change volume');
        find<Gtk.Scale>('system-sound-volume').set_value(61); await wait(); assert(volume === 61, 'Volume slider routes a debounced audio action');
        find<Gtk.Button>('system-sound-mute').emit('clicked'); assert(muted === 1, 'Mute button routes its audio action');
        root.unmount(); await wait(); assert(listeners.size === 0 && released === 1, 'System and Sound release their resources');
    } finally {root.unmount(); window.destroy(); Gtk.StyleContext.remove_provider_for_screen(Gdk.Screen.get_default()!, css);}
    print('PASS: System categories, Display, About, Storage, power profiles, audio, WSL routing and cleanup');
}
const loop = new GLib.MainLoop(null, false); let failed: unknown; void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
