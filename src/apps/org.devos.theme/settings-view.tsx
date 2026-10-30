import {
    React, Gtk, GLib, Box, Label, Button, Entry, DrawingArea, ScrolledWindow, useState, useEffect,
    paletteFor, resolveTheme, scheduleError, themeModes, themeFamilies, themeFamilyNames, type Palette, type SettingsHost, type ThemeMode, type ThemeName
} from '@dev-os/core';
import {themeOptions} from './options.js';
import Cairo from 'cairo';
const id = 'org.devos.theme';
const modeInfo: Record<ThemeMode, {title: string; detail: string}> = {
    auto: {title: 'Auto', detail: 'Light by day, Dark by night'},
    dark: {title: 'Dark', detail: 'Easy on the eyes at night'},
    light: {title: 'Light', detail: 'Bright and clear by day'},
};

function rgb(hex: string): [number, number, number] {
    return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number];
}
/** A miniature workspace drawn with one theme's palette. */
export function drawThemePreview(cr: Cairo.Context, width: number, height: number, p: Palette) {
    const fill = (hex: string) => cr.setSourceRGB(...rgb(hex));
    const rect = (x: number, y: number, w: number, h: number, hex: string) => { fill(hex); cr.rectangle(x, y, w, h); cr.fill(); };
    const text = (label: string, x: number, y: number, size: number, hex: string) => { fill(hex); cr.selectFontFace('Sans', 0, 0); cr.setFontSize(size); cr.moveTo(x, y); cr.showText(label); };
    rect(0, 0, width, height, p.s0);
    rect(0, 0, width, 22, p.s1); rect(0, 21, width, 1, p.line0);
    text('Dev OS', 10, 15, 11, p.fgStrong); text('12:30', width - 42, 15, 10, p.fg);
    rect(0, 22, 74, height - 22, p.s1); rect(74, 22, 1, height - 22, p.line0);
    rect(6, 32, 62, 20, p.s4); rect(6, 32, 3, 20, p.accent);
    text('Appearance', 14, 46, 9.5, p.fgStrong); text('Wallpaper', 14, 70, 9.5, p.fg); text('Terminal', 14, 90, 9.5, p.fgMuted);
    text('Theme', 90, 48, 14, p.fgStrong); text('Follows the time of day.', 90, 64, 9.5, p.fgMuted);
    rect(90, 74, width - 106, 34, p.s3); rect(90, 74, width - 106, 1, p.line1);
    text('Coordinated colors', 100, 95, 10, p.fg);
    rect(width - 82, height - 34, 66, 22, p.accent); text('Apply', width - 66, height - 19, 10, p.onAccent);
    text('Link', 90, height - 18, 10, p.accentFg);
}

