import {React, Gtk, Box, Label, Button, Image, Entry, Switch, DrawingArea, ScrolledWindow, useState, type SettingsHost} from '@dev-os/core';
import {themeOptions, themePalettes, themeAccent, accentChoices} from './options.js';
const id = 'org.devos.theme';
export function ThemeSettings({preferences, getAccent}: {preferences: SettingsHost; getAccent(): string}) {
    const info = preferences.get(id);
    const [saved, setSaved] = useState(() => themeOptions(info.state.values));
    const [draft, setDraft] = useState(saved);
    const [error, setError] = useState(''); const [status, setStatus] = useState('');
    const dirty = JSON.stringify(draft) !== JSON.stringify(saved), valid = draft.useDesktopAccent || /^#[0-9a-f]{6}$/i.test(draft.accent);
    const edit = (next: Partial<typeof draft>) => {setDraft(current => ({...current, ...next})); setError(''); setStatus('');};
    const accent = themeAccent(draft, getAccent()), palette = themePalettes[draft.palette];
    return <Box className="settings-content" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={6}><Label className="settings-eyebrow" xalign={0}>PERSONALIZATION / APPEARANCE</Label><Label className="heading" xalign={0}>Theme</Label><Label className="settings-description" wrap xalign={0}>Set the mood of your workspace with coordinated surfaces and highlights.</Label></Box>
        <ScrolledWindow expand fill minContentHeight={240} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="settings-form" orientation="vertical" spacing={18}>
                <Box className="theme-settings-stage" orientation="vertical" spacing={12}>
                    <Box><Label className="settings-eyebrow" xalign={0} expand>APPEARANCE PREVIEW</Label><Label className="settings-description">{palette.title}</Label></Box>
                    <DrawingArea key={`${draft.palette}/${accent}`} id="theme-settings-preview" heightRequest={210} onDraw={(widget, cr) => {
                        const width = widget.get_allocated_width();
                        const color = (hex: string) => cr.setSourceRGB(...[1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number]);
                        const rect = (x: number, y: number, w: number, h: number, fill: string) => {color(fill); cr.rectangle(x, y, w, h); cr.fill();};
                        const text = (label: string, x: number, y: number, size: number, fill: string) => {color(fill); cr.selectFontFace('Sans', 0, 0); cr.setFontSize(size); cr.moveTo(x, y); cr.showText(label);};
                        rect(0, 0, width, 210, palette.surface); rect(0, 0, 140, 210, palette.sidebar);
                        rect(10, 54, 120, 30, palette.card); rect(10, 54, 3, 30, accent);
                        text('Dev OS', 18, 30, 15, '#e4eaf4'); text('Appearance', 22, 74, 12, accent); text('Applications', 22, 108, 12, '#bac7d5'); text('Workspace', 22, 140, 12, '#bac7d5');
                        text('Your workspace', 160, 38, 19, '#e4eaf4'); text('A little more you.', 160, 62, 12, '#bac7d5');
                        rect(160, 80, Math.max(30, width - 180), 70, palette.card); text('Coordinated colors', 176, 108, 13, '#e4eaf4'); text('Clear, calm and familiar', 176, 132, 11, '#bac7d5');
                        rect(Math.max(160, width - 104), 166, 84, 28, accent); text('Apply', Math.max(177, width - 84), 185, 12, '#17232c'); return false;
                    }} />
                    <Label className="settings-description" wrap xalign={0}>Preview only · Apply changes desktop surfaces without restarting your apps.</Label>
                </Box>
                <Box orientation="vertical" spacing={10}><Label className="section-heading" xalign={0}>Workspace palette</Label><Box spacing={10} homogeneous>{Object.entries(themePalettes).map(([key, item]) => <Button key={key} id={`theme-palette-${key}`} className={`theme-palette ${draft.palette === key ? 'theme-palette-selected' : ''}`} expand fill onClicked={() => edit({palette: key as typeof draft.palette})}><Box orientation="vertical" spacing={6}><Label className="settings-field-title" xalign={0}>{item.title}</Label><Label className="settings-description" xalign={0}>{item.detail}</Label></Box></Button>)}</Box></Box>
                <Box className="settings-card theme-settings-card" orientation="vertical" spacing={18}>
                    <Box spacing={12}><Box orientation="vertical" spacing={5} expand><Label className="settings-field-title" xalign={0}>Use Desktop accent</Label><Label className="settings-description" wrap xalign={0}>Follow the accent color in Desktop settings.</Label></Box><Switch id="theme-follow-accent" active={draft.useDesktopAccent} valign="center" onActiveChanged={widget => edit({useDesktopAccent: widget.active})} /></Box>
                    <Label className="settings-field-title" xalign={0}>Accent color</Label>
                    <Box spacing={10} homogeneous>{accentChoices.map((color, index) => <Button key={color} id={`theme-accent-${index}`} tooltip={color} onClicked={() => edit({accent: color, useDesktopAccent: false})}><DrawingArea heightRequest={24} widthRequest={28} onDraw={(widget, cr) => {cr.setSourceRGB(...[1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255) as [number, number, number]); cr.arc(widget.get_allocated_width() / 2, 12, 8, 0, Math.PI * 2); cr.fill(); return false;}} /></Button>)}</Box>
                    <Box spacing={12}><Label className="settings-description" expand xalign={0}>Custom color · #RRGGBB</Label><Entry id="theme-custom-accent" sensitive={!draft.useDesktopAccent} text={draft.useDesktopAccent ? getAccent() : draft.accent} widthChars={12} onChanged={widget => {if (!draft.useDesktopAccent) edit({accent: widget.get_text()});}} /></Box>
                    {!valid && <Label className="error" xalign={0}>Enter a six-digit hex color, for example #88e0c0.</Label>}
                </Box>
                <Box spacing={10}><Image iconName="applications-graphics-symbolic" pixelSize={18} /><Label className="settings-description" wrap xalign={0}>Wallpapers, icon packs and terminal colors have their own settings pages.</Label></Box>
                {(error || info.error) && <Label className="error" wrap xalign={0}>{error || info.error}</Label>}
            </Box>
        </ScrolledWindow>
        <Box className="settings-action-bar" spacing={12}><Label className="settings-description" expand wrap xalign={0}>{status || (dirty ? 'Unsaved changes · Preview only' : 'A consistent look across your workspace.')}</Label><Button id="theme-settings-reset" sensitive={dirty} onClicked={() => {setDraft({...saved}); setError(''); setStatus('');}}>Reset</Button><Button id="theme-settings-apply" className="settings-primary" sensitive={dirty && valid && !info.error} onClicked={() => {try {preferences.update(id, true, {...draft}); setSaved({...draft}); setStatus('Theme updated.');} catch (reason) {setError(reason instanceof Error ? reason.message : String(reason));}}}>Apply</Button></Box>
    </Box>;
}
