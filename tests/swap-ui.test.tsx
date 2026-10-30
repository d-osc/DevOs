import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, GLib, Box, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {SystemSettings} from '../src/apps/org.devos.settings/system-view.js';
import {SwapSettings} from '../src/apps/org.devos.settings/swap-view.js';
import {emptySwap, gigabytesToMiB, draftProblem, draftOf, formatSize, type SwapAction, type SwapControls, type SwapState} from '../src/apps/org.devos.settings/swap.js';
import type {SystemControls, SystemState} from '../src/apps/org.devos.settings/system.js';
Gtk.init(null);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 170, () => {resolve(); return GLib.SOURCE_REMOVE;}));
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
const MIB = 1048576;
const base: SwapState = {...emptySwap, memTotalMiB: 8192, maxMiB: 16384, maxFileMiB: 8000, fileAllowed: true, type: 'zram', percent: 100, sizeMiB: 8192, algorithm: 'zstd', swappiness: 100, currentSwappiness: 100,
    active: {type: 'zram', sizeBytes: 8192 * MIB, usedBytes: 1024 * MIB, dataBytes: 3000 * MIB, compressedBytes: 1000 * MIB, memoryBytes: 1100 * MIB, algorithm: 'zstd'}};
/** In-memory stand-in for the helper: `set` validates like the real one and echoes the new state. */
function fakeControls(initial: Partial<SwapState>, calls: string[]): SwapControls & {state: SwapState; fail?: string} {
    const controls = {
        state: {...base, ...initial} as SwapState, fail: undefined as string | undefined,
        async request(action: SwapAction, ...args: string[]) {
            calls.push([action, ...args].join(' '));
            if (controls.fail && action === 'set') throw new Error(controls.fail);
            if (action === 'set') {
                const value = (key: string) => args.find(arg => arg.startsWith(`${key}=`))?.slice(key.length + 1);
                const s = controls.state, type = value('type') as SwapState['type'], percent = value('percent') ? Number(value('percent')) : null, mib = value('mib') ? Number(value('mib')) : percent ? Math.floor(s.memTotalMiB * percent / 100) : s.sizeMiB;
                controls.state = {...s, type, percent, sizeMiB: mib, algorithm: (value('algorithm') ?? s.algorithm) as SwapState['algorithm'], swappiness: Number(value('swappiness')),
                    active: type === 'off' ? {...s.active, type: 'none', sizeBytes: 0, usedBytes: 0} : {...s.active, type: type === 'file' ? 'file' : 'zram', sizeBytes: mib * MIB}};
            }
            return controls.state;
        },
        destroy() {calls.push('destroy');}
    };
    return controls;
}
async function verify() {
    // Pure helpers first.
    assert(gigabytesToMiB('6.5') === 6656 && gigabytesToMiB('4') === 4096 && gigabytesToMiB('0,5') === 512, 'Custom gigabytes become MiB');
    for (const bad of ['', 'abc', '-1', '1e3', '4 GB', '1.234']) assert(Number.isNaN(gigabytesToMiB(bad)), `"${bad}" is not a size`);
    assert(formatSize(8192 * MIB) === '8.0 GB' && formatSize(512 * MIB) === '512 MB', 'Sizes are readable');
    assert(draftProblem(base, {...draftOf(base), percent: null, mib: 255}) !== '' && draftProblem(base, {...draftOf(base), percent: null, mib: 16385}) !== '' && draftProblem(base, {...draftOf(base), percent: null, mib: 16384}) === '', 'Limits are 256 MB to twice the RAM');
    assert(draftProblem(base, {...draftOf(base), type: 'file', percent: 100}) !== '' && draftProblem(base, {...draftOf(base), type: 'file', percent: 50}) === '', 'A file must fit the disk');
    assert(draftProblem({...base, fileAllowed: false, fileReason: 'Live'}, {...draftOf(base), type: 'file'}) === 'Live', 'A disk file is refused where the helper refuses it');

    const window = new Gtk.OffscreenWindow(); window.name = 'swap'; window.set_size_request(900, 1100); const root = createRoot(window);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/src/apps/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(window).find(widget => widget.name === id) as T;
    const text = (id: string) => find<Gtk.Label>(id)?.get_text() ?? '';
    const selected = (prefix: string, ids: string[]) => ids.filter(id => find<Gtk.Button>(`${prefix}${id}`)?.get_style_context().has_class('power-mode-selected'));
    const types = ['zram', 'file', 'off'], sizes = ['25', '50', '100', '150', '200', 'custom'];
    try {
        // Default: compressed RAM as large as RAM, with usage and compression ratio.
        const calls: string[] = [], controls = fakeControls({}, calls);
        root.render(<SwapSettings controls={controls} />); window.show_all(); await wait();
        const labels = widgets(window).filter((w): w is Gtk.Label => w instanceof Gtk.Label).map(l => l.get_text());
        for (const expected of ['Memory & swap', 'Compressed RAM (zram)', 'Swap file on disk', 'Off', 'Size', 'Compression', 'Swappiness']) assert(labels.includes(expected), `Shows "${expected}"`);
        assert(text('swap-memory') === 'Installed memory: 8.0 GB', 'Shows the installed memory');
        assert(text('swap-usage') === '1.0 GB used of 8.0 GB (compressed RAM)' && text('swap-ratio') === 'Compressed 3.0:1, taking 1.1 GB of RAM', 'Shows usage and the compression ratio');
        assert(selected('swap-type-', types).join() === 'zram' && selected('swap-size-', sizes).join() === '100', 'The default is zram at 100% of RAM');
        assert(text('swap-size-summary') === '8.0 GB (100% of RAM)', 'Summarizes the size');
        assert(!find<Gtk.Button>('swap-apply').sensitive, 'Nothing to apply yet');
        assert(Math.round(find<Gtk.Scale>('swap-swappiness').get_value()) === 100, 'Swappiness starts at the saved value');

        // Choose 50%, lz4 and a lower swappiness, then apply.
        find<Gtk.Button>('swap-size-50').emit('clicked'); await wait();
        assert(find<Gtk.Button>('swap-apply').sensitive && text('swap-note') === 'Apply to use the new swap setting.' && text('swap-size-summary') === '4.0 GB (50% of RAM)', 'A change enables Apply');
        find<Gtk.ComboBoxText>('swap-algorithm').set_active_id('lz4'); find<Gtk.Scale>('swap-swappiness').set_value(60); await wait();
        find<Gtk.Button>('swap-apply').emit('clicked'); await wait(); await wait();
        assert(calls.includes('set type=zram percent=50 algorithm=lz4 swappiness=60'), `Apply sends the validated settings (${calls.join(' | ')})`);
        assert(text('swap-note') === 'Swap updated.' && !find<Gtk.Button>('swap-apply').sensitive && selected('swap-size-', sizes).join() === '50', 'Applying saves and clears the draft');

        // Custom size with validation.
        find<Gtk.Button>('swap-size-custom').emit('clicked'); await wait();
        const entry = find<Gtk.Entry>('swap-custom-gb'); assert(!!entry && entry.get_text() === '4', 'Custom size starts from the current size in GB');
        entry.set_text('99'); await wait();
        assert(!find<Gtk.Button>('swap-apply').sensitive && text('swap-problem').includes('twice the RAM'), 'A size over twice the RAM is refused');
        entry.set_text('0.1'); await wait(); assert(!find<Gtk.Button>('swap-apply').sensitive && text('swap-problem').includes('at least 256'), 'A tiny size is refused');
        entry.set_text('abc'); await wait(); assert(!find<Gtk.Button>('swap-apply').sensitive, 'Text is not a size');
        entry.set_text('6.5'); await wait();
        assert(find<Gtk.Button>('swap-apply').sensitive && text('swap-problem') === '', 'A valid custom size can be applied');
        find<Gtk.Button>('swap-apply').emit('clicked'); await wait(); await wait();
        assert(calls.includes('set type=zram mib=6656 algorithm=lz4 swappiness=60'), `Custom sizes are sent in MiB (${calls.join(' | ')})`);

        // Off hides size, compression and swappiness.
        find<Gtk.Button>('swap-type-off').emit('clicked'); await wait();
        assert(!find('swap-algorithm') && !find('swap-swappiness') && !find('swap-size-50'), 'Off has no size, compression or swappiness');
        find<Gtk.Button>('swap-apply').emit('clicked'); await wait(); await wait();
        assert(calls.includes('set type=off swappiness=60') && text('swap-usage') === 'No swap is active.', 'Turning swap off is applied');

        // Failures stay visible and keep the draft.
        controls.fail = 'Not enough free memory to replace the current compressed swap.';
        find<Gtk.Button>('swap-type-zram').emit('clicked'); await wait(); find<Gtk.Button>('swap-apply').emit('clicked'); await wait(); await wait();
        assert(text('swap-error').includes('Not enough free memory'), 'Helper failures are visible');
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT'); if (screenshot) window.get_pixbuf()!.savev(screenshot, 'png', [], []);
        root.render(<Box />); await wait(); assert(calls.includes('destroy'), 'Closing the page releases the helper');

        // Live session: the disk swap file is disabled with the reason, and the helper limit also hides oversized presets.
        const live = fakeControls({live: true, fileAllowed: false, fileReason: 'Disk swap is not available on the Live session: its system lives in a RAM overlay, so a file would only take memory.', maxFileMiB: 0}, []);
        root.render(<SwapSettings key="live" controls={live} />); await wait();
        assert(!find<Gtk.Button>('swap-type-file').sensitive && text('swap-file-unavailable').includes('Live session'), 'The Live session cannot choose disk swap');
        assert(find<Gtk.Button>('swap-type-zram').sensitive && find<Gtk.Button>('swap-type-off').sensitive, 'Compressed RAM and Off stay available');
        const small = fakeControls({maxFileMiB: 3000, type: 'zram'}, []);
        root.render(<SwapSettings key="small" controls={small} />); await wait();
        find<Gtk.Button>('swap-type-file').emit('clicked'); await wait();
        assert(find<Gtk.Button>('swap-size-25').sensitive && !find<Gtk.Button>('swap-size-50').sensitive && text('swap-problem').includes('room'), 'A disk file only offers sizes that fit with the reserve');

        // The Power page shows the card unless Windows manages the machine.
        const sys: SystemState = {hostManaged: false, hostname: 'DevOs', os: 'DevOs', kernel: 'Linux', architecture: 'aarch64', cpu: 'ARM', processors: 8, memory: 1, session: 'wayland', desktopBuild: {}, storage: [], batteries: [], power: {available: false, active: '', profiles: [], degraded: '', error: ''}, tools: {}, hostSettings: false};
        let current = sys;
        const system: SystemControls = {async load() {return current;}, async open() {}, async profile() {return current;}, destroy() {}};
        root.render(<SystemSettings page="power" controls={system} swap={fakeControls({}, [])} navigate={() => {}} monitors={[]} />); await wait();
        assert(!!find('swap-card'), 'Power & battery page offers Memory & swap');
        current = {...sys, hostManaged: true}; find<Gtk.Button>('system-refresh').emit('clicked'); await wait();
        assert(!find('swap-card'), 'No card when Windows manages the machine');
    } finally {root.unmount(); window.destroy();}
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
print('PASS: Memory & swap settings, presets, custom size validation, compression, Live restrictions, failures');
