import {React, Gtk, Gio, Box, Label, Button, Entry, Switch, ComboBoxText, DrawingArea, ScrolledWindow, useState, useEffect, useRef, wallpaperColors, type SettingsHost, type SettingsValues, type WindowControls} from '@dev-os/core';
import {designStyles} from './design.js';
import {WallpaperCanvas, type BackgroundConfig} from './view.js';
import {wallpaperConfig, loadPicture} from './wallpaper.js';
import {BackgroundContextSettings} from './context-settings.js';
import {parseCustomMenu} from '../org.devos.files/custom-menu.js';
import {DesktopWidgetSettings} from './desktop-widgets.js';
import {activeWidgetDesktop, desktopWidgetValues, updateDesktopWidgets, widgetDesktopMap, widgetKeys} from './widget-desktops.js';

const id = 'org.devos.background';
const presets = ['#101b25', '#171923', '#18332e', '#28344f', '#3c2948', '#482d2d', '#c4b8a4', '#e7e8ec'];
export interface BackgroundSettingsServices {preferences: SettingsHost; getConfig(): {name: string}; applied(): void; parent?: Gtk.Window | null; windows?: WindowControls;}
export function BackgroundSettings({preferences, getConfig, applied, parent, windows}: BackgroundSettingsServices) {
    const [desktop, setDesktop] = useState(() => activeWidgetDesktop(windows));
    useEffect(() => windows?.subscribe(() => {
        const next = activeWidgetDesktop(windows);
        setDesktop(previous => previous?.key === next?.key ? previous : next);
    }), [windows]);
    const initial = preferences.get(id).state.values;
    const [saved, setSaved] = useState(initial);
    const [values, setValues] = useState(initial);
    const [error, setError] = useState('');
    const [imageError, setImageError] = useState('');
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState(false);
    const [cancel] = useState(() => new Gio.Cancellable());
    const chooser = useRef<Gtk.FileChooserDialog | null>(null);
    const disposed = useRef(false);
    useEffect(() => () => { disposed.current = true; cancel.cancel(); chooser.current?.destroy(); }, [cancel]);
    const dirty = JSON.stringify(values) !== JSON.stringify(saved);
    const config = wallpaperConfig({name: getConfig().name, ...wallpaperColors()}, values);
    const edit = (next: SettingsValues) => { setValues(current => ({...current, ...next})); setError(''); setStatus(''); };
    const browse = () => {
        if (chooser.current) { chooser.current.present(); return; }
        const dialog = new Gtk.FileChooserDialog({title: 'Choose a background picture', transient_for: parent ?? undefined, modal: true, action: Gtk.FileChooserAction.OPEN});
        chooser.current = dialog;
        dialog.set_local_only(true);
        dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
        dialog.add_button('Choose picture', Gtk.ResponseType.ACCEPT);
        const filter = new Gtk.FileFilter(); filter.set_name('Pictures'); filter.add_pixbuf_formats(); dialog.add_filter(filter);
        dialog.connect('response', (_dialog, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                const path = dialog.get_filename();
                if (path) edit({imagePath: path, mode: 'picture'});
            }
            chooser.current = null; dialog.destroy();
        });
        dialog.show();
    };
    const apply = async () => {
        setError(''); setStatus('');
        if (!/^#[\da-f]{6}$/i.test(String(values.color))) { setError('Enter a six-digit hex color, such as #101b25.'); return; }
        if (config.mode === 'picture' && !config.imagePath) { setError('Choose a picture before applying.'); return; }
        setBusy(true);
        try {
            parseCustomMenu(values.contextCustomItems);
            if (config.mode === 'picture') await loadPicture(config.imagePath, cancel);
            if (disposed.current) return;
            const next = {...values};
            const latest = preferences.get(id).state.values;
            for (const key of widgetKeys) {
                if (values[key] === saved[key]) next[key] = latest[key];
            }
            const scoped = widgetDesktopMap(latest), baseline = widgetDesktopMap(saved);
            for (const [scope, draft] of Object.entries(widgetDesktopMap(values))) {
                for (const key of widgetKeys) {
                    if (draft[key] !== baseline[scope]?.[key]) scoped[scope] = {...scoped[scope], [key]: draft[key]};
                }
            }
            next.widgetDesktops = JSON.stringify(scoped);
            next.widgetDesktopVersion = Math.max(Number(latest.widgetDesktopVersion ?? 0), Number(values.widgetDesktopVersion ?? 0));
            preferences.update(id, true, next);
            applied(); setValues(next); setSaved({...next}); setStatus('Background applied to all displays.');
        } catch (reason) { if (!disposed.current) setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { if (!disposed.current) setBusy(false); }
    };
    return <Box className="settings-content" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={6}>
            <Label className="settings-eyebrow" xalign={0}>PERSONALIZATION</Label>
            <Label className="heading" xalign={0}>Background</Label>
            <Label className="settings-description" xalign={0}>Choose a picture, a solid color, or the DevOs design for all your displays.</Label>
        </Box>
        <ScrolledWindow expand fill minContentHeight={240} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="settings-form" orientation="vertical" spacing={16}>
                <Box className="background-preview-frame" orientation="vertical"><WallpaperCanvas config={config} preview onError={setImageError} /></Box>
                <Label className="settings-description" xalign={0}>Preview · Changes are saved only when you click Apply.</Label>
                <Box className="settings-card background-settings-card" orientation="vertical" spacing={14}>
                    <Box spacing={14}><Label className="settings-field-title" xalign={0} expand>Personalize your background</Label>
                        <ComboBoxText id="background-mode" activeId={config.mode} sensitive={!busy} items={[
                            {id: 'design', text: 'DevOs design'}, {id: 'solid', text: 'Solid color'}, {id: 'picture', text: 'Picture'},
                        ]} onChanged={widget => edit({mode: widget.get_active_id() ?? 'design'})} />
                    </Box>
                    {config.mode === 'design' && <Box spacing={12}><Label xalign={0} expand>Design</Label><ComboBoxText id="background-style" activeId={config.style} sensitive={!busy} items={[...designStyles]} onChanged={widget => edit({style: widget.get_active_id() ?? 'dunes'})} /></Box>}
                    {config.mode === 'picture' && <Box orientation="vertical" spacing={10}>
                        <Label className="settings-description" xalign={0}>Picture file</Label>
                        <Box spacing={8}><Entry id="background-image-path" expand text={String(values.imagePath)} sensitive={!busy} placeholder="Choose a local image…" onChanged={widget => edit({imagePath: widget.get_text()})} />
                            <Button id="background-browse" sensitive={!busy} onClicked={browse}>Browse…</Button></Box>
                        <Box spacing={12}><Label xalign={0} expand>Choose a fit</Label><ComboBoxText id="background-fit" activeId={config.fit} sensitive={!busy} items={[
                            {id: 'cover', text: 'Fill (crop to fit)'}, {id: 'contain', text: 'Fit (show whole picture)'}, {id: 'stretch', text: 'Stretch'},
                        ]} onChanged={widget => edit({fit: widget.get_active_id() ?? 'cover'})} /></Box>
                    </Box>}
                    <Box spacing={12}><Label xalign={0} expand>Use theme background color</Label><Switch id="background-desktop-color" active={values.useDesktopColor === true} sensitive={!busy} onActiveChanged={widget => edit({useDesktopColor: widget.active})} /></Box>
                    <Label className="settings-description" xalign={0} wrap>{values.useDesktopColor ? 'Follows the Dark or Light theme.' : 'This color also fills any space around your picture.'}</Label>
                    <Box spacing={8}>{presets.map(color => <Button key={color} id={`background-color-${color.slice(1)}`} tooltip={color} sensitive={!busy} onClicked={() => edit({color, useDesktopColor: false})}>
                        <DrawingArea widthRequest={24} heightRequest={24} onDraw={(_canvas, cr) => {
                            cr.setSourceRGB(...[1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255) as [number, number, number]); cr.paint(); return false;
                        }} />
                    </Button>)}</Box>
                    <Entry id="background-color" text={String(values.color)} sensitive={!busy && values.useDesktopColor !== true} widthChars={12} onChanged={widget => edit({color: widget.get_text()})} />
                </Box>
                <Box orientation="vertical" spacing={8} sensitive={Boolean(desktop)}>
                    <Label id="desktop-widget-scope" className="settings-description" xalign={0}>{desktop ? `Widgets on ${desktop.name}` : 'Waiting for the current desktop…'}</Label>
                    <DesktopWidgetSettings values={desktopWidgetValues(values, desktop)} changed={patch => {
                        if (!desktop) return;
                        setValues(current => updateDesktopWidgets(current, desktop, patch)); setError(''); setStatus('');
                    }} />
                </Box>
                <BackgroundContextSettings values={values} changed={edit} />
                {(error || imageError) && <Label id="background-error" className="error" xalign={0} wrap>{error || imageError}</Label>}
            </Box>
        </ScrolledWindow>
        <Box className="settings-action-bar" spacing={12}>
            <Label id="background-status" className="settings-description" expand xalign={0} wrap>{busy ? 'Applying background…' : status || (dirty ? 'Unsaved changes' : 'Your saved background is up to date.')}</Label>
            <Button id="background-reset" sensitive={dirty && !busy} onClicked={() => { setValues({...saved}); setError(''); setStatus(''); }}>Reset</Button>
            <Button id="background-apply" className="settings-primary" sensitive={dirty && !busy} onClicked={() => { void apply(); }}>Apply</Button>
        </Box>
    </Box>;
}
