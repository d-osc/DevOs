import {Gtk, Gio, React, Box, Label, Button, Image, SearchEntry, ScrolledWindow, useState, useEffect} from '@dev-os/core';
import type {App, Action, StoreControls, StoreState} from './backend.js';
import {launchDesktopApp} from '@dev-os/services/apps';
const sections = ['Discover', 'Installed', 'Updates', 'Creative', 'Productivity', 'Internet', 'Media'];
export function AppStoreView({controls}: {controls: StoreControls}) {
    const [state, setState] = useState<StoreState | null>(null), [section, setSection] = useState('Discover');
    const [query, setQuery] = useState(''), [selected, setSelected] = useState<App | null>(null), [confirmation, setConfirmation] = useState<Action | null>(null);
    const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [limit, setLimit] = useState(40);
    const request = async (action: Action, app?: App) => {
        setBusy(action === 'install' ? `Installing ${app?.name}…` : action === 'remove' ? `Removing ${app?.name}…` : action === 'update' ? `Updating ${app?.name}…` : action === 'browse' ? 'Refreshing the DevOs catalog…' : action === 'updates' ? 'Checking for updates…' : 'Working…'); setError(''); setNotice('');
        try {
            const next = await controls.request(action, app?.id);
            setState(next);
            setConfirmation(null);
            if (action !== 'get') setNotice(action === 'install' ? `${app?.name} installed` : action === 'remove' ? `${app?.name} removed` : action === 'update' ? `${app?.name} updated` : action === 'updates' ? `${next.updates?.length ?? 0} updates available from DevOs` : 'DevOs catalog refreshed');
        } catch (reason) {setError(String(reason));} finally {setBusy('');}
    };
    useEffect(() => {void request('get');}, [controls]);
    const installed = new Map(state?.installed.map(app => [app.id, app]) ?? []);
    const recommended = state?.catalog ?? [];
    const catalog = new Map(recommended.map(app => [app.id, app]));
    let apps = section === 'Installed' ? (state?.installed ?? []).map(app => ({...catalog.get(app.id), ...app})) : section === 'Updates' ? (state?.updates ?? []).map(app => ({...catalog.get(app.id), ...app})) : recommended;
    if (!['Discover', 'Installed', 'Updates'].includes(section)) apps = apps.filter(app => app.category === section);
    const needle = query.trim().toLowerCase(); apps = apps.filter(app => `${app.name} ${app.id} ${app.description ?? ''}`.toLowerCase().includes(needle));
    const detailsInstalled = selected ? installed.get(selected.id) : undefined;
    const openPage = (app: App) => {try {if (app.website?.startsWith('https://')) Gio.AppInfo.launch_default_for_uri(app.website, null);} catch (reason) {setError(String(reason));}};
    const launch = (app: App) => {const desktop = Gio.AppInfo.get_all().find(item => item.get_id() === app.desktopId); if (!desktop) {setError('Application launcher is not installed.'); return;} void launchDesktopApp(desktop).catch(reason => setError(String(reason)));};
    return <Box className="app-store-body" orientation="vertical">
        <Box className="app-store-topbar" spacing={18}><Image iconName="system-software-install-symbolic" pixelSize={28}/><Label className="app-store-brand">App Store</Label><SearchEntry id="app-store-search" expand hexpand placeholder="Search apps, tools and ideas" text={query} onChanged={widget => {setQuery(widget.get_text()); setLimit(40);}}/><Button id="app-store-refresh" sensitive={!busy} onClicked={() => {void request('get');}}>Refresh</Button></Box>
        <Box expand vexpand>
            <Box className="app-store-sidebar" orientation="vertical" spacing={6} widthRequest={170}>
                <Label className="app-store-eyebrow" xalign={0}>YOUR STORE</Label>
                {sections.map(name => <Button key={name} id={`app-store-tab-${name.toLowerCase()}`} className={section === name ? 'selected' : ''} sensitive={!busy} onClicked={() => {setSection(name); setSelected(null); setConfirmation(null); setLimit(40);}}>{name}</Button>)}
                <Box expand vexpand/><Label className="subtle" xalign={0} wrap>Native applications for DevOs</Label><Label className="app-store-source" xalign={0}>{state?.connected ? '● DevOs repository configured' : '○ Repository not published'}</Label>
            </Box>
            <ScrolledWindow expand hexpand vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER}><Box className="app-store-content" orientation="vertical" spacing={18}>
                {section === 'Discover' && !selected && <Box className="app-store-hero" orientation="vertical" spacing={12}><Label className="app-store-eyebrow" xalign={0}>MAKE IT YOURS</Label><Label className="app-store-hero-title" xalign={0} wrap>A little more possibility.</Label><Label xalign={0} wrap>Find the tools for your next idea. Native apps, built for DevOs.</Label><Box spacing={8}><Label className="app-store-chip">Creative tools</Label><Label className="app-store-chip">Everyday essentials</Label><Label className="app-store-chip">Native packages</Label></Box></Box>}
                {state?.message && <Label className="app-store-notice" wrap xalign={0}>{state.message}</Label>}
                {state && !state.connected && <Box className="app-store-card" orientation="vertical" spacing={10}><Label className="app-store-section" xalign={0}>Your DevOs repository</Label><Label wrap xalign={0}>The repository is being prepared. Apps will appear after native packages are published and the signed feed is configured by an administrator.</Label></Box>}
                {error && <Label id="app-store-error" className="error" wrap selectable xalign={0}>{error}</Label>}
                {notice && <Label className="app-store-success" wrap xalign={0}>{notice}</Label>}
                {busy && <Label id="app-store-busy" className="app-store-notice" wrap xalign={0}>{`${busy} Keep the store open until this operation finishes. Native package changes require administrator authorization.`}</Label>}
                {selected ? <Box orientation="vertical" spacing={18}>
                    <Button id="app-store-back" sensitive={!busy} onClicked={() => {setSelected(null); setConfirmation(null);}}>Back to apps</Button>
                    <Box className="app-store-card" spacing={18}><Image iconName={selected.icon || 'application-x-executable-symbolic'} pixelSize={56}/><Box orientation="vertical" spacing={8} expand><Label className="app-store-detail-title" xalign={0} wrap>{selected.name}</Label><Label className="subtle" xalign={0} selectable wrap>{selected.id}</Label><Label xalign={0}>{detailsInstalled ? `Installed · ${detailsInstalled.version || 'Version not provided'}` : 'Native DevOs package'}</Label></Box></Box>
                    <Label xalign={0} wrap>{selected.description || 'Native application distributed through the DevOs repository.'}</Label>
                    <Box spacing={10}>{detailsInstalled ? <><Button id="app-store-open" sensitive={!busy && !!selected.desktopId} onClicked={() => launch(selected)}>Open</Button><Button id="app-store-update" sensitive={!busy && state?.available === true && state.connected} onClicked={() => setConfirmation('update')}>Update</Button><Button id="app-store-remove" sensitive={!busy && selected.removable !== false && state?.available === true && state.connected} onClicked={() => setConfirmation('remove')}>Remove…</Button></> : <Button id="app-store-install" className="app-store-primary" sensitive={!busy && state?.available === true && state.connected} onClicked={() => setConfirmation('install')}>Install…</Button>}{selected.website?.startsWith('https://') && <Button sensitive={!busy} onClicked={() => openPage(selected)}>Project website</Button>}</Box>
                    {confirmation && <Box className="app-store-confirm" orientation="vertical" spacing={12}><Label className="app-store-section" xalign={0}>{`${confirmation === 'remove' ? 'Remove' : confirmation === 'update' ? 'Update' : 'Install'} ${selected.name}?`}</Label><Label wrap xalign={0}>{confirmation === 'remove' ? 'Remove this native application from the DevOs system. Administrator authorization is required.' : confirmation === 'update' ? 'Download and apply the available DevOs package update. Administrator authorization is required.' : 'Install this native application and required dependencies from the signed DevOs repository. Administrator authorization is required.'}</Label><Box spacing={10}><Button id="app-store-cancel" sensitive={!busy} onClicked={() => setConfirmation(null)}>Cancel</Button><Button id="app-store-confirm" className="app-store-primary" sensitive={!busy} onClicked={() => {void request(confirmation, selected);}}>{confirmation === 'remove' ? 'Remove app' : confirmation === 'update' ? 'Update app' : 'Install app'}</Button></Box></Box>}
                </Box> : <Box orientation="vertical" spacing={14}>
                    <Box spacing={10}><Label className="app-store-section" expand xalign={0}>{section === 'Discover' ? 'Explore DevOs apps' : section}</Label>{section === 'Discover' && <Button id="app-store-browse" sensitive={!busy && state?.connected === true} onClicked={() => {void request('browse');}}>Refresh catalog</Button>}{section === 'Updates' && <Button id="app-store-check-updates" sensitive={!busy && state?.connected === true} onClicked={() => {void request('updates');}}>Check for updates</Button>}</Box>
                    {section === 'Installed' && <Label className="subtle" xalign={0} wrap>Native applications registered in the DevOs catalog. Core system components are managed by OS updates.</Label>}
                    {apps.slice(0, limit).map(app => <Button key={app.id} id={`app-store-app-${app.id}`} className="app-store-app" sensitive={!busy} onClicked={() => {setSelected(app); setConfirmation(null); setNotice('');}}><Box spacing={16}><Box className={`app-store-icon category-${(app.category || 'other').toLowerCase()}`} widthRequest={56} heightRequest={56}><Image iconName={app.icon || 'application-x-executable-symbolic'} pixelSize={28} expand/></Box><Box orientation="vertical" spacing={7} expand hexpand><Label className="app-store-app-name" xalign={0} wrap>{app.name}</Label><Label className="subtle" xalign={0} wrap maxWidthChars={65}>{app.description || app.id}</Label></Box><Label className="app-store-chip">{installed.has(app.id) ? 'Installed' : app.category || 'DevOs'}</Label></Box></Button>)}
                    {!apps.length && <Box className="app-store-empty" orientation="vertical" spacing={12}><Image iconName="system-search-symbolic" pixelSize={36}/><Label wrap>{section === 'Updates' && !state?.updates ? 'Check for app updates when you are ready.' : section === 'Installed' && !query ? 'Your installed apps will appear here.' : 'No applications available here yet. Publish native packages to the DevOs repository first.'}</Label></Box>}
                    {apps.length > limit && <Button sensitive={!busy} onClicked={() => setLimit(value => value + 40)}>{`Show more · ${apps.length} apps`}</Button>}
                </Box>}
            </Box></ScrolledWindow>
        </Box>
    </Box>;
}
