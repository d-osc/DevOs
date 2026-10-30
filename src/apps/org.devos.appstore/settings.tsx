import {Gtk, React, Box, Label, Button, Image, ScrolledWindow, useState, useEffect} from '@dev-os/core';
import {AppStore, type StoreControls, type StoreState} from './backend.js';

export function AppStoreSettings({openStore, openExtensions, controls}: {openStore: () => void; openExtensions?: () => void; controls?: StoreControls}) {
    const [backend] = useState(() => controls ?? new AppStore());
    const [state, setState] = useState<StoreState | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
    useEffect(() => {
        let alive = true;
        void backend.request('get').then(value => {if (alive) setState(value);}).catch(reason => {if (alive) setError(String(reason));}).finally(() => {if (alive) setBusy(false);});
        return () => {alive = false;};
    }, [backend]);
    const refresh = async (updates = false) => {
        setBusy(true); setError(''); setNotice('');
        try {const next = await backend.request(updates ? 'updates' : 'get'); setState(next); setNotice(updates ? `${next.updates?.length ?? 0} app updates available` : 'Store status refreshed');}
        catch (reason) {setError(String(reason));} finally {setBusy(false);}
    };
    const ready = state?.available && state.connected;
    return <Box className="settings-content app-store-settings" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={14}>
            <Label className="settings-eyebrow" xalign={0}>EXTENSIONS / APP STORE</Label>
            <Box spacing={14}>
                <Box className="settings-page-icon" widthRequest={48} heightRequest={48} valign="center"><Image iconName="system-software-install-symbolic" pixelSize={26} expand/></Box>
                <Box orientation="vertical" spacing={5} expand><Label className="heading" xalign={0}>App Store</Label><Label className="settings-description" wrap xalign={0}>Native applications, built for DevOs.</Label></Box>
                <Button id="app-store-settings-refresh" sensitive={!busy} valign="center" onClicked={() => {void refresh();}}>Refresh</Button>
            </Box>
        </Box>
        <ScrolledWindow expand fill hscrollbarPolicy={Gtk.PolicyType.NEVER}>
            <Box className="settings-form" orientation="vertical" spacing={16}>
                <Box className="settings-card app-store-settings-hero" orientation="vertical" spacing={14}>
                    <Box spacing={10}><Label className="section-heading" expand xalign={0}>{state?.sourceName || 'DevOs repository'}</Label><Label id="app-store-settings-status" className={`settings-badge ${ready ? 'badge-on' : ''}`}>{busy ? 'LOADING' : ready ? 'READY' : state?.connected ? 'PREVIEW' : 'NOT PUBLISHED'}</Label></Box>
                    <Label className="settings-description" wrap xalign={0}>{state ? state.connected ? state.available ? 'Your signed DevOs repository is ready. Browse native apps and manage their installation.' : 'Repository configured. Native package operations become available when you boot DevOs.' : 'The DevOs repository has not been published or configured yet. Applications will appear after real packages and a signed feed are available.' : 'Reading the native store status…'}</Label>
                    <Button id="app-store-settings-open" className="settings-primary" halign="start" onClicked={openStore}>Open App Store</Button>
                </Box>
                <Box spacing={12}>{[['Native catalog apps', state?.catalog.length], ['Installed native apps', state?.installed.length], ['Known native updates', state?.updates?.length]].map(([title, count]) => <Box key={String(title)} className="settings-card app-store-settings-stat" orientation="vertical" spacing={8} expand hexpand><Label className="settings-description" xalign={0}>{String(title)}</Label><Label className="heading" xalign={0}>{state ? String(count ?? 0) : '—'}</Label></Box>)}</Box>
                {openExtensions && <Box className="settings-card" orientation="vertical" spacing={12}><Label className="section-heading" xalign={0}>Extensions</Label><Label className="settings-description" wrap xalign={0}>Connect GitHub repositories and manage extension installs, updates and rollback in App Store.</Label><Button id="app-store-settings-extensions" halign="start" onClicked={openExtensions}>Manage extensions</Button></Box>}
                <Box className="settings-card" orientation="vertical" spacing={12}>
                    <Label className="section-heading" xalign={0}>Updates</Label>
                    <Label className="settings-description" wrap xalign={0}>Check the signed repository for application updates. Refreshing the package index requires administrator approval; you choose which apps to update in the store.</Label>
                    <Button id="app-store-settings-updates" halign="start" sensitive={!busy && !!ready} onClicked={() => {void refresh(true);}}>Check app updates</Button>
                </Box>
                <Box className="settings-card" orientation="vertical" spacing={10}>
                    <Label className="section-heading" xalign={0}>Installation and access</Label>
                    <Label className="settings-description" wrap xalign={0}>Native apps are installed for this DevOs system and are available to its users. Installing or removing apps requires administrator approval. Core system components are managed by OS updates.</Label>
                    {state?.message && <Label id="app-store-settings-session" className="settings-description" wrap xalign={0}>{state.message}</Label>}
                </Box>
                {error && <Label id="app-store-settings-error" className="error" wrap selectable xalign={0}>{error}</Label>}
            </Box>
        </ScrolledWindow>
        <Box className="settings-action-bar" spacing={10}><Image iconName={busy ? 'view-refresh-symbolic' : 'changes-prevent-symbolic'} pixelSize={16}/><Label className="settings-description" expand wrap xalign={0}>{busy ? 'Reading store status…' : notice || 'Repository trust and system packages are managed by your administrator.'}</Label></Box>
    </Box>;
}
