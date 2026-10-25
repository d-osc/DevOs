import {React, Gtk, Box, Label, Button, Image, SearchEntry, Switch, FlowBox, ScrolledWindow, useState, useMemo, useRef, useLayoutEffect, type SettingsHost} from '@dev-os/core';
import {installedIconThemes} from './themes.js';
import {materialIcon} from './material.js';
import {PACKS, STYLES, PACK_TITLES, PACK_STYLES, hasCombination, parseChoice, savedChoice, renderIcon, resolveIcon, type IconChoice, type Pack} from './fa-icons.js';
const id = 'org.devos.icons';
function PreviewIcon({theme, name, title}: {theme: Gtk.IconTheme; name: string; title: string}) {
    const host = useRef<Gtk.Box>(null);
    useLayoutEffect(() => {
        const image = new Gtk.Image();
        try {
            const icon = theme.lookup_icon(name, 32, Gtk.IconLookupFlags.FORCE_SIZE);
            if (!icon) throw new Error('Icon unavailable');
            image.set_from_pixbuf(icon.is_symbolic() ? icon.load_symbolic_for_context(host.current!.get_style_context())[0] : icon.load_icon());
        }
        catch {image.set_from_icon_name('image-missing', Gtk.IconSize.DIALOG);}
        host.current!.add(image); image.show();
        return () => {image.destroy();};
    }, [theme, name]);
    return <Box className="icons-preview-item" orientation="vertical" spacing={10} expand fill><Box ref={host} halign="center" heightRequest={36} /><Label className="settings-description">{title}</Label></Box>;
}
const BASE_PREVIEW = [{name: 'utilities-terminal-symbolic', title: 'Terminal'}, {name: 'folder-symbolic', title: 'Files'}, {name: 'network-wireless-symbolic', title: 'Wi-Fi'}, {name: 'bluetooth-symbolic', title: 'Bluetooth'}, {name: 'battery-good-symbolic', title: 'Battery'}, {name: 'preferences-system-symbolic', title: 'Settings'}];
function BaseIconPreview({name, title, choice}: {name: string; title: string; choice: IconChoice}) {
    const host = useRef<Gtk.Box>(null);
    useLayoutEffect(() => {
        const image = new Gtk.Image(), context = host.current!.get_style_context();
        let pixbuf = null;
        try {pixbuf = renderIcon(name, 32, context.get_color(context.get_state()), choice);} catch {/* shown as missing below */}
        if (pixbuf) image.set_from_pixbuf(pixbuf); else image.set_from_icon_name(name, Gtk.IconSize.DIALOG);
        host.current!.add(image); image.show();
        return () => {image.destroy();};
    }, [name, choice.pack, choice.style]);
    const exact = resolveIcon(name, choice);
    return <Box className="icons-preview-item" orientation="vertical" spacing={10} expand fill><Box ref={host} halign="center" heightRequest={36} /><Label className="settings-description" tooltip={exact && exact.fallback !== 'exact' ? `Showing ${PACK_TITLES[exact.pack]} ${exact.style}` : undefined}>{title}</Label></Box>;
}
export function IconsSettings({preferences, iconTheme, sessionTheme}: {preferences: SettingsHost; iconTheme: Gtk.IconTheme; sessionTheme: string}) {
    const info = preferences.get(id);
    const [saved, setSaved] = useState(() => ({...savedChoice(info.state.values.basePack, info.state.values.baseStyle), baseIcons: info.state.values.baseIcons !== false, themeName: String(info.state.values.themeName ?? 'Adwaita'), useSystemTheme: info.state.values.useSystemTheme === true, materialFiles: info.state.values.materialFiles !== false}));
    const [draft, setDraft] = useState(saved);
    const [themes, setThemes] = useState(() => installedIconThemes(iconTheme));
    const [query, setQuery] = useState(''); const [revision, refresh] = useState(0);
    const [error, setError] = useState(''); const [status, setStatus] = useState('');
    const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
    const valid = draft.useSystemTheme || themes.includes(draft.themeName);
    const selected = draft.useSystemTheme || !valid ? sessionTheme : draft.themeName;
    const preview = useMemo(() => {const theme = new Gtk.IconTheme(); theme.set_search_path(iconTheme.get_search_path() ?? []); theme.set_custom_theme(selected); return theme;}, [selected, revision, iconTheme]);
    const choice: IconChoice = {pack: draft.pack, style: draft.style};
    const pickPack = (pack: Pack) => edit({pack, style: hasCombination(pack, draft.style) ? draft.style : PACK_STYLES[pack][0]});
    const edit = (next: Partial<typeof draft>) => {setDraft(current => ({...current, ...next})); setError(''); setStatus('');};
    const filtered = themes.filter(name => name.toLowerCase().includes(query.trim().toLowerCase()));
    return <Box className="settings-content" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={6}><Label className="settings-eyebrow" xalign={0}>PERSONALIZATION / ICONS</Label><Label className="heading" xalign={0}>Theme icons</Label><Label className="settings-description" wrap xalign={0}>Choose the details that make your workspace recognizable.</Label></Box>
        <ScrolledWindow expand fill minContentHeight={240} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="settings-form" orientation="vertical" spacing={18}>
                <Box className="icons-settings-stage" orientation="vertical" spacing={18}>
                    <Box><Label className="settings-eyebrow" xalign={0} expand>ICON PREVIEW</Label><Label id="icons-preview-theme" className="settings-description">{selected}</Label></Box>
                    <Box spacing={8} homogeneous>{[{name: 'folder-symbolic', title: 'Files'}, {name: 'utilities-terminal-symbolic', title: 'Terminal'}, {name: 'preferences-system-symbolic', title: 'Settings'}, {name: 'network-wireless-symbolic', title: 'Network'}].map(item => <PreviewIcon key={item.title} theme={preview} {...item} />)}</Box>
                    <Box className="icons-preview-files" spacing={8} homogeneous>{[{path: 'src', directory: true, title: 'src'}, {path: 'view.tsx', directory: false, title: 'view.tsx'}, {path: 'package.json', directory: false, title: 'package.json'}, {path: 'notes.txt', directory: false, title: 'notes.txt'}].map(item => <PreviewIcon key={item.title} theme={preview} title={item.title} name={materialIcon(item.path, item.directory, draft.materialFiles) ?? (item.directory ? 'folder' : 'text-x-generic')} />)}</Box>
                    <Label className="settings-description" wrap xalign={0}>Actual icons from the selected theme · Changes stay in this preview until Apply.</Label>
                </Box>
                <Box className="settings-card icons-settings-card" orientation="vertical" spacing={16}>
                    <Box spacing={12}><Box orientation="vertical" spacing={5} expand><Label className="settings-field-title" xalign={0}>Font Awesome base icons</Label><Label className="settings-description" wrap xalign={0}>Panel, launcher, settings and window controls draw from the bundled Font Awesome set.</Label></Box><Switch id="icons-base-enabled" active={draft.baseIcons} valign="center" onActiveChanged={widget => edit({baseIcons: widget.active})} /></Box>
                    <Label className="settings-eyebrow" xalign={0}>BASE ICON PREVIEW</Label>
                    <Box id="icons-base-preview" spacing={8} homogeneous>{BASE_PREVIEW.map(item => <BaseIconPreview key={item.title} choice={choice} {...item} />)}</Box>
                    <Label className="section-heading" xalign={0}>Icon pack</Label>
                    <FlowBox id="icons-base-packs" selectionMode={Gtk.SelectionMode.NONE} minChildrenPerLine={2} maxChildrenPerLine={4} rowSpacing={6} columnSpacing={6}>{PACKS.map(pack => <Button key={pack} id={`icons-pack-${pack}`} className={`icons-theme-choice ${draft.pack === pack ? 'icons-theme-selected' : ''}`} sensitive={draft.baseIcons} onClicked={() => pickPack(pack)}><Label xalign={0}>{PACK_TITLES[pack]}</Label></Button>)}</FlowBox>
                    <Label className="section-heading" xalign={0}>Icon style</Label>
                    <Box spacing={6} homogeneous>{STYLES.map(style => <Button key={style} id={`icons-style-${style}`} className={`icons-theme-choice ${draft.style === style ? 'icons-theme-selected' : ''}`} sensitive={draft.baseIcons && hasCombination(draft.pack, style)} tooltip={hasCombination(draft.pack, style) ? undefined : `${PACK_TITLES[draft.pack]} has no ${style} style`} onClicked={() => edit({style})}><Label>{style[0].toUpperCase() + style.slice(1)}</Label></Button>)}</Box>
                    <Label className="settings-description" wrap xalign={0}>{`${PACK_TITLES[draft.pack]} provides: ${PACK_STYLES[draft.pack].join(', ')}. Styles a pack lacks are greyed out; icons missing from a font fall back to the nearest style, then Classic, then the GTK theme.`}</Label>
                </Box>
                <Box className="settings-card icons-settings-card" orientation="vertical" spacing={16}>
                    <Box spacing={12}><Box orientation="vertical" spacing={5} expand><Label className="settings-field-title" xalign={0}>Use the session icon theme</Label><Label className="settings-description" wrap xalign={0}>{`Follow the theme active when Dev OS started: ${sessionTheme}.`}</Label></Box><Switch id="icons-use-session" active={draft.useSystemTheme} valign="center" onActiveChanged={widget => edit({useSystemTheme: widget.active})} /></Box>
                    <Box><Label className="section-heading" xalign={0} expand>Installed icon themes</Label><Button id="icons-refresh" onClicked={() => {iconTheme.rescan_if_needed(); setThemes(installedIconThemes(iconTheme)); refresh(value => value + 1); setStatus('Installed themes refreshed.');}}><Box spacing={6}><Image iconName="view-refresh-symbolic" pixelSize={14} /><Label>Refresh</Label></Box></Button></Box>
                    <SearchEntry id="icons-theme-search" text={query} placeholder="Search installed themes…" onChanged={widget => setQuery(widget.get_text())} />
                    <ScrolledWindow minContentHeight={120} maxContentHeight={190} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
                        <Box orientation="vertical" spacing={6}>{filtered.map(name => <Button key={name} id={`icons-theme-${name}`} className={`icons-theme-choice ${!draft.useSystemTheme && draft.themeName === name ? 'icons-theme-selected' : ''}`} onClicked={() => edit({themeName: name, useSystemTheme: false})}><Box spacing={10}><Image iconName="applications-graphics-symbolic" pixelSize={16} /><Label xalign={0} expand>{name}</Label>{!draft.useSystemTheme && draft.themeName === name && <Image iconName="object-select-symbolic" pixelSize={16} />}</Box></Button>)}{!filtered.length && <Label className="settings-description" wrap xalign={0}>No installed themes match your search.</Label>}</Box>
                    </ScrolledWindow>
                    {!valid && <Label className="error" wrap xalign={0}>{`“${draft.themeName}” is unavailable. Select an installed theme or use the session theme.`}</Label>}
                </Box>
                <Box className="settings-card icons-settings-card" spacing={12}><Image iconName="folder-symbolic" pixelSize={20} /><Box orientation="vertical" spacing={5} expand><Label className="settings-field-title" xalign={0}>Material file &amp; folder icons</Label><Label className="settings-description" wrap xalign={0}>Colorful file types in Files, Quick Open and Editor tabs.</Label></Box><Switch id="icons-material-files" active={draft.materialFiles} valign="center" onActiveChanged={widget => edit({materialFiles: widget.active})} /></Box>
                <Label className="settings-description" wrap xalign={0}>Themes are loaded from GTK icon search paths. Add a theme locally, then Refresh. Shell controls use symbolic variants where available.</Label>
                {(error || info.error) && <Label className="error" wrap xalign={0}>{error || info.error}</Label>}
            </Box>
        </ScrolledWindow>
        <Box className="settings-action-bar" spacing={12}><Label className="settings-description" expand wrap xalign={0}>{status || (dirty ? 'Unsaved changes · Preview only' : 'Small details, a familiar workspace.')}</Label><Button id="icons-settings-reset" sensitive={dirty} onClicked={() => {setDraft({...saved}); setError(''); setStatus('');}}>Reset</Button><Button id="icons-settings-apply" className="settings-primary" sensitive={dirty && valid && !info.error} onClicked={() => {try {const checked = parseChoice(draft.pack, draft.style); const {pack, style, ...rest} = draft; preferences.update(id, true, {...rest, basePack: checked.pack, baseStyle: checked.style}); setSaved({...draft}); setStatus('Icon preferences updated.');} catch (reason) {setError(reason instanceof Error ? reason.message : String(reason));}}}>Apply</Button></Box>
    </Box>;
}
