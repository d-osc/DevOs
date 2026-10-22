import {Gtk, React, Box, Label, Button, Image, ScrolledWindow, useState, useEffect, useRef} from '@dev-os/core';
import {Disks, type Disk, type DiskControls, type DiskState} from './disks.js';
const capacity = (bytes: number) => bytes >= 1099511627776 ? `${(bytes / 1099511627776).toFixed(2)} TiB` : bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GiB` : `${(bytes / 1048576).toFixed(1)} MiB`;
const descendants = (disk: Disk): Disk[] => [disk, ...(disk.children ?? []).flatMap(descendants)];
export function DiskManagerSettings({openManager, controls}: {openManager: () => void; controls?: DiskControls}) {
    const [{backend, owned}] = useState(() => ({backend: controls ?? new Disks(), owned: !controls}));
    const [state, setState] = useState<DiskState | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState('');
    const alive = useRef(true);
    const refresh = async () => {
        setBusy(true); setError('');
        try {const next = await backend.request('get'); if (alive.current) setState(next);}
        catch (reason) {if (alive.current) setError(String(reason));}
        finally {if (alive.current) setBusy(false);}
    };
    useEffect(() => {alive.current = true; void refresh(); return () => {alive.current = false; if (owned) backend.destroy();};}, [backend, owned]);
    const rows = state?.devices.flatMap(descendants) ?? [];
    const partitions = new Set(rows.filter(item => item.type === 'part').map(item => item.path)).size;
    const mounted = new Set(rows.filter(item => (item.mountpoints ?? []).some(point => point && point !== '[SWAP]')).map(item => item.path)).size;
    return <Box className="settings-content disk-manager-settings" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={14}>
            <Label className="settings-eyebrow" xalign={0}>EXTENSIONS / DISK MANAGER</Label>
            <Box spacing={14}><Box className="settings-page-icon" widthRequest={48} heightRequest={48} valign="center"><Image iconName="drive-harddisk-symbolic" pixelSize={26} expand/></Box>
                <Box orientation="vertical" spacing={5} expand><Label className="heading" xalign={0}>Disk Manager</Label><Label className="settings-description" wrap xalign={0}>Storage information at a glance.</Label></Box>
                <Button id="disk-settings-refresh" sensitive={!busy} valign="center" onClicked={() => {void refresh();}}>Refresh</Button>
            </Box>
        </Box>
        <ScrolledWindow expand fill hscrollbarPolicy={Gtk.PolicyType.NEVER}><Box className="settings-form" orientation="vertical" spacing={16}>
            <Box className="settings-card disk-settings-hero" orientation="vertical" spacing={14}>
                <Box spacing={10}><Label className="section-heading" expand xalign={0}>Your storage</Label><Label className="settings-badge">READ ONLY</Label></Box>
                <Label className="settings-description" wrap xalign={0}>Inspect disks, partitions, filesystems and mount points. Viewing storage does not change your disks or require administrator access.</Label>
                <Button id="disk-settings-open" className="settings-primary" halign="start" onClicked={openManager}>Open Disk Manager</Button>
            </Box>
            <Box spacing={12}>{[['Devices', state?.devices.length], ['Partitions', partitions], ['Mounted volumes', mounted]].map(([title, count]) => <Box key={String(title)} className="settings-card" orientation="vertical" spacing={8} expand hexpand><Label className="settings-description" xalign={0}>{String(title)}</Label><Label className="heading" xalign={0}>{state ? String(count ?? 0) : '—'}</Label></Box>)}</Box>
            {state?.wsl && <Box className="settings-card" orientation="vertical" spacing={10}><Label className="section-heading" xalign={0}>WSL storage</Label><Label id="disk-settings-wsl" className="settings-description" wrap xalign={0}>This session shows Linux virtual disks and explicitly attached block devices. Windows drive mounts such as C: do not expose their physical disk here.</Label></Box>}
            <Box className="settings-card" orientation="vertical" spacing={14}>
                <Label className="section-heading" xalign={0}>Detected devices</Label>
                {state?.devices.map(disk => <Box key={disk.path} id={`disk-settings-device-${disk.name}`} className="disk-settings-device" spacing={14}>
                    <Image iconName={disk.tran === 'usb' ? 'drive-removable-media-symbolic' : 'drive-harddisk-symbolic'} pixelSize={24}/>
                    <Box orientation="vertical" spacing={6} expand><Label xalign={0} wrap>{disk.model?.trim() || disk.name}</Label><Label className="settings-description" xalign={0} wrap>{`${disk.path} · ${capacity(disk.size)} · ${disk.pttype?.toUpperCase() || 'No partition table'}`}</Label><Label className="settings-description" xalign={0} wrap>{disk.ro ? 'Read-only device' : descendants(disk).some(item => (item.mountpoints ?? []).some(Boolean)) ? 'In use' : 'Not mounted'}</Label></Box>
                </Box>)}
                {state && !state.devices.length && <Label id="disk-settings-empty" className="settings-description" wrap xalign={0}>No block devices were found in this session.</Label>}
                {!state && <Label className="settings-description" xalign={0}>{busy ? 'Reading storage information…' : 'Storage information is unavailable.'}</Label>}
            </Box>
            <Box className="settings-card" orientation="vertical" spacing={10}><Label className="section-heading" xalign={0}>Available features</Label><Label className="settings-description" wrap xalign={0}>Disk Manager displays capacity, filesystem type, labels, UUIDs and mount points. Creating, deleting, formatting and resizing partitions are currently unavailable.</Label></Box>
            {error && <Label id="disk-settings-error" className="error" wrap selectable xalign={0}>{error}</Label>}
        </Box></ScrolledWindow>
        <Box className="settings-action-bar" spacing={10}><Image iconName={busy ? 'view-refresh-symbolic' : 'drive-harddisk-symbolic'} pixelSize={16}/><Label className="settings-description" expand wrap xalign={0}>{busy ? 'Reading disks…' : error ? 'Unable to refresh disk information. Try Refresh again.' : 'Disk information is read only.'}</Label></Box>
    </Box>;
}