export function ThemeSettingsPage({preferences}: {preferences: SettingsHost}) {
    const info = preferences.get(id);
    const [saved, setSaved] = useState(() => themeOptions(info.state.values));
    const [draft, setDraft] = useState(saved);
    const [error, setError] = useState(''); const [status, setStatus] = useState('');
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30000, () => { setNow(new Date()); return GLib.SOURCE_CONTINUE; });
        return () => { GLib.source_remove(timer); };
    }, []);
    const problem = scheduleError(draft);
    const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
    const edit = (next: Partial<typeof draft>) => { setDraft(current => ({...current, ...next})); setError(''); setStatus(''); };
    const showing: ThemeName = resolveTheme(draft.mode, now, problem ? saved : draft);
    const cards: ThemeName[] = ['dark', 'light'];
    return <Box className="settings-content" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={6}><Label className="settings-eyebrow" xalign={0}>PERSONALIZATION / APPEARANCE</Label><Label className="heading" xalign={0}>Theme</Label><Label className="settings-description" wrap xalign={0}>Pick a color theme, then choose Dark, Light or Auto, which switches between them during the day.</Label></Box>
        <ScrolledWindow expand fill minContentHeight={240} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="settings-form" orientation="vertical" spacing={18}>
                <Box className="theme-settings-stage" orientation="vertical" spacing={12}>
                    <Box><Label className="settings-eyebrow" xalign={0} expand>PREVIEW</Label><Label id="theme-showing" className="settings-description">{`Showing ${modeInfo[showing].title}`}</Label></Box>
                    <Box spacing={14} homogeneous>{cards.map(name => <Box key={name} orientation="vertical" spacing={6}>
                        <DrawingArea key={`${draft.family}/${name}`} id={`theme-preview-${name}`} heightRequest={150} onDraw={(widget, cr) => { drawThemePreview(cr, widget.get_allocated_width(), 150, paletteFor(name, draft.family)); return false; }} />
                        <Label className={showing === name ? 'settings-field-title' : 'settings-description'} xalign={0}>{`${modeInfo[name].title}${showing === name ? ' · in use' : ''}`}</Label>
                    </Box>)}</Box>
                    <Label className="settings-description" wrap xalign={0}>Preview only · Apply changes every window without restarting your apps.</Label>
                </Box>
                <Box orientation="vertical" spacing={10}><Label className="section-heading" xalign={0}>Color theme</Label><Box spacing={10} homogeneous>{themeFamilyNames.map(family => <Button key={family} id={`theme-family-${family}`} className={`theme-palette ${draft.family === family ? 'theme-palette-selected' : ''}`} expand fill onClicked={() => edit({family})}><Box orientation="vertical" spacing={6}><Label className="settings-field-title" xalign={0}>{themeFamilies[family].title}</Label><Label className="settings-description" xalign={0}>{themeFamilies[family].detail}</Label></Box></Button>)}</Box></Box>
                <Box orientation="vertical" spacing={10}><Label className="section-heading" xalign={0}>Appearance</Label><Box spacing={10} homogeneous>{themeModes.map(mode => <Button key={mode} id={`theme-mode-${mode}`} className={`theme-palette ${draft.mode === mode ? 'theme-palette-selected' : ''}`} expand fill onClicked={() => edit({mode})}><Box orientation="vertical" spacing={6}><Label className="settings-field-title" xalign={0}>{modeInfo[mode].title}</Label><Label className="settings-description" xalign={0}>{modeInfo[mode].detail}</Label></Box></Button>)}</Box></Box>
                <Box className="settings-card theme-settings-card" orientation="vertical" spacing={14}>
                    <Label className="section-heading" xalign={0}>Auto schedule</Label>
                    <Label className="settings-description" wrap xalign={0}>Auto uses your local time. Light is shown from the first time until the second; Dark the rest of the day.</Label>
                    <Box spacing={12}><Label className="settings-field-title" expand xalign={0}>Light theme starts</Label><Entry id="theme-light-from" sensitive={draft.mode === 'auto'} text={draft.lightFrom} widthChars={7} maxLength={5} onChanged={widget => { if (widget.get_text() !== draft.lightFrom) edit({lightFrom: widget.get_text()}); }} /></Box>
                    <Box spacing={12}><Label className="settings-field-title" expand xalign={0}>Dark theme starts</Label><Entry id="theme-dark-from" sensitive={draft.mode === 'auto'} text={draft.darkFrom} widthChars={7} maxLength={5} onChanged={widget => { if (widget.get_text() !== draft.darkFrom) edit({darkFrom: widget.get_text()}); }} /></Box>
                    {problem && <Label id="theme-schedule-error" className="error" wrap xalign={0}>{problem}</Label>}
                </Box>
                <Label className="settings-description" wrap xalign={0}>Wallpapers, icon packs and terminal fonts have their own settings pages. The terminal and editor follow this theme.</Label>
                {(error || info.error) && <Label className="error" wrap xalign={0}>{error || info.error}</Label>}
            </Box>
        </ScrolledWindow>
        <Box className="settings-action-bar" spacing={12}><Label className="settings-description" expand wrap xalign={0}>{status || (dirty ? 'Unsaved changes · Preview only' : 'A consistent look across your workspace.')}</Label><Button id="theme-settings-reset" sensitive={dirty} onClicked={() => { setDraft({...saved}); setError(''); setStatus(''); }}>Reset</Button><Button id="theme-settings-apply" className="settings-primary" sensitive={dirty && !problem && !info.error} onClicked={() => { try { preferences.update(id, true, {...draft}); setSaved({...draft}); setStatus('Theme updated.'); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }}>Apply</Button></Box>
    </Box>;
}
