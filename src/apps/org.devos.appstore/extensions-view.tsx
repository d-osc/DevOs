import {useDataView} from '../../use-data-view.js';
import type {StoreItem} from '../../../packages/extensions/store.js';
import {
    React, Gtk, Gio, GLib, Box, Label, Button, Expander, FlowBox, FlowBoxChild,
    Image, Switch, useState,
    useEffect, type SettingsHost
} from '@dev-os/core';
import type {ExtensionStore} from '@dev-os/extensions';
import {registryExtensions, matchesExtension, matchingExtensionRelease, type RegistryExtension} from './registry-extensions.js';

function ExtensionIcon({entry, size}: {entry: RegistryExtension; size: number}) {
    return <Image gicon={entry.iconBase64 ? Gio.BytesIcon.new(new GLib.Bytes(GLib.base64_decode(entry.iconBase64))) : undefined} iconName="application-x-addon-symbolic" pixelSize={size} expand/>;
}

export function ExtensionsView({store, preferences, query}: {store: ExtensionStore; preferences: SettingsHost; query?: string}) {
    const [revision, refresh] = useState(0), [error, setError] = useState('');
    const [confirm, setConfirm] = useState('');
    const [selected, setSelected] = useState<RegistryExtension | null>(null);
    useEffect(() => store.subscribe(() => refresh(value => value + 1)), [store]);
    useEffect(() => preferences.subscribe(() => refresh(value => value + 1)), [preferences]);
    const {catalog, results: entries, items, selectedItem} = useDataView<{catalog: RegistryExtension[]; results: RegistryExtension[]; items: StoreItem[]; selectedItem?: StoreItem}>('extensions', {items: store.items, selected, query: query ?? ''}, {catalog: [], results: [], items: []}, [store.items, selected, query, revision]);
    useEffect(() => {setSelected(null); setConfirm('');}, [query]);
    const check = async (repository: string, expectedId: string) => {
        setError('');
        if (store.items.some(item => item.repository.toLowerCase() === repository.toLowerCase())) await store.check(repository);
        else await store.connect(repository);
        const item = store.items.find(item => item.repository.toLowerCase() === repository.toLowerCase());
        if (item?.release && !matchingExtensionRelease(expectedId, item.release.manifest.id)) setError('The release does not match the extension selected from the catalog.');
    };
    return <Box className="app-store-extensions" orientation="vertical" spacing={20} hexpand>
        {!selected && <Box className="app-store-collection-header" spacing={16}>
            <Box className="app-store-collection-mark" widthRequest={52} heightRequest={52} valign="center"><Image iconName="application-x-addon-symbolic" pixelSize={26} expand/></Box>
            <Box orientation="vertical" spacing={7} hexpand><Label className="app-store-page-title" xalign={0}>Extensions</Label><Label className="subtle" xalign={0} wrap>Make your desktop your own with extensions from the DevOs catalog.</Label></Box>
            <Label className="app-store-result-count" valign="center">{`${entries.length} ${entries.length === 1 ? 'extension' : 'extensions'}`}</Label>
        </Box>}
        <Box orientation="vertical" spacing={16}>
                {selected ? <Box id="store-extension-detail" orientation="vertical" spacing={22}>
                    <Button id="store-extension-back" className="app-store-back" halign="start" sensitive={!store.busy} onClicked={() => {setSelected(null); setConfirm(''); setError('');}}><Box spacing={8}><Image iconName="go-previous-symbolic" pixelSize={14}/><Label>Back to extensions</Label></Box></Button>
                    <Box className="app-store-detail-hero" orientation="vertical" spacing={22}>
                        <Box spacing={22} valign="center"><Box className="app-store-detail-icon" widthRequest={88} heightRequest={88} hexpand={false}><ExtensionIcon entry={selected} size={62}/></Box>
                            <Box orientation="vertical" spacing={8} hexpand><Label className="app-store-detail-title" xalign={0} wrap>{selected.name}</Label><Label className="app-store-detail-publisher" xalign={0}>{selected.publisher}</Label><Label className="app-store-detail-tagline" xalign={0} wrap maxWidthChars={65}>{selected.description}</Label></Box></Box>
                        <Box className="app-store-detail-actions" spacing={12}><Button id={`store-catalog-check-${selected.id}`} className="app-store-primary app-store-install-button" sensitive={!store.busy && !!selected.repository && !selectedItem?.installed} onClicked={() => {if (selected.repository) void check(selected.repository, selected.id);}}>{selectedItem?.installed ? 'Installed' : selected.repository ? 'Check availability' : 'Coming soon'}</Button><Label className="subtle" xalign={0} wrap>{selected.repository ? 'Personalize your desktop, for your account.' : 'Available here when the first release is ready.'}</Label></Box>
                    </Box>
                    <Box className="app-store-facts" homogeneous spacing={0}>{[['DEVELOPER', selected.publisher], ['VERSION', selected.version], ['PLATFORM', 'DevOs · ARM64'], ['TYPE', 'Extension']].map(([label, value]) => <Box key={label} className="app-store-fact" orientation="vertical" spacing={8} hexpand><Label className="app-store-fact-label" xalign={0}>{label}</Label><Label className="app-store-fact-value" xalign={0} wrap>{value}</Label></Box>)}</Box>
                    <Box className="app-store-detail-body" spacing={20}><Box className="app-store-about" orientation="vertical" spacing={16} hexpand><Label className="app-store-section" xalign={0}>About this extension</Label><Label className="app-store-about-description" xalign={0} wrap maxWidthChars={55}>{selected.description}</Label><Box spacing={6}>{selected.tags.slice(0, 4).map(tag => <Label key={tag} className="app-store-tag">{tag}</Label>)}</Box>
                        {selected.readme && <Expander className="app-store-notes" label="Read extension notes"><Label className="subtle" xalign={0} wrap selectable maxWidthChars={65}>{selected.readme}</Label></Expander>}
                        <Expander className="app-store-notes" label="Technical details"><Label className="subtle" xalign={0} selectable wrap>{`Extension ID: ${selected.id}\nLicense: ${selected.license}`}</Label></Expander></Box>
                        <Box className="app-store-compatibility" orientation="vertical" spacing={12} widthRequest={230} hexpand={false} valign="start"><Box spacing={8}><Image iconName="application-x-addon-symbolic" pixelSize={16}/><Label className="app-store-compatibility-title">Made for your desktop</Label></Box><Label className="app-store-testing-status" xalign={0} halign="start">{selected.repository ? 'Release check required' : 'Coming soon'}</Label><Label className="app-store-compatibility-description" xalign={0} wrap maxWidthChars={29}>{selected.repository ? 'Check the latest release before installing. Extensions can be enabled or disabled for your next session.' : 'This extension is in the catalog. Installation becomes available after it is published.'}</Label></Box>
                    </Box>
                </Box> : <Box id="store-registry-extensions" orientation="vertical" spacing={14}>
                    <Box orientation="vertical" spacing={5}><Label className="app-store-section" xalign={0}>{query?.trim() ? 'Search results' : 'A little more you'}</Label><Label className="subtle" xalign={0}>Small additions for the way you work.</Label></Box>
                    <FlowBox className="app-store-grid app-store-extension-grid" valign="start" halign="start" vexpand={false} selectionMode={Gtk.SelectionMode.NONE} minChildrenPerLine={1} maxChildrenPerLine={3} rowSpacing={14} columnSpacing={14} ref={widget => {widget?.set_homogeneous(true); widget?.set_vexpand(false);}}>
                        {entries.map(entry => <FlowBoxChild key={entry.id}><Button id={`store-registry-${entry.id}`} className="app-store-app" sensitive={!store.busy} onClicked={() => {setSelected(entry); setError('');}}><Box orientation="vertical" spacing={13} widthRequest={230} heightRequest={164}>
                            <Box spacing={12}><Box className="app-store-icon category-productivity" widthRequest={58} heightRequest={58}><ExtensionIcon entry={entry} size={42}/></Box><Box hexpand/><Image className="app-store-card-arrow" iconName="go-next-symbolic" pixelSize={15} valign="start"/></Box>
                            <Box orientation="vertical" spacing={7} heightRequest={58} hexpand><Label className="app-store-app-name" xalign={0} wrap maxWidthChars={24}>{entry.name}</Label><Label className="app-store-app-description" xalign={0} wrap maxWidthChars={28}>{entry.description}</Label></Box>
                            <Box spacing={8} marginTop={8}><Label className="app-store-app-category" xalign={0} hexpand>Extension</Label><Label className="app-store-chip">{entry.repository ? 'Available' : 'Coming soon'}</Label></Box>
                        </Box></Button></FlowBoxChild>)}
                    </FlowBox>
                    {!entries.length && <Box className="app-store-empty" orientation="vertical" spacing={12}><Image iconName="system-search-symbolic" pixelSize={36}/><Label wrap>{catalog.length ? 'No extensions match your search.' : 'New extensions will appear here when the catalog is updated.'}</Label></Box>}
                </Box>}
                {error && <Label className="error" xalign={0} wrap>{error}</Label>}
                {items.length > 0 && <Box spacing={10}><Label className="app-store-section" xalign={0} hexpand>{selected ? 'Manage extension' : 'Your extensions'}</Label><Button id="store-check-all" sensitive={!store.busy} onClicked={() => { void store.check(); }}>Check for updates</Button></Box>}
                {store.error && <Label className="error" xalign={0} wrap>{store.error}</Label>}
                {items.map(item => {
                    const manifest = item.release?.manifest;
                    const installed = item.installed;
                    const info = preferences.list().find(info => info.manifest.id === installed?.id);
                    const expected = catalog.find(entry => entry.repository?.toLowerCase() === item.repository.toLowerCase());
                    const mismatch = !!expected && !!manifest && !matchingExtensionRelease(expected.id, manifest.id);
                    return <Box key={item.repository} className="app-store-card app-store-extension-card" orientation="vertical" spacing={12}>
                        <Box spacing={12}><Box className="store-extension-icon" widthRequest={40} heightRequest={40}><Image iconName="application-x-addon-symbolic" pixelSize={23} expand /></Box>
                            <Box orientation="vertical" spacing={4} expand><Label className="app-store-section" xalign={0}>{manifest?.name ?? installed?.id ?? item.repository}</Label><Label className="subtle" xalign={0}>{item.repository}</Label></Box>
                            <Label className={`app-store-chip ${installed ? 'app-store-installed-chip' : ''}`} valign="start">{installed ? 'INSTALLED' : 'CONNECTED'}</Label>
                        </Box>
                        {manifest && <Label xalign={0} wrap maxWidthChars={65}>{manifest.description}</Label>}
                        <Label className="subtle" xalign={0} wrap>{`${installed ? `Installed ${installed.version} · ` : ''}${item.release ? `Latest ${item.release.version} · ${(item.release.size / 1024).toFixed(0)} KB · ` : ''}${item.message}`}</Label>
                        {item.error && <Label className="error" xalign={0} wrap>{item.error}</Label>}
                        {mismatch && <Label className="error" xalign={0} wrap>This release does not match the catalog extension and cannot be installed.</Label>}
                        <Box spacing={8}>
                            {store.canInstall(item) && !mismatch && <Button id={`store-install-${item.repository}`} className="app-store-primary" sensitive={!store.busy} onClicked={() => { void store.install(item.repository); }}>{installed ? 'Update' : 'Install'}</Button>}
                            <Button sensitive={!store.busy} onClicked={() => { void store.check(item.repository); }}>Check release</Button>
                            {installed?.previous && <Button sensitive={!store.busy} onClicked={() => { void store.rollback(item.repository); }}>Rollback</Button>}
                            <Button sensitive={!store.busy} onClicked={() => store.disconnect(item.repository)}>Disconnect</Button>
                        </Box>
                        {installed && <Box spacing={12}><Label className="subtle" xalign={0} expand>Enabled at next session</Label>
                            <Switch id={`store-enable-${installed.id}`} sensitive={!store.busy && !info?.error} active={info?.state.enabled === true} onActiveChanged={button => {
                                try { if (info) preferences.update(installed.id, button.active, info.state.values); } catch { refresh(value => value + 1); }
                            }} />
                            <Button sensitive={!store.busy} onClicked={() => { if (confirm === item.repository) { void store.uninstall(item.repository); setConfirm(''); } else setConfirm(item.repository); }}>{confirm === item.repository ? 'Confirm remove' : 'Remove'}</Button>
                            {confirm === item.repository && <Button onClicked={() => setConfirm('')}>Cancel</Button>}
                        </Box>}
                        {item.release?.notes && <Label className="subtle" xalign={0} wrap maxWidthChars={65}>{item.release.notes.slice(0, 800)}</Label>}
                    </Box>;
                })}
        </Box>
        {store.busy && <Box className="app-store-extension-status" spacing={10}><Image iconName="view-refresh-symbolic" pixelSize={16}/><Label id="store-status" className="subtle" xalign={0} wrap expand>{store.message}</Label></Box>}
    </Box>;
}
