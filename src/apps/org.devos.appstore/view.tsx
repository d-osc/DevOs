import {useDataView} from '../../use-data-view.js';
import {Gtk, Gio, GLib, React, Box, Label, Button, Image, SearchEntry, ScrolledWindow, FlowBox, FlowBoxChild, Expander, useState, useEffect, useRef} from '@dev-os/core';
import type {App, Action, StoreControls, StoreState} from './backend.js';
import {launchDesktopApp} from '@dev-os/services/apps';
import {registryApps, matchesApp, safeWebsite} from './registry.js';
import {storeAppIcon, StoreAppIcon} from './app-icon.js';
import {ExtensionsView} from './extensions-view.js';
import type {ExtensionStore} from '@dev-os/extensions';
import type {SettingsHost} from '@dev-os/core';
import {PackagesList} from './package-view.js';
import {UserPackageActions} from './user-package-actions.js';
import type {RegistryControls} from './registry-backend.js';
import type {InstalledPackage, PackageControls} from './package-backend.js';
const sections = ['Discover', 'Installed', 'Updates', 'Creative', 'Productivity', 'Internet', 'Media', 'Developer Tools'];
const collectionDescriptions: Record<string, string> = {'Developer Tools': 'Editors and tools for your next build.', Creative: 'A little inspiration for your next creation.', Productivity: 'Make room for a more productive day.', Internet: 'Explore, connect and find your way around the web.', Media: 'Bring your favourite sights and sounds together.'};
const navIcons: Record<string, string> = {Discover: 'view-grid-symbolic', Installed: 'folder-download-symbolic', Updates: 'view-refresh-symbolic', Packages: 'package-x-generic-symbolic', Extensions: 'application-x-addon-symbolic', Creative: 'applications-graphics-symbolic', Productivity: 'view-list-symbolic', Internet: 'web-browser-symbolic', Media: 'multimedia-player-symbolic', 'Developer Tools': 'utilities-terminal-symbolic'};
export function AppStoreView({controls, packages, registry, extensions, destination, launchCommand}: {controls: StoreControls; packages?: PackageControls; registry?: RegistryControls; extensions?: {store: ExtensionStore; preferences: SettingsHost}; destination?: {section: 'Discover' | 'Extensions'; revision: number}; launchCommand?(command: string): string | null}) {
    const contentScroll = useRef<Gtk.ScrolledWindow | null>(null);
    const [state, setState] = useState<StoreState | null>(null), [section, setSection] = useState<string>(destination?.section ?? 'Discover');
    const [query, setQuery] = useState(''), [selected, setSelected] = useState<App | null>(null), [confirmation, setConfirmation] = useState<Action | null>(null);
    const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [limit, setLimit] = useState(40);
    const [userPackages, setUserPackages] = useState<InstalledPackage[]>([]);
    useEffect(() => {
        // Wait for GTK to resize the new page before resetting its old scroll offset.
        let source = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {contentScroll.current?.get_vadjustment().set_value(0); source = 0; return GLib.SOURCE_REMOVE;});
        return () => {if (source) GLib.source_remove(source);};
    }, [section, selected?.id, query]);
    useEffect(() => {if (destination) {setSection(destination.section); setSelected(null); setConfirmation(null); setQuery('');}}, [destination?.revision]);
    const refreshUser = async () => {if (packages) setUserPackages(await packages.installed());};
    const request = async (action: Action, app?: App) => {
        setBusy(action === 'install' ? `Installing ${app?.name}…` : action === 'remove' ? `Removing ${app?.name}…` : action === 'update' ? `Updating ${app?.name}…` : action === 'browse' ? 'Refreshing the DevOs catalog…' : action === 'updates' ? 'Checking for updates…' : 'Working…'); setError(''); setNotice('');
        try {
            if (action === 'get') await refreshUser().catch(reason => setError(String(reason)));
            if (app?.registry || app?.userPackage) throw new Error('User applications are managed through dev.');
            const next = await controls.request(action, app?.id);
            setState(next);
            setConfirmation(null);
            if (action !== 'get') setNotice(action === 'install' ? `${app?.name} installed` : action === 'remove' ? `${app?.name} removed` : action === 'update' ? `${app?.name} updated` : action === 'updates' ? `${next.updates?.length ?? 0} updates available from DevOs` : 'DevOs catalog refreshed');
        } catch (reason) {setError(String(reason));} finally {setBusy('');}
    };
    useEffect(() => {void request('get');}, [controls]);
    const {apps, featured, installedCount, installedIds, selectedPackage, detailsInstalled} = useDataView<{apps: App[]; featured: App[]; installedCount: number; installedIds: string[]; selectedPackage?: InstalledPackage; detailsInstalled?: App}>('store', {state, packages: userPackages, registry, section, query, selected}, {apps: [], featured: [], installedCount: 0, installedIds: []}, [state, userPackages, registry, section, query, selected]);
    const openPage = (app: App) => {try {if (safeWebsite(app.website)) Gio.AppInfo.launch_default_for_uri(safeWebsite(app.website)!, null);} catch (reason) {setError(String(reason));}};
    const launch = (app: App) => {const desktop = Gio.AppInfo.get_all().find(item => item.get_id() === app.desktopId); if (!desktop) {setError('Application launcher is not installed.'); return;} void launchDesktopApp(desktop).catch(reason => setError(String(reason)));};
    const navigate = (name: string) => {
        if (packages && name !== 'Extensions') void refreshUser().catch(reason => setError(String(reason)));
        setSection(name); setSelected(null); setConfirmation(null); setLimit(40);
    };
    const openApp = (app: App) => {setSelected(app); setConfirmation(null); setNotice('');};
    const isInstalled = (app: App) => installedIds.includes(app.id) || !!app.userPackage;
    const navButton = (name: string) => <Button key={name} id={`app-store-tab-${name.toLowerCase()}`} className={section === name ? 'selected' : ''} sensitive={!busy} onClicked={() => navigate(name)}><Box spacing={11}><Image iconName={navIcons[name]} pixelSize={17}/><Label xalign={0} hexpand>{name}</Label>{name === 'Installed' && installedCount > 0 && <Label className="app-store-nav-count">{installedCount}</Label>}</Box></Button>;
    const isCollection = sections.slice(3).includes(section);

    return <Box className="app-store-body" orientation="vertical">
        <Box className="app-store-topbar" spacing={18}>
            <Box className="app-store-brand-mark" widthRequest={34} heightRequest={34} valign="center"><Image iconName="system-software-install-symbolic" pixelSize={20} expand/></Box>
            <Label className="app-store-brand">App Store</Label>
            <SearchEntry id="app-store-search" expand hexpand placeholder={section === 'Extensions' ? 'Search extensions' : 'Search apps, tools and ideas'} text={query} onChanged={widget => {setQuery(widget.get_text()); setLimit(40);}}/>
            <Button id="app-store-refresh" className="app-store-toolbar-action" tooltip="Refresh your apps" sensitive={!busy} onClicked={() => {if (section === 'Extensions' && extensions) void extensions.store.check(); else void request('get');}}><Image iconName="view-refresh-symbolic" pixelSize={18}/></Button>
        </Box>
        <Box expand vexpand>
            <Box className="app-store-sidebar" orientation="vertical" spacing={4} widthRequest={174} hexpand={false} ref={widget => {widget?.set_hexpand(false);}}>
                <Label className="app-store-nav-heading" xalign={0}>YOUR STORE</Label>
                {sections.slice(0, 3).map(navButton)}
                {packages && navButton('Packages')}
                {extensions && navButton('Extensions')}
                <Label className="app-store-nav-heading app-store-category-heading" xalign={0}>CATEGORIES</Label>
                {sections.slice(3).map(navButton)}
                <Box expand vexpand/>
                <Box className="app-store-sidebar-footer" orientation="vertical" spacing={7}><Label xalign={0} className="app-store-footer-title">A little more you.</Label><Label className="subtle" xalign={0}>Apps for your everyday.</Label><Box spacing={6}><Image iconName="utilities-terminal-symbolic" pixelSize={12}/><Label className="subtle" xalign={0}>Powered by dev</Label></Box></Box>
            </Box>
            <ScrolledWindow id="app-store-scroll" ref={contentScroll} expand hexpand vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER}><Box className="app-store-content" orientation="vertical" spacing={22}>
                {!selected && !['Packages', 'Extensions'].includes(section) && <Box className={isCollection ? 'app-store-collection-header' : ''} spacing={16} valign="center">{isCollection && <Box className="app-store-collection-mark" widthRequest={52} heightRequest={52} valign="center"><Image iconName={navIcons[section]} pixelSize={26} expand/></Box>}<Box orientation="vertical" spacing={7} hexpand><Label className="app-store-page-title" xalign={0}>{section === 'Discover' ? 'Discover' : section}</Label><Label className="subtle" xalign={0}>{query.trim() ? `Results for “${query.trim()}”` : section === 'Discover' ? 'Good tools for whatever comes next.' : section === 'Installed' ? 'Your apps, all in one place.' : section === 'Updates' ? 'Keep your favourite tools up to date.' : collectionDescriptions[section] || 'Find something that fits your day.'}</Label></Box><Label className="app-store-result-count" valign="center">{`${apps.length} ${apps.length === 1 ? 'app' : 'apps'}`}</Label></Box>}
                {section === 'Discover' && !selected && !query.trim() && <Box className="app-store-hero" spacing={18}>
                    <Box orientation="vertical" spacing={12} hexpand><Label className="app-store-eyebrow" xalign={0}>A DESKTOP THAT FEELS LIKE YOU</Label><Label className="app-store-hero-title" xalign={0}>{'Your next idea\nstarts here.'}</Label><Label className="app-store-hero-description" xalign={0} wrap maxWidthChars={39}>Write, browse and create. Make space for the tools you love.</Label><Button id="app-store-explore-tools" className="app-store-hero-action" halign="start" sensitive={!busy} onClicked={() => navigate('Developer Tools')}><Box spacing={12}><Label>Explore developer tools</Label><Image iconName="go-next-symbolic" pixelSize={14}/></Box></Button></Box>
                    <Box className="app-store-hero-art" spacing={12} valign="center">{featured.map((app, index) => <Box key={app.id} className={`app-store-hero-tile hero-tile-${index}`} widthRequest={76} heightRequest={86} marginTop={index === 1 ? 42 : 0} marginBottom={index === 1 ? 0 : 42} valign="center"><Image gicon={storeAppIcon(app)} pixelSize={48} expand/></Box>)}</Box>
                </Box>}
                {state?.message && !packages && section === 'Updates' && <Label className="app-store-notice" wrap xalign={0}>{state.message}</Label>}
                {state && !state.connected && section === 'Updates' && <Box className="app-store-card" orientation="vertical" spacing={10}><Label className="app-store-section" xalign={0}>Your DevOs repository</Label><Label wrap xalign={0}>The repository is being prepared. Native installation becomes available after signed packages are published and configured. Registry apps install separately for your user through dev.</Label></Box>}
                {error && section !== 'Extensions' && <Label id="app-store-error" className="error" wrap selectable xalign={0}>{error}</Label>}
                {notice && section !== 'Extensions' && <Label className="app-store-success" wrap xalign={0}>{notice}</Label>}
                {busy && section !== 'Extensions' && <Label id="app-store-busy" className="app-store-notice" wrap xalign={0}>{`${busy} Keep the store open until this operation finishes.`}</Label>}
                {section === 'Extensions' && extensions ? <ExtensionsView store={extensions.store} preferences={extensions.preferences} query={query}/> : section === 'Packages' && packages ? <PackagesList controls={packages} launch={launchCommand}/> : selected ? <Box orientation="vertical" spacing={18}>
                    <Button id="app-store-back" className="app-store-back" halign="start" sensitive={!busy} onClicked={() => {setSelected(null); setConfirmation(null);}}><Box spacing={8}><Image iconName="go-previous-symbolic" pixelSize={14}/><Label>Back to apps</Label></Box></Button>
                    <Box className="app-store-detail-hero" orientation="vertical" spacing={22}>
                        <Box spacing={22} valign="center">
                            <Box className="app-store-detail-icon" widthRequest={88} heightRequest={88} valign="center" hexpand={false} ref={widget => {widget?.set_hexpand(false);}}><StoreAppIcon app={selected} size={62}/></Box>
                            <Box orientation="vertical" spacing={8} hexpand><Label className="app-store-detail-title" xalign={0} wrap>{selected.name}</Label><Label className="app-store-detail-publisher" xalign={0}>{selected.registry?.publisher || selected.category || 'DevOs application'}</Label><Label className="app-store-detail-tagline" xalign={0} wrap maxWidthChars={65}>{selected.description || 'An application for your DevOs desktop.'}</Label></Box>
                        </Box>
                        {selected.registry || selected.userPackage ? <UserPackageActions key={selected.id} app={selected} packages={packages} registry={registry} installed={selectedPackage} onChanged={refreshUser} onBusy={setBusy} launch={launchCommand} website={safeWebsite(selected.website) ? () => openPage(selected) : undefined}/> : <Box className="app-store-detail-actions" spacing={10}>
                            {detailsInstalled ? <><Button id="app-store-open" className="app-store-primary app-store-install-button" sensitive={!busy && !!selected.desktopId} onClicked={() => launch(selected)}>Open</Button><Button id="app-store-update" sensitive={!busy && state?.available === true && state.connected && !!state.updates?.some(app => app.id === selected.id)} onClicked={() => setConfirmation('update')}>Update</Button><Button id="app-store-remove" sensitive={!busy && selected.removable !== false && state?.available === true && state.connected} onClicked={() => setConfirmation('remove')}>Remove…</Button></> : <Button id="app-store-install" className="app-store-primary app-store-install-button" sensitive={!busy && state?.available === true && state.connected} onClicked={() => setConfirmation('install')}>Install…</Button>}
                            {safeWebsite(selected.website) && <Button className="app-store-website-button" sensitive={!busy} onClicked={() => openPage(selected)}>Website</Button>}
                        </Box>}
                    </Box>
                    <Box className="app-store-facts" homogeneous spacing={0}>
                        {[[selected.registry ? 'DEVELOPER' : 'APPLICATION', selected.registry?.publisher || selected.name], ['CATEGORY', selected.category || 'Application'], ['PLATFORM', selected.registry ? 'Linux · ARM64' : 'DevOs'], ['INSTALLATION', selected.registry || selected.userPackage ? 'Your user account' : 'System-wide']].map(([label, value]) => <Box key={label} className="app-store-fact" orientation="vertical" spacing={8} hexpand><Label className="app-store-fact-label" xalign={0}>{label}</Label><Label className="app-store-fact-value" xalign={0} wrap>{value}</Label></Box>)}
                    </Box>
                    {selected.registry && <Box className="app-store-detail-body" spacing={20}>
                        <Box className="app-store-about" orientation="vertical" spacing={16} hexpand>
                            <Label className="app-store-section" xalign={0}>About this app</Label>
                            <Label className="app-store-about-description" xalign={0} wrap maxWidthChars={55}>{selected.description}</Label>
                            <Box spacing={6}>{selected.registry.tags.slice(0, 4).map(tag => <Label key={tag} className="app-store-tag">{tag}</Label>)}</Box>
                            <Expander className="app-store-notes" label="Read app notes"><Label id="app-store-readme" className="subtle" xalign={0} wrap selectable maxWidthChars={65}>{selected.registry.readme}</Label></Expander>
                            <Expander className="app-store-notes" label="Technical details"><Box orientation="vertical" spacing={8}><Label className="subtle" xalign={0} wrap selectable>{`Registry ID: ${selected.registry.id}\nLicense: ${selected.registry.license}${selectedPackage ? `\nInstalled package: ${selectedPackage.id}` : ''}`}</Label><Label className="subtle" xalign={0} wrap selectable maxWidthChars={65}>{selected.registry.note}</Label></Box></Expander>
                        </Box>
                        <Box className="app-store-compatibility" orientation="vertical" spacing={12} widthRequest={230} hexpand={false} ref={widget => {widget?.set_hexpand(false);}} valign="start">
                            <Box spacing={8}><Image iconName="dialog-information-symbolic" pixelSize={16}/><Label className="app-store-compatibility-title" xalign={0}>Compatibility</Label></Box>
                            <Label className={selected.registry.compatibility === 'verified' ? 'app-store-verified-status' : 'app-store-testing-status'} xalign={0} halign="start">{selected.registry.compatibility === 'verified' ? 'Verified on DevOs' : 'Not yet tested on DevOs'}</Label>
                            <Label className="app-store-compatibility-description" xalign={0} wrap maxWidthChars={29}>{selected.registry.compatibility === 'verified' ? 'Compatibility has been verified for the target DevOs image.' : 'This app may need additional libraries to run. You can review its package before installing.'}</Label>
                        </Box>
                    </Box>}
                    {confirmation && !selected.registry && <Box className="app-store-confirm" orientation="vertical" spacing={12}><Label className="app-store-section" xalign={0}>{`${confirmation === 'remove' ? 'Remove' : confirmation === 'update' ? 'Update' : 'Install'} ${selected.name}?`}</Label><Label wrap xalign={0}>{confirmation === 'remove' ? 'Remove this native application from the DevOs system. Administrator authorization is required.' : confirmation === 'update' ? 'Download and apply the available DevOs package update. Administrator authorization is required.' : 'Install this native application and required dependencies from the signed DevOs repository. Administrator authorization is required.'}</Label><Box spacing={10}><Button id="app-store-cancel" sensitive={!busy} onClicked={() => setConfirmation(null)}>Cancel</Button><Button id="app-store-confirm" className="app-store-primary" sensitive={!busy} onClicked={() => {void request(confirmation, selected);}}>{confirmation === 'remove' ? 'Remove app' : confirmation === 'update' ? 'Update app' : 'Install app'}</Button></Box></Box>}
                </Box> : <Box orientation="vertical" spacing={14}>
                    {!isCollection && <Box spacing={10}><Box orientation="vertical" spacing={5} hexpand><Label className="app-store-section" xalign={0}>{section === 'Discover' ? query.trim() ? 'Search results' : 'A few good additions' : section === 'Installed' ? 'Ready when you are' : section === 'Updates' ? 'Available updates' : 'Explore the collection'}</Label>{section === 'Discover' && !query.trim() && <Label className="subtle" xalign={0}>A fresh perspective. A new favourite. Find yours.</Label>}</Box>{section === 'Discover' && state?.connected && <Button id="app-store-browse" className="app-store-text-action" sensitive={!busy} onClicked={() => {void request('browse');}}>Refresh catalog</Button>}{section === 'Updates' && <Button id="app-store-check-updates" sensitive={!busy && state?.connected === true} onClicked={() => {void request('updates');}}>Check for updates</Button>}</Box>}
                    <FlowBox className="app-store-grid" valign="start" vexpand={false} ref={widget => {widget?.set_homogeneous(true); widget?.set_vexpand(false);}} selectionMode={Gtk.SelectionMode.NONE} minChildrenPerLine={1} maxChildrenPerLine={3} rowSpacing={14} columnSpacing={14}>
                        {apps.slice(0, limit).map(app => <FlowBoxChild key={app.id}><Button id={`app-store-app-${app.id}`} className="app-store-app" sensitive={!busy} onClicked={() => openApp(app)}><Box orientation="vertical" spacing={13} widthRequest={196} heightRequest={164}>
                            <Box spacing={12}><Box className={`app-store-icon category-${(app.category || 'other').toLowerCase().replaceAll(' ', '-')}`} widthRequest={58} heightRequest={58}><StoreAppIcon app={app} size={42}/></Box><Box hexpand/><Image className="app-store-card-arrow" iconName="go-next-symbolic" pixelSize={15} valign="start"/></Box>
                            <Box orientation="vertical" spacing={7} heightRequest={58} hexpand><Label className="app-store-app-name" xalign={0} wrap maxWidthChars={24}>{app.name}</Label><Label className="app-store-app-description" xalign={0} wrap maxWidthChars={28}>{app.description || app.id}</Label></Box>
                            <Box spacing={8} marginTop={8}><Label className="app-store-app-category" xalign={0} hexpand>{app.category || 'Application'}</Label><Label className={isInstalled(app) ? 'app-store-chip app-store-installed-chip' : 'app-store-chip'}>{isInstalled(app) ? 'Installed' : app.registry ? 'dev' : 'DevOs'}</Label></Box>
                        </Box></Button></FlowBoxChild>)}
                    </FlowBox>
                    {!apps.length && <Box className="app-store-empty" orientation="vertical" spacing={12}><Image iconName="system-search-symbolic" pixelSize={36}/><Label wrap>{query.trim() ? 'No apps match your search.' : section === 'Updates' && !state?.updates ? 'Check for app updates when you are ready.' : section === 'Installed' && !query ? 'Your installed apps will appear here.' : section === 'Updates' ? 'Your native apps are up to date.' : 'No applications in this category yet.'}</Label></Box>}
                    {apps.length > limit && <Button sensitive={!busy} onClicked={() => setLimit(value => value + 40)}>{`Show more · ${apps.length} apps`}</Button>}
                </Box>}
            </Box></ScrolledWindow>
        </Box>
    </Box>;
}
