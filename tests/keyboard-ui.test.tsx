import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, GLib, Box, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {InputSettings, type InputControls} from '../extensions/org.devos.settings/input-view.js';
import {KeyboardHotkeySettings} from '../extensions/org.devos.settings/keyboard-view.js';
import {unsupportedKeyboard, type KeyboardAction, type KeyboardControls, type KeyboardPreferences, type KeyboardState} from '../extensions/org.devos.settings/keyboard.js';
Gtk.init(null);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 170, () => {resolve(); return GLib.SOURCE_REMOVE;}));
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
/** In-memory stand-in with the helper's rules: preferences are validated and saved, the Fn mode is written to the "kernel". */
function fakeControls(initial: Partial<KeyboardState>, calls: string[]): KeyboardControls & {state: KeyboardState; fail?: string} {
    const supported = {supported: true, reason: ''};
    const controls = {
        state: {...unsupportedKeyboard, fn: {...supported, mode: 'locked'}, backlight: {...supported, name: 'asus::kbd_backlight', max: 3, level: 2}, sensor: {...supported, lux: 120.4}, idle: supported, mains: true, ...initial} as KeyboardState, fail: undefined as string | undefined,
        async request(action: KeyboardAction, ...args: string[]) {
            calls.push([action, ...args].join(':'));
            if (controls.fail) throw new Error(controls.fail);
            if (action === 'set') {
                const [key, value] = args, s = controls.state, settings: KeyboardPreferences = {...s.settings};
                if (key === 'fn') controls.state = {...s, fn: {...s.fn, mode: value as 'locked' | 'normal'}};
                else {
                    if (key === 'auto-brighten') settings.autoBrighten = value === 'on';
                    if (key === 'auto-dim') settings.autoDim = value === 'on';
                    if (key === 'sleep') settings.sleep = value as KeyboardPreferences['sleep'];
                    if (key === 'sleep-both') settings.sleepBoth = Number(value);
                    if (key === 'sleep-battery') settings.sleepBattery = Number(value);
                    controls.state = {...s, settings};
                }
            }
            return controls.state;
        },
        destroy() {calls.push('destroy');}
    };
    return controls;
}
async function verify() {
    const window = new Gtk.OffscreenWindow(); window.name = 'keyboard'; window.set_size_request(1000, 1100); const root = createRoot(window);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(window).find(widget => widget.name === id) as T;
    const text = (id: string) => find<Gtk.Label>(id)?.get_text() ?? '';
    const labels = () => widgets(window).filter((w): w is Gtk.Label => w instanceof Gtk.Label).map(l => l.get_text());
    const picked = (...ids: string[]) => ids.filter(id => find<Gtk.Button>(id)?.get_style_context().has_class('power-mode-selected'));
    const click = (id: string) => find<Gtk.Button>(id).emit('clicked');
    try {
        // Supported hardware: the MyASUS texts, radios and switches drive the helper.
        const calls: string[] = [], controls = fakeControls({}, calls);
        root.render(<KeyboardHotkeySettings controls={controls} />); window.show_all(); await wait();
        const all = labels();
        for (const expected of ['Function key', 'An optional function key setting that allows you to change your keyboard hotkeys.', 'Locked Fn key', 'Press F1-F12 to initiate the specified hotkey function.', 'Normal Fn key', 'Press F1-F12 to initiate the F1-F12 function defined by your system or a specific app.',
            'Automatic keyboard backlight', 'Automatically adjusts the keyboard backlight brightness based on the current light conditions using the built-in ambient light sensor.', 'Auto-brighten', 'The keyboard backlight turns on when the light conditions change from bright to dark.', 'Auto-dim', 'The keyboard backlight turns off when the light conditions change from dark to bright.',
            'Keyboard backlight sleep mode', 'Do nothing', 'Keep the keyboard backlight always on', 'While on battery or on AC power', 'Select the idle time before the keyboard backlight turns off while on battery or AC power', 'While on battery power only', 'Select the idle time before the keyboard backlight turns off while on battery power'])
            assert(all.includes(expected), `Shows "${expected}"`);
        assert(picked('keyboard-fn-locked', 'keyboard-fn-normal').join() === 'keyboard-fn-locked', 'Locked Fn key is selected as reported');
        assert(!find<Gtk.Switch>('keyboard-auto-brighten').active && !find<Gtk.Switch>('keyboard-auto-dim').active && text('keyboard-auto-brighten-state') === 'Off', 'Both automatic switches default to Off');
        assert(picked('keyboard-sleep-nothing', 'keyboard-sleep-both', 'keyboard-sleep-battery').join() === 'keyboard-sleep-nothing', 'Do nothing is the default sleep mode');
        assert(!find<Gtk.ComboBoxText>('keyboard-timeout-both').sensitive && !find<Gtk.ComboBoxText>('keyboard-timeout-battery').sensitive, 'Idle-time dropdowns are disabled unless their mode is selected');
        assert(find<Gtk.ComboBoxText>('keyboard-timeout-both').get_active_id() === '60' && text('keyboard-lux') === 'Ambient light: 120 lux', 'One minute is the default and the light level is shown');
        click('keyboard-fn-normal'); await wait();
        assert(calls.includes('set:fn:normal') && picked('keyboard-fn-locked', 'keyboard-fn-normal').join() === 'keyboard-fn-normal', 'Choosing Normal Fn key is applied');
        find<Gtk.Switch>('keyboard-auto-brighten').set_active(true); await wait();
        assert(calls.includes('set:auto-brighten:on') && find<Gtk.Switch>('keyboard-auto-brighten').active && text('keyboard-auto-brighten-state') === 'On' && !find<Gtk.Switch>('keyboard-auto-dim').active, 'Auto-brighten is saved on its own');
        find<Gtk.Switch>('keyboard-auto-dim').set_active(true); await wait();
        assert(calls.includes('set:auto-dim:on'), 'Auto-dim is saved');
        click('keyboard-sleep-both'); await wait();
        assert(calls.includes('set:sleep:both') && find<Gtk.ComboBoxText>('keyboard-timeout-both').sensitive && !find<Gtk.ComboBoxText>('keyboard-timeout-battery').sensitive, 'Selecting a sleep mode enables only its dropdown');
        find<Gtk.ComboBoxText>('keyboard-timeout-both').set_active_id('300'); await wait();
        assert(calls.includes('set:sleep-both:300') && controls.state.settings.sleepBoth === 300, 'The idle time is saved in seconds');
        const options = find<Gtk.ComboBoxText>('keyboard-timeout-both').get_model()!; const titles: string[] = [];
        options.foreach((_model, _path, iter) => {titles.push(String(options.get_value(iter, 0))); return false;});
        assert(titles.join('|') === '10 Second(s)|30 Second(s)|1 Minute(s)|2 Minute(s)|5 Minute(s)|10 Minute(s)', `Offers 10 s to 10 min, got ${titles.join('|')}`);
        click('keyboard-sleep-battery'); await wait();
        assert(find<Gtk.ComboBoxText>('keyboard-timeout-battery').sensitive && !find<Gtk.ComboBoxText>('keyboard-timeout-both').sensitive, 'Battery-only enables its own dropdown');
        find<Gtk.ComboBoxText>('keyboard-timeout-battery').set_active_id('10'); await wait();
        assert(calls.includes('set:sleep-battery:10'), 'Battery-only idle time is saved separately');
        controls.fail = 'Administrator access was denied'; click('keyboard-fn-locked'); await wait();
        assert(text('keyboard-hotkey-error').includes('denied') && picked('keyboard-fn-locked', 'keyboard-fn-normal').join() === 'keyboard-fn-normal', 'Helper failures are visible and the selection is not faked');
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT'); if (screenshot) window.get_pixbuf()!.savev(screenshot, 'png', [], []);
        root.render(<Box />); await wait(); assert(calls.includes('destroy'), 'Closing the page releases the helper');

        // Saved preferences are shown on the next visit.
        const saved = fakeControls({settings: {autoBrighten: true, autoDim: false, sleep: 'battery', sleepBoth: 30, sleepBattery: 120}}, []);
        root.render(<KeyboardHotkeySettings key="saved" controls={saved} />); await wait();
        assert(find<Gtk.Switch>('keyboard-auto-brighten').active && !find<Gtk.Switch>('keyboard-auto-dim').active && picked('keyboard-sleep-battery').length === 1, 'Saved switches and sleep mode come back');
        assert(find<Gtk.ComboBoxText>('keyboard-timeout-battery').get_active_id() === '120' && find<Gtk.ComboBoxText>('keyboard-timeout-both').get_active_id() === '30', 'Saved idle times come back');

        // This Snapdragon laptop: LED but no Fn lock node and no light sensor. Controls are disabled with reasons, nothing is faked.
        const board = fakeControls({fn: {supported: false, reason: 'This keyboard has no Fn lock control in the kernel (asus-nb-wmi fn_lock is missing).', mode: ''}, sensor: {supported: false, reason: 'This laptop has no ambient light sensor that the kernel exposes.', lux: null}}, []);
        root.render(<KeyboardHotkeySettings key="board" controls={board} />); await wait();
        assert(['keyboard-fn-locked', 'keyboard-fn-normal'].every(id => !find<Gtk.Button>(id).sensitive) && picked('keyboard-fn-locked', 'keyboard-fn-normal').length === 0, 'No Fn lock: both radios disabled, none selected');
        assert(text('keyboard-fn-unsupported').startsWith('Not supported on this device.') && text('keyboard-fn-unsupported').includes('fn_lock'), 'The missing Fn lock is explained');
        assert(!find<Gtk.Switch>('keyboard-auto-brighten').sensitive && !find<Gtk.Switch>('keyboard-auto-dim').sensitive && text('keyboard-light-nosensor').includes('ambient light sensor') && !find('keyboard-lux'), 'No sensor: switches disabled with the reason');
        assert(find<Gtk.Button>('keyboard-sleep-both').sensitive && !find('keyboard-sleep-unsupported'), 'Idle sleep still works without a sensor');

        // No backlight and no idle protocol.
        const bare = fakeControls({backlight: {supported: false, reason: 'This keyboard has no backlight that the kernel can control.', name: '', max: 0, level: 0}, idle: {supported: false, reason: 'No Wayland compositor is running in this session.'}}, []);
        root.render(<KeyboardHotkeySettings key="bare" controls={bare} />); await wait();
        assert(!find<Gtk.Button>('keyboard-sleep-both').sensitive && !find<Gtk.Switch>('keyboard-auto-dim').sensitive && !!find('keyboard-light-unsupported') && !!find('keyboard-sleep-nobacklight'), 'Without a backlight every backlight control is disabled');
        const sessionless = fakeControls({idle: {supported: false, reason: 'The compositor does not offer idle notifications (ext-idle-notify-v1).'}}, []);
        root.render(<KeyboardHotkeySettings key="noidle" controls={sessionless} />); await wait();
        assert(!find<Gtk.Button>('keyboard-sleep-both').sensitive && text('keyboard-sleep-unsupported').includes('ext-idle-notify-v1'), 'A compositor without idle notifications disables the sleep mode with the reason');

        // The Keyboard page shows the cards between the repeat settings and the typing test.
        const input: InputControls = {async request<T>() {return {settings: {repeat: true, delay: 500, rate: 30}, devices: ['AT keyboard'], applied: false} as T;}, destroy() {}};
        root.render(<InputSettings key="page" kind="keyboard" controls={input} hotkeys={fakeControls({}, [])} back={() => {}} language={() => {}} />); await wait();
        assert(!!find('keyboard-fn-card') && !!find('keyboard-light-card') && !!find('keyboard-sleep-card') && !!find('keyboard-test'), 'Keyboard page offers the three cards');
        root.render(<InputSettings key="mouse" kind="mouse" controls={input} back={() => {}} language={() => {}} />); await wait();
        assert(!find('keyboard-fn-card'), 'The mouse page has no keyboard cards');
    } finally {root.unmount(); window.destroy();}
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
print('PASS: Keyboard Fn key, automatic backlight and backlight sleep mode, saved, unsupported and missing-hardware states');
