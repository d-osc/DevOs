import Gtk from 'gi://Gtk?version=3.0';
import Pango from 'gi://Pango';
import {React, Box, Label, Button, Entry, SearchEntry, Switch, Image, DrawingArea, ScrolledWindow,
    createRoot, mountWindowHeader, useState, useEffect} from '@dev-os/react-gtk';
import type {Config} from '../../src/config.js';
import type {SettingsHost, SettingsSection, SettingsValues} from '../../src/extensions/types.js';
import type {SettingsPages} from '../../src/extensions/settings-pages.js';

export interface SettingsServices {
    extensions: SettingsHost;
    pages?: SettingsPages;
    getCore(): Config;
    saveCore(value: unknown): void;
    applied(): void;
}
type Draft = Record<string, string | boolean>;
const commandKeys = ['terminal', 'files', 'lock', 'autostart'];
function draft(values: SettingsValues): Draft {
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === 'boolean' ? value : String(value)]));
}
function CoreSections(config: Config): {sections: SettingsSection[]; values: SettingsValues} {
    const sections: SettingsSection[] = [
        {id: 'appearance', title: 'Appearance', description: 'Make this desktop feel like your workspace.', fields: [
            {key: 'name', title: 'Desktop name', description: 'The name shown on your desktop.', type: 'string', default: config.name},
            {key: 'accent', title: 'Accent color', description: 'Highlights, active controls and selection.', type: 'color', default: config.accent},
            {key: 'background', title: 'Background color', description: 'The base color of your desktop wallpaper.', type: 'color', default: config.background},
        ]},
        {id: 'panel', title: 'Panel & clock', description: 'Keep essential information within reach.', fields: [
            {key: 'panel_height', title: 'Panel height', description: 'Height in pixels.', type: 'number', default: config.panel_height, min: 32, max: 96, integer: true},
            {key: 'clock_format', title: 'Clock format', description: 'Use %H:%M for 24-hour time, or %I:%M %p for 12-hour time.', type: 'string', default: config.clock_format},
        ]},
        {id: 'session', title: 'Session & commands', description: 'Choose the commands used by your desktop.', fields: [
            {key: 'terminal', title: 'Terminal command', description: 'Command arguments as a JSON array.', type: 'string', default: JSON.stringify(config.terminal)},
            {key: 'files', title: 'External file manager', description: 'Fallback command as a JSON array. The Files extension handles the desktop Files action.', type: 'string', default: JSON.stringify(config.files)},
            {key: 'lock', title: 'Lock command', description: 'Command arguments as a JSON array.', type: 'string', default: JSON.stringify(config.lock)},
            {key: 'autostart', title: 'Start with this session', description: 'JSON array of command arrays. Changes apply at the next session.', type: 'string', default: JSON.stringify(config.autostart)},
        ]},
    ];
    return {sections, values: Object.fromEntries(sections.flatMap(section => section.fields).map(field => [field.key, field.default]))};
}
const pageIcons: Record<string, string> = {
    core: 'video-display-symbolic', 'org.devos.background': 'preferences-desktop-wallpaper-symbolic',
    'org.devos.clock': 'preferences-system-time-symbolic', 'org.devos.editor': 'accessories-text-editor-symbolic',
    'org.devos.files': 'folder-symbolic', 'org.devos.icons': 'applications-graphics-symbolic',
    'org.devos.launcher': 'view-app-grid-symbolic', 'org.devos.panel': 'view-more-symbolic',
    'org.devos.settings': 'preferences-system-symbolic', 'org.devos.terminal': 'utilities-terminal-symbolic',
    'org.devos.theme': 'applications-graphics-symbolic',
    'org.devos.updates': 'software-update-available-symbolic',
};
const sectionIcons: Record<string, string> = {
    appearance: 'applications-graphics-symbolic', panel: 'preferences-system-time-symbolic', session: 'system-run-symbolic',
};
function ColorSwatch({color}: {color: string}) {
    return <DrawingArea widthRequest={24} heightRequest={24} valign="center" tooltip={color}
        onDraw={(widget, cr) => {
            const valid = /^#[0-9a-fA-F]{6}$/.test(color), hex = valid ? color : '#566277';
            cr.arc(widget.get_allocated_width() / 2, widget.get_allocated_height() / 2, 10, 0, Math.PI * 2);
            cr.setSourceRGB(...[1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number]);
            cr.fillPreserve(); cr.setSourceRGBA(1, 1, 1, .18); cr.setLineWidth(1); cr.stroke();
            return false;
        }} />;
}
interface EditorProps {
    title: string; description: string; icon: string; sections: SettingsSection[]; values: SettingsValues;
    enabled?: boolean; error?: string; core?: boolean; notice: string;
    apply(enabled: boolean, values: SettingsValues): void;
}
function Editor({title, description, icon, sections, values, enabled, error, core, notice, apply}: EditorProps) {
    const [current, setCurrent] = useState(() => draft(values));
    const [active, setActive] = useState(enabled ?? true);
    const [status, setStatus] = useState('');
    const [dirty, setDirty] = useState(false);
    const [failed, setFailed] = useState(false);
    const changed = () => { setDirty(true); setFailed(false); setStatus('Unsaved changes'); };
    const edit = (key: string, value: string | boolean) => { setCurrent(previous => ({...previous, [key]: value})); changed(); };
    const reset = () => { setCurrent(draft(values)); setActive(enabled ?? true); setDirty(false); setFailed(false); setStatus(''); };
    const save = () => {
        try {
            const next: SettingsValues = {};
            for (const field of sections.flatMap(section => section.fields)) {
                const value = current[field.key];
                next[field.key] = field.type === 'number' ? (String(value).trim() ? Number(value) : NaN) : value;
            }
            apply(active, next); setDirty(false); setFailed(false); setStatus('Settings applied');
        } catch (reason) { setFailed(true); setStatus(reason instanceof Error ? reason.message : String(reason)); }
    };
    return <Box className="settings-content" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={14}>
            <Label className="settings-eyebrow" xalign={0}>{core ? 'WORKSPACE / DESKTOP' : 'WORKSPACE / EXTENSIONS'}</Label>
            <Box spacing={14}>
                <Box className="settings-page-icon" widthRequest={44} heightRequest={44} valign="center">
                    <Image iconName={icon} pixelSize={24} expand />
                </Box>
                <Box orientation="vertical" spacing={5} expand>
                    <Label className="heading" xalign={0}>{title}</Label>
                    <Label className="settings-description" xalign={0} wrap maxWidthChars={60}>{description}</Label>
                </Box>
                <Label className={`settings-badge ${enabled === undefined ? 'badge-base' : active ? 'badge-on' : 'badge-off'}`} valign="start">
                    {enabled === undefined ? 'BASE' : active ? 'ON' : 'OFF'}
                </Label>
            </Box>
        </Box>
        <ScrolledWindow expand fill minContentHeight={240} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="settings-form" orientation="vertical" spacing={16}>
                {enabled !== undefined && <Box className="settings-card settings-enable" spacing={16} borderWidth={16}>
                    <Box orientation="vertical" spacing={5} expand>
                        <Label className="settings-field-title" xalign={0}>Enable extension</Label>
                        <Label className="settings-description" xalign={0}>Use this extension in your desktop.</Label>
                    </Box>
                    <Switch id="settings-enable-extension" active={active} valign="center"
                        onActiveChanged={button => { setActive(button.active); changed(); }} />
                </Box>}
                {error && <Label className="settings-error-banner" xalign={0} wrap>{error}</Label>}
                {sections.filter(section => section.fields.length).map(section => <Box className="settings-card" key={section.id} orientation="vertical">
                    <Box className="settings-card-header" spacing={10}>
                        <Image iconName={sectionIcons[section.id] ?? icon} pixelSize={18} valign="start" />
                        <Box orientation="vertical" spacing={4} expand>
                            <Label className="section-heading" xalign={0}>{section.title}</Label>
                            {section.description && <Label className="settings-description" xalign={0} wrap maxWidthChars={60}>{section.description}</Label>}
                        </Box>
                    </Box>
                    {section.fields.map((field, index) => {
                        const wide = Boolean((core && commandKeys.includes(field.key)) || (field.type === 'string' && field.default.length > 40));
                        return <Box className={`settings-field ${index ? 'field-divider' : ''}`} key={field.key}
                            orientation={wide ? 'vertical' : 'horizontal'} spacing={wide ? 10 : 16}>
                            <Box orientation="vertical" spacing={5} expand fill valign="center">
                                <Label className="settings-field-title" xalign={0} wrap maxWidthChars={35}>{field.title}</Label>
                                {field.description && <Label className="settings-description" xalign={0} wrap maxWidthChars={wide ? 65 : 35}>{field.description}</Label>}
                            </Box>
                            {field.type === 'boolean' ? <Switch id={`settings-field-${field.key}`} active={current[field.key] === true} valign="center"
                                onActiveChanged={button => edit(field.key, button.active)} /> :
                                <Box orientation="vertical" spacing={5} valign="center" hexpand={wide}
                                    widthRequest={wide ? undefined : field.type === 'number' ? 110 : 200}>
                                    <Box spacing={8}>
                                        {field.type === 'color' && <ColorSwatch color={String(current[field.key])} />}
                                        <Entry id={`settings-field-${field.key}`} className={wide || field.type === 'color' ? 'settings-code-input' : ''}
                                            widthChars={field.type === 'number' ? 8 : 18} expand fill
                                            text={String(current[field.key])} onChanged={entry => edit(field.key, entry.get_text())} />
                                    </Box>
                                    {field.type === 'number' && (field.min !== undefined || field.max !== undefined) &&
                                        <Label className="settings-input-hint" xalign={1}>{`${field.min ?? '…'} – ${field.max ?? '…'}${field.integer ? ' · Whole number' : ''}`}</Label>}
                                </Box>}
                        </Box>;
                    })}
                </Box>)}
                {!sections.some(section => section.fields.length) && <Box className="settings-card settings-empty" orientation="vertical" spacing={12} borderWidth={28}>
                    <Image iconName={icon} pixelSize={32} />
                    <Label className="section-heading">Ready to use</Label>
                    <Label className="settings-description" wrap>This extension has no configurable options.</Label>
                </Box>}
            </Box>
        </ScrolledWindow>
        <Box className="settings-action-bar" spacing={12}>
            <Image className={failed ? 'error' : dirty ? 'settings-pending' : 'settings-saved'}
                iconName={failed ? 'dialog-warning-symbolic' : dirty ? 'document-edit-symbolic' : 'emblem-ok-symbolic'} pixelSize={16} />
            <Label className={failed ? 'error' : 'settings-description'} xalign={0} wrap maxWidthChars={42} expand>
                {status || notice || 'Changes apply when you click Apply.'}
            </Label>
            <Button id="settings-reset" sensitive={dirty} onClicked={reset}>Reset</Button>
            <Button className="settings-primary" sensitive={dirty && !error && (enabled !== undefined || sections.some(section => section.fields.length))}
                onClicked={save}>Apply</Button>
        </Box>
    </Box>;
}
function SettingsView({services}: {services: SettingsServices}) {
    const [selected, select] = useState('core');
    const [revision, refresh] = useState(0);
    const [notice, setNotice] = useState('');
    const [query, setQuery] = useState('');
    useEffect(() => services.extensions.subscribe(() => refresh(value => value + 1)), [services]);
    useEffect(() => services.pages?.subscribe(() => refresh(value => value + 1)), [services]);
    const catalog = services.extensions.list(), info = catalog.find(item => item.manifest.id === selected);
    const filtered = catalog.filter(item => [item.manifest.name, item.manifest.description,
        ...item.manifest.settings.flatMap(section => [section.title, ...section.fields.map(field => field.title)])]
        .join(' ').toLowerCase().includes(query.trim().toLowerCase()));
    const core = CoreSections(services.getCore());
    const page = info ? {title: info.manifest.name, description: info.manifest.description,
        sections: info.manifest.settings, values: info.state.values, enabled: info.manifest.system ? undefined : info.state.enabled, error: info.error} :
        {title: 'Desktop', description: 'Personalize your workspace, panel and session.', ...core};
    const choose = (id: string) => { select(id); setNotice(''); };
    const CustomPage = services.pages?.get(selected);
    return <Box expand fill>
        <Box className="settings-sidebar" orientation="vertical" spacing={14} widthRequest={220}>
            <Box spacing={10} marginBottom={4}>
                <Box className="settings-brand" widthRequest={36} heightRequest={36}>
                    <Image iconName="preferences-system-symbolic" pixelSize={20} expand />
                </Box>
                <Box orientation="vertical" spacing={3} valign="center">
                    <Label className="settings-sidebar-title" xalign={0}>Settings</Label>
                    <Label className="settings-description" xalign={0}>Your workspace, your way</Label>
                </Box>
            </Box>
            <SearchEntry id="settings-search" text={query} widthChars={16} placeholder="Search extensions…"
                onChanged={entry => setQuery(entry.get_text())} />
            <Box orientation="vertical" spacing={6}>
                <Label className="settings-eyebrow" xalign={0} marginBottom={4}>PREFERENCES</Label>
                <Button id="settings-nav-core" className={`settings-nav ${selected === 'core' ? 'settings-nav-active' : ''}`} onClicked={() => choose('core')}>
                    <Box spacing={10}><Image iconName={pageIcons.core} pixelSize={17} /><Label xalign={0} expand>Desktop</Label></Box>
                </Button>
            </Box>
            <Box spacing={6}>
                <Label className="settings-eyebrow" xalign={0} expand>EXTENSIONS</Label>
                <Label className="settings-nav-count">{filtered.length}</Label>
            </Box>
            <ScrolledWindow expand fill minContentHeight={200} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
                <Box orientation="vertical" spacing={5}>
                    {filtered.map(item => <Button key={item.manifest.id} id={`settings-nav-${item.manifest.id}`}
                        className={`settings-nav ${selected === item.manifest.id ? 'settings-nav-active' : ''}`}
                        tooltip={item.manifest.description} onClicked={() => choose(item.manifest.id)}>
                        <Box spacing={10}>
                            <Image iconName={pageIcons[item.manifest.id] ?? 'application-x-addon-symbolic'} pixelSize={17} />
                            <Label xalign={0} expand ellipsize={Pango.EllipsizeMode.END}>{item.manifest.name}</Label>
                            <Label className={`settings-nav-state ${item.manifest.system ? 'nav-base' : item.state.enabled ? 'nav-on' : 'nav-off'}`}>
                                {item.manifest.system ? 'BASE' : item.state.enabled ? 'ON' : 'OFF'}
                            </Label>
                        </Box>
                    </Button>)}
                    {!filtered.length && <Label className="settings-description" xalign={0} wrap>No extensions found.</Label>}
                    {(services.extensions.diagnostics ?? []).map((message, index) => <Label key={index} wrap className="error" xalign={0}>{message}</Label>)}
                </Box>
            </ScrolledWindow>
            <Box className="settings-sidebar-footer" spacing={8}>
                <Image iconName="preferences-desktop-symbolic" pixelSize={15} />
                <Label className="settings-description" xalign={0} expand ellipsize={Pango.EllipsizeMode.END}>{services.getCore().name}</Label>
            </Box>
        </Box>
        {CustomPage ? <CustomPage key={selected} /> : <Editor key={`${selected}/${revision}`} {...page} icon={pageIcons[selected] ?? 'application-x-addon-symbolic'} core={!info} notice={notice}
            apply={(enabled, values) => {
                if (info) services.extensions.update(info.manifest.id, enabled, values);
                else {
                    const next: Record<string, unknown> = {...services.getCore(), ...values};
                    for (const key of commandKeys) next[key] = JSON.parse(String(values[key]));
                    services.saveCore(next);
                }
                services.applied(); setNotice('Settings applied');
            }} />}
    </Box>;
}
export function mountSettings(window: Gtk.ApplicationWindow, services: SettingsServices) {
    const root = createRoot(window);
    const header = mountWindowHeader(window, {title: 'Settings', iconName: 'preferences-system-symbolic',
        windowIconName: 'preferences-system', iconId: 'settings-window-icon'});
    let generation = 0;
    const show = () => { root.render(<SettingsView key={++generation} services={services} />); window.show(); window.present(); };
    show();
    return {show, destroy: () => { root.unmount(); header.destroy(); }};
}
