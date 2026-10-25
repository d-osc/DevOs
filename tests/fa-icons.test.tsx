import {React, Gtk, Gdk, GLib, Box, Label, Image, createRoot, setBaseIconProvider, readJson} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {
    PACKS, STYLES, PACK_STYLES, DEFAULT_CHOICE, hasCombination, parseChoice, savedChoice, faName, resolveIcon, iconSvg, renderIcon,
    type IconData, type GlyphSet, type Pack, type Style
} from '../extensions/org.devos.icons/fa-icons.js';
Gtk.init(null);
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {resolve(); return GLib.SOURCE_REMOVE;}));
const index = readJson(`${ROOT}/data/icons/fa/index.json`) as {mapping: Record<string, string>; sets: Record<string, number>};
const names = Object.keys(index.mapping).map(name => `${name}-symbolic`);
const appIcons = Object.keys(index.mapping).filter(name => name.startsWith('dev-os-'));
const theme = Gtk.IconTheme.get_default(); theme.prepend_search_path(`${ROOT}/data/icons`);
assert(appIcons.length === 11, 'All eleven base applications use assets/ outlines');
for (const name of appIcons) {
    for (const suffix of ['', '-symbolic']) assert(theme.load_icon(`${name}${suffix}`, 48, Gtk.IconLookupFlags.FORCE_SIZE), `${name}${suffix} loads in GTK`);
    assert(resolveIcon(`${name}-symbolic`, DEFAULT_CHOICE), `${name} resolves through the selected Font Awesome pack`);
}

// Pack/style table matches the files generated from assets/.
const combos = PACKS.flatMap(pack => PACK_STYLES[pack].map(style => `${pack}-${style}`)).sort();
assert(PACKS.length === 16 && STYLES.length === 4, 'Sixteen packs and four styles');
assert(JSON.stringify(combos) === JSON.stringify(Object.keys(index.sets).sort()), 'PACK_STYLES matches generated icon sets');
assert(combos.length === 28, 'Twenty-eight pack/style files exist');

// Every UI icon resolves for every available combination, exactly or through the documented fallbacks.
for (const pack of PACKS) for (const style of STYLES) for (const name of names) {
    const icon = resolveIcon(name, {pack, style});
    assert(icon, `${name} resolves for ${pack}/${style}`);
    if (icon!.fallback === 'exact') assert(icon!.pack === pack && icon!.style === style, 'Exact match is the requested set');
    if (!hasCombination(pack, style)) assert(icon!.fallback !== 'exact', `${pack}/${style} is not on disk`);
}
assert(resolveIcon('utilities-terminal-symbolic', {pack: 'classic', style: 'thin'})!.fallback === 'exact', 'Classic thin terminal is exact');
assert(resolveIcon('folder-symbolic', {pack: 'graphite', style: 'solid'})!.pack === 'graphite' && resolveIcon('folder-symbolic', {pack: 'graphite', style: 'solid'})!.style === 'thin', 'Graphite has only thin');
assert(resolveIcon('utilities-terminal', DEFAULT_CHOICE)!.fa === 'terminal' && faName('folder-symbolic') === 'folder', 'Names resolve with or without -symbolic');
assert(!resolveIcon('not-a-real-icon-symbolic', DEFAULT_CHOICE) && !resolveIcon('constructor-symbolic', DEFAULT_CHOICE), 'Unknown icons fall back to the GTK theme');

// Fallback order with synthetic data: same pack nearest style, Classic same style, Classic solid, then nothing.
const glyph = (d: string) => ({w: 512, d});
const make = (table: Record<string, string>): IconData => ({mapping: {thing: 'thing'}, load: (pack: Pack, style: Style): GlyphSet | undefined => table[`${pack}-${style}`] ? {upm: 512, icons: {thing: glyph(table[`${pack}-${style}`])}} : undefined});
assert(resolveIcon('thing', {pack: 'sharp', style: 'light'}, make({'sharp-light': 'A', 'sharp-thin': 'B'}))!.glyph.d === 'A', 'Exact first');
assert(resolveIcon('thing', {pack: 'sharp', style: 'light'}, make({'sharp-thin': 'B', 'sharp-solid': 'C', 'classic-light': 'D'}))!.glyph.d === 'B', 'Nearest style in the same pack');
assert(resolveIcon('thing', {pack: 'sharp', style: 'light'}, make({'classic-light': 'D', 'classic-solid': 'E'}))!.fallback === 'classic-style', 'Classic same style next');
assert(resolveIcon('thing', {pack: 'sharp', style: 'light'}, make({'classic-solid': 'E'}))!.fallback === 'classic-solid', 'Classic solid last');
assert(!resolveIcon('thing', {pack: 'sharp', style: 'light'}, make({})), 'Nothing found means GTK theme');

// Invalid values are rejected when saving and replaced by defaults when reading.
for (const [pack, style] of [['bogus', 'solid'], ['classic', 'bold'], [undefined, 'solid'], ['classic', 3], ['__proto__', 'solid']]) {
    let rejected = false; try {parseChoice(pack, style);} catch {rejected = true;}
    assert(rejected, `parseChoice rejects ${String(pack)}/${String(style)}`);
    assert(JSON.stringify(savedChoice(pack, style)) === JSON.stringify(DEFAULT_CHOICE), 'savedChoice falls back to the default');
}
assert(parseChoice('sharp-duotone', 'thin').pack === 'sharp-duotone', 'Valid choice accepted');

