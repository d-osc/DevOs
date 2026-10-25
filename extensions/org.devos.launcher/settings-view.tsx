import {React, Gtk, Pango, Box, Label, Button, Image, Switch, SpinButton, ScrolledWindow, useState, type SettingsHost} from '@dev-os/core';
import {launcherOptions, type LauncherOptions} from './options.js';

const id = 'org.devos.launcher';
const samples = [
    {name: 'Terminal', description: 'Native desktop terminal', icon: 'dev-os-terminal-symbolic'},
    {name: 'Files', description: 'Browse your workspace', icon: 'dev-os-files-symbolic'},
    {name: 'Editor', description: 'Write something great', icon: 'dev-os-editor'},
];
const toggles = [
    {key: 'showWorkspace', title: 'Workspace shortcuts', description: 'Keep Terminal, Files and Editor close at hand.', icon: 'view-app-grid-symbolic'},
    {key: 'showDescriptions', title: 'App descriptions', description: 'Show a short description below each application.', icon: 'view-list-symbolic'},
    {key: 'rememberSearch', title: 'Remember the last search', description: 'Continue your search the next time you open the menu.', icon: 'edit-find-symbolic'},
] as const;
export function LauncherSettings({preferences, applied}: {preferences: SettingsHost; applied(): void;}) {
    const info = preferences.get(id);
    const [saved, setSaved] = useState(() => launcherOptions(info.state.values));
    const [options, setOptions] = useState(saved);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');
    const dirty = JSON.stringify(options) !== JSON.stringify(saved);
    const edit = (next: Partial<LauncherOptions>) => { setOptions(current => ({...current, ...next})); setError(''); setStatus(''); };
    const apply = () => {
        try {
            preferences.update(id, true, {...preferences.get(id).state.values, ...options}); applied(); setSaved({...options}); setStatus('Launcher updated. Open the menu to try it.');
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    };
    return <Box className="settings-content launcher-settings-page" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={6}>
            <Label className="settings-eyebrow" xalign={0}>PERSONALIZATION / APPLICATIONS</Label>
            <Label className="heading" xalign={0}>Launcher</Label>
            <Label className="settings-description" xalign={0}>A faster way into your workspace. Make the menu feel like yours.</Label>
        </Box>
        <ScrolledWindow expand fill minContentHeight={240} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="settings-form" orientation="vertical" spacing={18}>
                <Box className="launcher-settings-stage" orientation="vertical" spacing={14}>
                    <Box spacing={8}><Label className="settings-eyebrow" xalign={0} expand>LAYOUT PREVIEW</Label><Label id="launcher-width-preview" className="launcher-settings-width">{`${options.menuWidth} px`}</Label></Box>
                    <Box className="launcher-settings-preview" orientation="vertical" spacing={12} halign="center" widthRequest={Math.round(options.menuWidth * .62)}>
                        <Box spacing={10}><Box className="launcher-settings-brand" widthRequest={30} heightRequest={30}><Image iconName="view-app-grid-symbolic" pixelSize={17} expand /></Box><Label className="section-heading" xalign={0} expand>Applications</Label><Image iconName="window-close-symbolic" pixelSize={13} /></Box>
                        <Box className="launcher-preview-search" spacing={8}><Image iconName="edit-find-symbolic" pixelSize={14} /><Label className="settings-description" xalign={0} expand>Search applications…</Label></Box>
                        {options.showWorkspace && <Box id="launcher-preview-workspace" spacing={6} homogeneous>{samples.map(app => <Box key={app.name} className="launcher-preview-shortcut" spacing={5} expand fill><Image iconName={app.icon} pixelSize={14} /><Label className="launcher-preview-shortcut-label">{app.name}</Label></Box>)}</Box>}
                        <Label className="settings-eyebrow" xalign={0}>ALL APPLICATIONS</Label>
                        <Box orientation="vertical" spacing={options.compactRows ? 3 : 6}>
                            {samples.map((app, index) => <Box key={app.name} className={`launcher-preview-row ${index === 0 ? 'launcher-preview-selected' : ''} ${options.compactRows ? 'launcher-preview-compact' : ''}`} spacing={10}>
                                <Box className="launcher-preview-icon" widthRequest={options.iconSize + 6} heightRequest={options.iconSize + 6} valign="center"><Image iconName={app.icon} pixelSize={options.iconSize} expand /></Box>
                                <Box orientation="vertical" spacing={3} expand valign="center"><Label className="launcher-preview-name" xalign={0}>{app.name}</Label>{options.showDescriptions && <Label id={`launcher-preview-description-${index}`} className="settings-description" xalign={0} maxWidthChars={22} ellipsize={Pango.EllipsizeMode.END}>{app.description}</Label>}</Box>
                                <Image iconName="go-next-symbolic" pixelSize={10} valign="center" />
                            </Box>)}
                        </Box>
                        <Box className="launcher-preview-footer" spacing={8}><Image iconName="dev-os-settings-symbolic" pixelSize={13} /><Label className="settings-description" expand xalign={0}>Settings</Label><Image iconName="system-lock-screen-symbolic" pixelSize={13} /><Image iconName="system-log-out-symbolic" pixelSize={13} /></Box>
                    </Box>
                    <Label className="settings-description" xalign={0}>Example apps · Your installed applications appear in the real menu.</Label>
                </Box>
                <Box orientation="vertical" spacing={10}>
                    <Label className="section-heading" xalign={0}>Choose your spacing</Label>
                    <Box spacing={12} homogeneous>
                        {[{compact: false, title: 'Comfortable', detail: 'More room for every app', icon: 'view-grid-symbolic'}, {compact: true, title: 'Compact', detail: 'More apps in less space', icon: 'view-list-symbolic'}].map(item => <Button key={item.title} id={`launcher-density-${item.compact ? 'compact' : 'comfortable'}`} className={`launcher-density ${options.compactRows === item.compact ? 'launcher-density-selected' : ''}`} expand fill onClicked={() => edit({compactRows: item.compact})}>
                            <Box spacing={12}><Image iconName={item.icon} pixelSize={22} valign="center" /><Box orientation="vertical" spacing={5} expand><Label className="settings-field-title" xalign={0}>{item.title}</Label><Label className="settings-description" xalign={0}>{item.detail}</Label></Box></Box>
                        </Button>)}
                    </Box>
                </Box>
                <Box className="settings-card launcher-settings-card" orientation="vertical" spacing={16}>
                    <Box spacing={14}><Box orientation="vertical" spacing={5} expand><Label className="settings-field-title" xalign={0}>Search width</Label><Label className="settings-description" wrap xalign={0}>Applications opens full screen. The centered search field fits smaller displays automatically.</Label></Box><SpinButton id="launcher-menu-width" value={options.menuWidth} lower={420} upper={900} step={20} digits={0} numeric widthChars={5} onValueChanged={widget => edit({menuWidth: widget.get_value_as_int()})} /></Box>
                    <Box spacing={14}><Box orientation="vertical" spacing={5} expand><Label className="settings-field-title" xalign={0}>App icon size</Label><Label className="settings-description" xalign={0}>Choose a size between 20 and 40 pixels.</Label></Box><SpinButton id="launcher-icon-size" value={options.iconSize} lower={20} upper={40} step={2} digits={0} numeric widthChars={5} onValueChanged={widget => edit({iconSize: widget.get_value_as_int()})} /></Box>
                </Box>
                <Box className="settings-card launcher-settings-card" orientation="vertical" spacing={18}>
                    {toggles.map(item => <Box key={item.key} spacing={12}><Image iconName={item.icon} pixelSize={18} valign="center" /><Box orientation="vertical" spacing={5} expand><Label className="settings-field-title" xalign={0}>{item.title}</Label><Label className="settings-description" xalign={0} wrap>{item.description}</Label></Box><Switch id={`launcher-option-${item.key}`} active={options[item.key]} valign="center" onActiveChanged={widget => edit({[item.key]: widget.active})} /></Box>)}
                </Box>
                <Box className="launcher-settings-keys" spacing={10}><Image iconName="input-keyboard-symbolic" pixelSize={17} /><Label className="settings-description" wrap xalign={0}>Super / Windows  Applications    ·    ↑ ↓  Navigate    ·    Enter  Launch    ·    Esc  Close</Label></Box>
                {(error || info.error) && <Label id="launcher-settings-error" className="error" xalign={0} wrap>{error || info.error}</Label>}
            </Box>
        </ScrolledWindow>
        <Box className="settings-action-bar" spacing={12}>
            <Label id="launcher-settings-status" className="settings-description" xalign={0} expand wrap>{status || (dirty ? 'Unsaved changes · Preview only' : 'Your workspace, one shortcut away.')}</Label>
            <Button id="launcher-settings-reset" sensitive={dirty} onClicked={() => { setOptions({...saved}); setError(''); setStatus(''); }}>Reset</Button>
            <Button id="launcher-settings-apply" className="settings-primary" sensitive={dirty && !info.error} onClicked={apply}>Apply</Button>
        </Box>
    </Box>;
}
