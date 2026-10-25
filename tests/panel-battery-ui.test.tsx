import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, GLib, Box, Label, createRoot, setBaseIconProvider} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {renderIcon} from '../extensions/org.devos.icons/fa-icons.js';
import {PanelBattery} from '../extensions/org.devos.panel/battery-view.js';
import {readPower, type PowerFs} from '../extensions/org.devos.panel/battery.js';
Gtk.init(null);
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {resolve(); return GLib.SOURCE_REMOVE;}));
const fixture = (supplies: Record<string, Record<string, string>>): PowerFs => ({
    list: path => path.endsWith('power_supply') ? Object.keys(supplies) : [],
    read: path => { const [, , , , name, file] = path.split('/'); return supplies[name]?.[file] ?? ''; }
});
const cases: [string, Record<string, Record<string, string>>, RegExp][] = [
    ['Discharging 64%', {BAT0: {type: 'Battery', status: 'Discharging', capacity: '64'}, AC: {type: 'Mains', online: '0'}}, /^64%$/],
    ['Discharging 9%', {BAT0: {type: 'Battery', status: 'Discharging', capacity: '9'}}, /^9%$/],
    ['Charging 72%', {BAT0: {type: 'Battery', status: 'Charging', capacity: '72'}, AC: {type: 'Mains', online: '1'}}, /^72% · Charging$/],
    ['Full', {BAT0: {type: 'Battery', status: 'Full', capacity: '100'}, AC: {type: 'Mains', online: '1'}}, /^100% · Full$/],
    ['qcom charging, energy only', {'qcom-battmgr-bat': {type: 'Battery', status: 'Charging', present: '1', energy_now: '25000000', energy_full: '50000000'}, 'qcom-battmgr-ac': {type: 'Mains', online: '1'}}, /^50% · Charging$/],
    ['qcom charging, no percent', {'qcom-battmgr-bat': {type: 'Battery', status: 'Charging', present: '1'}, 'qcom-battmgr-ac': {type: 'Mains', online: '1'}}, /^Charging$/],
    ['qcom discharging, no percent', {'qcom-battmgr-bat': {type: 'Battery', status: 'Discharging', present: '1'}, 'qcom-battmgr-ac': {type: 'Mains', online: '0'}}, /^Discharging$/],
    ['AC only, no battery', {'qcom-battmgr-ac': {type: 'Mains', online: '1'}}, /^No battery data$/]
];
async function verify() {
    const window = new Gtk.OffscreenWindow(); window.name = 'battery'; window.set_size_request(360, 380);
    const dark = new Gtk.CssProvider(); dark.load_from_data(new TextEncoder().encode('#panel { background: #1c2128; padding: 8px; } #panel label { color: #dce5ef; }'));
    const container = new Gtk.Box(); window.add(container); const root = createRoot(container);
    const theme = new Gtk.CssProvider(); theme.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, dark, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION - 1); Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, theme, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    setBaseIconProvider((name, size, color) => renderIcon(name, size, color, {pack: 'classic', style: 'solid'}));
    try {
        root.render(<Box orientation="vertical" spacing={6} id="panel">{cases.map(([title, supplies]) => {
            const power = readPower(fixture(supplies));
            return <Box key={title} spacing={10}><Label widthRequest={170} xalign={0}>{title}</Label>
                <PanelBattery percent={power.battery} status={power.batteryStatus} found={power.batteryFound} acOnline={power.acOnline} acFound={power.acFound} /></Box>;
        })}<Box id="none"><PanelBattery percent={null} status="Unknown" found={false} acOnline={false} acFound={false} /></Box></Box>);
        window.show_all(); await wait();
        const labels = widgets(container).filter(widget => widget.get_style_context().has_class('panel-battery-label')) as Gtk.Label[];
        assert(labels.length === cases.length, `One indicator per supply set, got ${labels.length}`);
        cases.forEach(([title, , pattern], index) => assert(pattern.test(labels[index].label), `${title}: label "${labels[index].label}"`));
        const images = widgets(container).filter(widget => widget instanceof Gtk.Image && widget.get_parent()?.name === 'panel-battery') as Gtk.Image[];
        assert(images.every(image => image.get_storage_type() === Gtk.ImageType.PIXBUF), 'Every battery state paints a Font Awesome glyph');
        assert(!widgets(container).some(widget => widget.name === 'none' && (widget as Gtk.Container).get_children().length), 'No power supplies renders nothing');
        const shot = GLib.getenv('DEV_OS_TEST_SCREENSHOT');
        if (shot) window.get_pixbuf()!.savev(shot, 'png', [], []);
    } finally {setBaseIconProvider(undefined); root.unmount(); window.destroy();}
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
print('PASS: panel battery indicator renders discharging, charging, full, energy-only, no-percent and no-battery states');