// SVG output: duotone has a second, translucent layer.
const duo = resolveIcon('folder-symbolic', {pack: 'duotone', style: 'regular'})!;
assert(duo.glyph.d2 && iconSvg(duo, {red: 1, green: 0, blue: 0}).includes('fill="#ff0000"') && iconSvg(duo, {red: 0, green: 0, blue: 0}).includes('fill-opacity=".4"'), 'Duotone layers and color');
assert(!iconSvg(resolveIcon('folder-symbolic', {pack: 'classic', style: 'solid'})!, {red: 0, green: 0, blue: 0}).includes('fill-opacity'), 'Single layer for classic');

// Pixel check: every available set renders visible ink for a few icons.
const black = new Gdk.RGBA();
black.parse('#000000');
function ink(pixbuf: { get_pixels(): Uint8Array; get_rowstride(): number; get_height(): number; get_width(): number; get_n_channels(): number }): number {
    const pixels = pixbuf.get_pixels(), channels = pixbuf.get_n_channels(); let count = 0;
    for (let y = 0; y < pixbuf.get_height(); y++) for (let x = 0; x < pixbuf.get_width(); x++) if (pixels[y * pixbuf.get_rowstride() + x * channels + 3] > 40) count++;
    return count;
}
for (const pack of PACKS) for (const style of PACK_STYLES[pack]) for (const name of ['utilities-terminal-symbolic', 'folder-symbolic', 'network-wireless-symbolic', 'bluetooth-symbolic']) {
    const pixbuf = renderIcon(name, 32, black, {pack, style});
    assert(pixbuf && pixbuf.get_width() === 32 && ink(pixbuf) > 40, `${pack}/${style} ${name} renders ink`);
}

// Widgets: Image goes through the provider, repaints on change, leaves theme icons alone.
async function widgetsRender() {
    const window = new Gtk.OffscreenWindow(); window.set_size_request(980, 1000);
    const container = new Gtk.Box(); window.add(container); const root = createRoot(container);
    const sample = ['utilities-terminal-symbolic', 'folder-symbolic', 'network-wireless-symbolic', 'bluetooth-symbolic', 'battery-good-symbolic', 'preferences-system-symbolic', 'audio-volume-high-symbolic', 'system-lock-screen-symbolic'];
    let choice = {pack: 'classic' as Pack, style: 'solid' as Style};
    const install = () => setBaseIconProvider((name, size, color) => renderIcon(name, size, color, choice));
    const tree = () => <Box orientation="vertical" spacing={4}>
        <Box id="plain" spacing={6}><Image id="plain-image" iconName="folder" pixelSize={24} /><Image id="unmapped" iconName="no-such-icon-symbolic" pixelSize={24} /><Image id="mapped" iconName="folder-symbolic" pixelSize={24} /></Box>
        {PACKS.map(pack => PACK_STYLES[pack].map(style => <Box key={`${pack}-${style}`} spacing={8}><Label widthRequest={150} xalign={0}>{`${pack} ${style}`}</Label>{sample.map(name => <FaImage key={name} pack={pack} style={style} name={name} />)}</Box>))}
    </Box>;
    function FaImage({pack, style, name}: {pack: Pack; style: Style; name: string}) {
        const host = React.useRef<Gtk.Box>(null);
        React.useLayoutEffect(() => {
            const image = new Gtk.Image(); const context = host.current!.get_style_context();
            image.set_from_pixbuf(renderIcon(name, 24, context.get_color(context.get_state()), {pack, style})); host.current!.add(image); image.show();
            return () => {image.destroy();};
        }, []);
        return <Box ref={host} />;
    }
    try {
        root.render(tree()); window.show_all(); await wait();
        const find = (id: string) => widgets(container).find(widget => widget.name === id) as Gtk.Image;
        assert(find('mapped').get_storage_type() === Gtk.ImageType.ICON_NAME, 'Without a provider symbolic icons use the theme');
        install(); await wait();
        assert(find('mapped').get_storage_type() === Gtk.ImageType.PIXBUF, 'Provider paints mapped symbolic icons');
        assert(find('plain-image').get_storage_type() === Gtk.ImageType.ICON_NAME && find('unmapped').get_storage_type() === Gtk.ImageType.ICON_NAME, 'Non-symbolic and unmapped icons keep the theme');
        assert(find('mapped').get_pixbuf()!.get_width() === 24, 'Pixel size is honored');
        const before = find('mapped').get_pixbuf()!.get_pixels().length; const first = find('mapped').get_pixbuf();
        choice = {pack: 'sharp-duotone', style: 'thin'}; install(); await wait();
        assert(find('mapped').get_pixbuf() !== first && before > 0, 'Changing pack/style repaints live images');
        setBaseIconProvider(undefined); await wait();
        assert(find('mapped').get_storage_type() === Gtk.ImageType.ICON_NAME, 'Removing the provider restores theme icons');
        const shot = GLib.getenv('DEV_OS_TEST_PREVIEW');
        if (shot) {await wait(); window.get_pixbuf()!.savev(shot, 'png', [], []);}
    } finally {setBaseIconProvider(undefined); root.unmount(); window.destroy();}
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void widgetsRender().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
print('PASS: Font Awesome resolver, fallbacks, validation, SVG rendering and live Image repaint');
