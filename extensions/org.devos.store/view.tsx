import {
    Gtk, React, Box, Label, Button,
    Entry, Image, Switch, ScrolledWindow, useState,
    useEffect, type SettingsHost
} from '@dev-os/core';
import type {ExtensionStore} from '@dev-os/extensions';

export function StoreView({store, preferences}: {store: ExtensionStore; preferences: SettingsHost}) {
    const [, refresh] = useState(0), [source, setSource] = useState(''), [query, setQuery] = useState('');
    const [confirm, setConfirm] = useState('');
    useEffect(() => store.subscribe(() => refresh(value => value + 1)), [store]);
    useEffect(() => preferences.subscribe(() => refresh(value => value + 1)), [preferences]);
    const items = store.items.filter(item => `${item.repository} ${item.release?.manifest.name ?? ''} ${item.installed?.id ?? ''}`.toLowerCase().includes(query.toLowerCase()));
    return <Box className="settings-content" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={14}>
            <Label className="settings-eyebrow" xalign={0}>WORKSPACE / EXTENSIONS</Label>
            <Box spacing={14}>
                <Box className="settings-page-icon" widthRequest={44} heightRequest={44} valign="center"><Image iconName="application-x-addon-symbolic" pixelSize={24} expand /></Box>
                <Box orientation="vertical" spacing={5} expand><Label className="heading" xalign={0}>Extension Store</Label><Label className="settings-description" xalign={0}>Your tools, delivered through GitHub Releases.</Label></Box>
                <Label className="settings-badge badge-on" valign="start">GITHUB</Label>
            </Box>
        </Box>
        <ScrolledWindow expand fill minContentHeight={240} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="settings-form" orientation="vertical" spacing={16}>
                <Box className="settings-card updates-details" orientation="vertical" spacing={12}>
                    <Label className="section-heading" xalign={0}>Connect a repository</Label>
                    <Label className="settings-description" xalign={0} wrap>Paste owner/repo or a GitHub URL. The Store reads the latest stable release and its extension manifest.</Label>
                    <Box spacing={8}><Entry id="store-source" expand text={source} placeholder="https://github.com/owner/extension" sensitive={!store.busy} onChanged={entry => setSource(entry.get_text())} />
                        <Button id="store-connect" className="settings-primary" sensitive={!store.busy && Boolean(source.trim())} onClicked={() => { void store.connect(source); }}>Connect</Button></Box>
                    <Label className="settings-description" xalign={0} wrap>Connect repositories you trust. UI extensions execute code in your desktop session.</Label>
                </Box>
                <Box spacing={10}><Entry id="store-search" expand text={query} placeholder="Filter connected extensions" onChanged={entry => setQuery(entry.get_text())} /><Button id="store-check-all" sensitive={!store.busy && store.items.length > 0} onClicked={() => { void store.check(); }}>Check all</Button></Box>
                {store.error && <Label className="error" xalign={0} wrap>{store.error}</Label>}
                {!items.length && <Box className="settings-card updates-summary" orientation="vertical" spacing={8}>
                    <Image iconName="application-x-addon-symbolic" pixelSize={36} /><Label className="section-heading">{store.items.length ? 'No matching extensions' : 'Build your workspace'}</Label>
                    <Label className="settings-description" wrap>{store.items.length ? 'Try another search.' : 'Connect your first GitHub extension repository to get started.'}</Label>
                </Box>}
                {items.map(item => {
                    const manifest = item.release?.manifest;
                    const installed = item.installed;
                    const info = preferences.list().find(info => info.manifest.id === installed?.id);
                    return <Box key={item.repository} className="settings-card updates-details" orientation="vertical" spacing={12}>
                        <Box spacing={12}><Box className="store-extension-icon" widthRequest={40} heightRequest={40}><Image iconName="application-x-addon-symbolic" pixelSize={23} expand /></Box>
                            <Box orientation="vertical" spacing={4} expand><Label className="section-heading" xalign={0}>{manifest?.name ?? installed?.id ?? item.repository}</Label><Label className="settings-description" xalign={0}>{item.repository}</Label></Box>
                            <Label className={`settings-badge ${installed ? 'badge-on' : ''}`} valign="start">{installed ? 'INSTALLED' : 'CONNECTED'}</Label>
                        </Box>
                        {manifest && <Label xalign={0} wrap maxWidthChars={65}>{manifest.description}</Label>}
                        <Label className="settings-description" xalign={0} wrap>{`${installed ? `Installed ${installed.version} · ` : ''}${item.release ? `Latest ${item.release.version} · ${(item.release.size / 1024).toFixed(0)} KB · ` : ''}${item.message}`}</Label>
                        {item.error && <Label className="error" xalign={0} wrap>{item.error}</Label>}
                        <Box spacing={8}>
                            {store.canInstall(item) && <Button id={`store-install-${item.repository}`} className="settings-primary" sensitive={!store.busy} onClicked={() => { void store.install(item.repository); }}>{installed ? 'Update' : 'Install'}</Button>}
                            <Button sensitive={!store.busy} onClicked={() => { void store.check(item.repository); }}>Check release</Button>
                            {installed?.previous && <Button sensitive={!store.busy} onClicked={() => { void store.rollback(item.repository); }}>Rollback</Button>}
                            <Button sensitive={!store.busy} onClicked={() => store.disconnect(item.repository)}>Disconnect</Button>
                        </Box>
                        {installed && <Box spacing={12}><Label className="settings-description" xalign={0} expand>Enabled at next session</Label>
                            <Switch id={`store-enable-${installed.id}`} sensitive={!store.busy && !info?.error} active={info?.state.enabled === true} onActiveChanged={button => {
                                try { if (info) preferences.update(installed.id, button.active, info.state.values); } catch { refresh(value => value + 1); }
                            }} />
                            <Button sensitive={!store.busy} onClicked={() => { if (confirm === item.repository) { void store.uninstall(item.repository); setConfirm(''); } else setConfirm(item.repository); }}>{confirm === item.repository ? 'Confirm remove' : 'Remove'}</Button>
                            {confirm === item.repository && <Button onClicked={() => setConfirm('')}>Cancel</Button>}
                        </Box>}
                        {item.release?.notes && <Label className="settings-description" xalign={0} wrap maxWidthChars={65}>{item.release.notes.slice(0, 800)}</Label>}
                    </Box>;
                })}
            </Box>
        </ScrolledWindow>
        <Box className="settings-action-bar" spacing={10}><Image iconName={store.busy ? 'view-refresh-symbolic' : 'changes-prevent-symbolic'} pixelSize={16} className="settings-saved" /><Label id="store-status" className="settings-description" xalign={0} wrap expand>{store.message}</Label></Box>
    </Box>;
}
