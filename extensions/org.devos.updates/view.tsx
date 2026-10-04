import Gtk from 'gi://Gtk?version=3.0';
import {React, Box, Label, Button, Entry, Switch, Image, ScrolledWindow, useState, useEffect} from '@dev-os/react-gtk';
import type {SettingsHost} from '../../src/extensions/types.js';
import type {Updates} from '../../src/updates/service.js';
import {repository} from '../../src/updates/protocol.js';

export function UpdatesView({updater, preferences}: {updater: Updates; preferences: SettingsHost}) {
    const id = 'org.devos.updates';
    const [state, setState] = useState(updater.state);
    const [source, setSource] = useState(String(preferences.get(id).state.values.repository));
    const [checkOnOpen, setCheckOnOpen] = useState(preferences.get(id).state.values.checkOnOpen === true);
    const [sourceError, setSourceError] = useState('');
    useEffect(() => updater.subscribe(() => setState(updater.state)), [updater]);
    useEffect(() => { if (preferences.get(id).state.values.checkOnOpen === true && updater.state.status === 'idle') void updater.check(); }, [updater, preferences]);
    const sourceDirty = source !== preferences.get(id).state.values.repository;
    const saveSource = () => {
        try {
            repository(source);
            preferences.update(id, true, {repository: source, checkOnOpen}); setSourceError('');
            void updater.check();
        } catch (error) { setSourceError(error instanceof Error ? error.message : String(error)); }
    };
    const canInstall = !sourceDirty && updater.canInstall;
    return <Box className="settings-content" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={14}>
            <Label className="settings-eyebrow" xalign={0}>WORKSPACE / SYSTEM</Label>
            <Box spacing={14}>
                <Box className="settings-page-icon" widthRequest={44} heightRequest={44} valign="center"><Image iconName="software-update-available-symbolic" pixelSize={24} expand /></Box>
                <Box orientation="vertical" spacing={5} expand>
                    <Label className="heading" xalign={0}>System updates</Label>
                    <Label className="settings-description" xalign={0}>Keep Dev OS and its built-in extensions up to date.</Label>
                </Box>
                <Label className="settings-badge badge-on" valign="start">STABLE</Label>
            </Box>
        </Box>
        <ScrolledWindow expand fill minContentHeight={240} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="settings-form" orientation="vertical" spacing={16}>
                <Box className="settings-card updates-summary" orientation="vertical" spacing={16}>
                    <Box spacing={14}>
                        <Image className={state.error ? 'error' : 'settings-saved'} iconName={state.error ? 'dialog-warning-symbolic' : state.busy ? 'view-refresh-symbolic' : 'software-update-available-symbolic'} pixelSize={30} />
                        <Box orientation="vertical" spacing={5} expand>
                            <Label id="updates-status" className="section-heading" xalign={0} wrap>{state.message}</Label>
                            <Label className="settings-description" xalign={0}>{`Running ${state.running}  ·  Installed ${state.installed}`}</Label>
                        </Box>
                    </Box>
                    {state.error && <Label className="error" xalign={0} wrap maxWidthChars={65}>{state.error}</Label>}
                    <Box spacing={8}>
                        <Button id="updates-check" sensitive={!state.busy && !sourceDirty} onClicked={() => { void updater.check(); }}>{state.status === 'checking' ? 'Checking…' : 'Check for updates'}</Button>
                        {canInstall && <Button id="updates-install" className="settings-primary" sensitive={!state.busy} onClicked={() => { void updater.install(); }}>Install update</Button>}
                        {state.previous && <Button id="updates-rollback" sensitive={!state.busy} onClicked={() => { void updater.rollback(); }}>Use previous version</Button>}
                    </Box>
                    {state.checked && <Label className="settings-description" xalign={0}>{`Last checked ${new Date(state.checked).toLocaleString()}`}</Label>}
                </Box>
                {state.release && <Box className="settings-card" orientation="vertical">
                    <Box className="settings-card-header" spacing={10}><Image iconName="document-new-symbolic" pixelSize={18} /><Label className="section-heading" xalign={0}>{`Dev OS ${state.release.version}`}</Label></Box>
                    <Box className="updates-details" orientation="vertical" spacing={10}>
                        <Label className="settings-description" xalign={0}>{`${state.release.platform}  ·  ${(state.release.size / 1024 / 1024).toFixed(1)} MB  ·  SHA-256 verified before installation`}</Label>
                        <Label xalign={0} wrap selectable maxWidthChars={75}>{state.release.notes || 'This release has no release notes.'}</Label>
                    </Box>
                </Box>}
                {(state.status === 'ready' || (state.managed && state.installed !== state.running)) && <Box className="settings-card updates-details" orientation="vertical" spacing={10}>
                    <Label className="section-heading" xalign={0}>Ready for your next session</Label>
                    <Label className="settings-description" xalign={0} wrap>Save your work, then start the updated desktop. Your current session and preferences stay available.</Label>
                    <Label className="updates-command" selectable xalign={0}>dev-os-updated-session --nested</Label>
                    <Label className="settings-description" xalign={0}>Windows / WSL: .\dev.ps1 updated</Label>
                </Box>}
                <Box className="settings-card" orientation="vertical">
                    <Box className="settings-card-header" spacing={10}><Image iconName="network-server-symbolic" pixelSize={18} /><Label className="section-heading" xalign={0}>Update source</Label></Box>
                    <Box className="updates-details" orientation="vertical" spacing={12}>
                        <Label className="settings-description" xalign={0}>Public GitHub repository · owner/repo</Label>
                        <Box spacing={8}><Entry id="updates-repository" text={source} sensitive={!state.busy} expand
                            onChanged={entry => { setSource(entry.get_text()); setSourceError(''); }} /><Button id="updates-save-source" sensitive={sourceDirty && !state.busy} onClicked={saveSource}>Save source</Button></Box>
                        {sourceError && <Label className="error" xalign={0} wrap>{sourceError}</Label>}
                        <Box spacing={16}>
                            <Label className="settings-field-title" xalign={0} expand>Check when opening Updates</Label>
                            <Switch id="updates-auto-check" active={checkOnOpen} sensitive={!state.busy} onActiveChanged={button => {
                                setCheckOnOpen(button.active);
                                preferences.update(id, true, {...preferences.get(id).state.values, checkOnOpen: button.active});
                            }} />
                        </Box>
                    </Box>
                </Box>
            </Box>
        </ScrolledWindow>
        <Box className="settings-action-bar" spacing={10}><Image iconName="changes-prevent-symbolic" pixelSize={16} className="settings-saved" /><Label className="settings-description" xalign={0} wrap expand>Updates install alongside existing versions. You can switch back to the previous version.</Label></Box>
    </Box>;
}
