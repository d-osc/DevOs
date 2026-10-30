import {React, Gtk, Box, Label, Image, Button, Switch, ScrolledWindow, useState, type SettingsHost} from '@dev-os/core';
import {settingsOptions} from './options.js';
const id = 'org.devos.settings';
export function SettingsPreferences({preferences}: {preferences: SettingsHost}) {
    const info = preferences.get(id);
    const [saved, setSaved] = useState(() => settingsOptions(info.state.values));
    const [draft, setDraft] = useState(saved);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');
    const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
    const choices = [
        {key: 'compactNavigation', title: 'Compact navigation', description: 'Smaller menu rows leave room for more extensions.', icon: 'view-list-symbolic'},
        {key: 'rememberPage', title: 'Continue where you left off', description: 'Reopen the last page during this desktop session.', icon: 'document-open-recent-symbolic'},
        {key: 'closeOnEscape', title: 'Close with Esc', description: 'Hide the Settings window with the Escape key.', icon: 'input-keyboard-symbolic'},
    ] as const;
    return <Box className="settings-content" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={6}><Label className="settings-eyebrow" xalign={0}>PREFERENCES / SETTINGS APP</Label><Label className="heading" xalign={0}>Settings</Label><Label className="settings-description" xalign={0}>A comfortable place to make your desktop yours.</Label></Box>
        <ScrolledWindow expand fill minContentHeight={240} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="settings-form" orientation="vertical" spacing={18}>
                <Box className="settings-app-stage" orientation="vertical" spacing={14}>
                    <Label className="settings-eyebrow" xalign={0}>NAVIGATION PREVIEW</Label>
                    <Box className="settings-app-preview" heightRequest={200}>
                        <Box id="settings-preview-navigation" className={`settings-preview-navigation ${draft.compactNavigation ? 'settings-preview-compact' : ''}`} orientation="vertical" spacing={6} widthRequest={170}>
                            <Box spacing={8}><Image iconName="preferences-system-symbolic" pixelSize={18} /><Label className="section-heading">Settings</Label></Box>
                            {['Desktop', 'Background', 'Clock', 'Settings'].map((name, index) => <Box key={name} className={`settings-preview-row ${index === 3 ? 'settings-preview-active' : ''}`} spacing={8}><Image iconName={['video-display-symbolic', 'preferences-desktop-wallpaper-symbolic', 'preferences-system-time-symbolic', 'preferences-system-symbolic'][index]} pixelSize={14} /><Label xalign={0}>{name}</Label></Box>)}
                        </Box>
                        <Box orientation="vertical" spacing={12} expand valign="center" borderWidth={20}><Image iconName="preferences-system-symbolic" pixelSize={32} /><Label className="section-heading">Make it feel like home</Label><Label className="settings-description" wrap>One place for your preferences.</Label></Box>
                    </Box>
                    <Label className="settings-description" xalign={0}>Preview your navigation density before applying.</Label>
                </Box>
                <Box className="settings-card settings-app-card" orientation="vertical" spacing={22}>{choices.map(choice => <Box key={choice.key} spacing={14}><Image iconName={choice.icon} pixelSize={20} /><Box orientation="vertical" spacing={5} expand><Label className="settings-field-title" xalign={0}>{choice.title}</Label><Label className="settings-description" wrap xalign={0}>{choice.description}</Label></Box><Switch id={`settings-option-${choice.key}`} active={draft[choice.key]} valign="center" onActiveChanged={widget => {setDraft(current => ({...current, [choice.key]: widget.active})); setError(''); setStatus('');}} /></Box>)}</Box>
                <Box spacing={10}><Image iconName="edit-find-symbolic" pixelSize={16} /><Label className="settings-description" wrap xalign={0}>Use the sidebar search to find extensions and their options.</Label></Box>
                {(error || info.error) && <Label className="error" wrap xalign={0}>{error || info.error}</Label>}
            </Box>
        </ScrolledWindow>
        <Box className="settings-action-bar" spacing={12}><Label className="settings-description" wrap xalign={0} expand>{status || (dirty ? 'Unsaved changes · Preview only' : 'Ready for your next adjustment.')}</Label><Button id="settings-app-reset" sensitive={dirty} onClicked={() => {setDraft({...saved}); setError(''); setStatus('');}}>Reset</Button><Button id="settings-app-apply" className="settings-primary" sensitive={dirty && !info.error} onClicked={() => {try {preferences.update(id, true, {...draft}); setSaved({...draft}); setStatus('Settings updated.');} catch (reason) {setError(reason instanceof Error ? reason.message : String(reason));}}}>Apply</Button></Box>
    </Box>;
}
