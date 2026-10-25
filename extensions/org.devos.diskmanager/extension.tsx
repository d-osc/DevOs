import {Gtk, React, Box, Label, Button, Image, ScrolledWindow, DrawingArea, createRoot, mountWindowHeader, useState, useEffect, activePalette, rgbOf, type UIExtension} from '@dev-os/core';
import {Disks, type Disk, type DiskControls, type DiskState} from './disks.js';
import {DiskManagerSettings} from './settings.js';
const size = (bytes: number) => bytes >= 1099511627776 ? `${(bytes / 1099511627776).toFixed(2)} TiB` : bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GiB` : `${(bytes / 1048576).toFixed(1)} MiB`;
export const flatten = (disk: Disk): Disk[] => [disk, ...(disk.children ?? []).flatMap(flatten)];
function Map({disk}: {disk: Disk}) {
    const parts = disk.children?.length ? disk.children : [disk];
    return <DrawingArea heightRequest={70} hexpand onDraw={(widget, cr) => {
        const width = widget.get_allocated_width(), height = widget.get_allocated_height(); let offset = 0;
        for (const [index, part] of parts.entries()) {
            const extent = width * part.size / Math.max(disk.size, parts.reduce((sum, item) => sum + item.size, 0), 1);
            const p = activePalette(), colors = [p.green, p.blue, p.purple, p.orange].map(rgbOf), color = colors[index % colors.length]!;
            cr.setSourceRGB(...color as [number, number, number]); cr.rectangle(offset, 0, Math.max(1, extent - 2), height); cr.fill(); offset += extent;
        }
        cr.setSourceRGBA(...rgbOf(activePalette().fg), .2); cr.rectangle(offset, 0, Math.max(0, width - offset), height); cr.fill(); return false;
    }}/>;
}
export function DiskManager({controls}: {controls: DiskControls}) {
    const [state, setState] = useState<DiskState | null>(null), [selected, setSelected] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const refresh = async () => {setBusy(true); try {setState(await controls.request('get')); setError('');} catch (reason) {setError(String(reason));} finally {setBusy(false);}};
    useEffect(() => {let alive = true; void controls.request('get').then(data => {if (alive) setState(data);}).catch(reason => {if (alive) setError(String(reason));}); return () => {alive = false;};}, [controls]);
    const disk = state?.devices.find(item => item.path === selected) ?? state?.devices[0];
    return <Box className="disk-manager-body" orientation="vertical" spacing={16}>
        <Box spacing={12}><Box orientation="vertical" expand><Label className="task-title" xalign={0}>Disk Manager</Label><Label className="subtle" xalign={0}>Storage and partitions</Label></Box><Button id="disks-refresh" sensitive={!busy} onClicked={() => {void refresh();}}>Refresh</Button></Box>
        {state?.wsl && <Label className="disk-notice" wrap xalign={0}>WSL shows Linux virtual disks and explicitly attached devices. Windows drives such as C: are not physical disks in this list.</Label>}
        <Box expand vexpand spacing={20}>
            <ScrolledWindow widthRequest={230} hscrollbarPolicy={Gtk.PolicyType.NEVER}><Box orientation="vertical" spacing={8}>{state?.devices.map(item => <Button key={item.path} className={`disk-device${disk?.path === item.path ? ' selected' : ''}`} onClicked={() => setSelected(item.path)}><Box spacing={10}><Image iconName={item.tran === 'usb' ? 'drive-removable-media-symbolic' : 'drive-harddisk-symbolic'} pixelSize={24}/><Box orientation="vertical" spacing={5}><Label xalign={0}>{item.path}</Label><Label className="subtle" xalign={0}>{size(item.size)}</Label></Box></Box></Button>)}</Box></ScrolledWindow>
            <ScrolledWindow expand hexpand vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER}><Box orientation="vertical" spacing={16}>
                {disk ? <Box orientation="vertical" spacing={16}>
                    <Box className="disk-summary" orientation="vertical" spacing={8}><Label className="disk-name" xalign={0}>{disk.model?.trim() || disk.name}</Label><Label className="subtle" wrap xalign={0}>{`${disk.path} · ${size(disk.size)} · ${disk.pttype?.toUpperCase() || 'No partition table'}${disk.ro ? ' · Read only' : ''}`}</Label></Box>
                    <Map disk={disk}/><Label className="subtle" xalign={0} wrap>Capacity overview · relative partition sizes, not exact sector boundaries.</Label>
                    {flatten(disk).map(part => <Box key={part.path} className="disk-partition" orientation="vertical" spacing={6}><Box spacing={12}><Label expand xalign={0}>{part.path}</Label><Label>{size(part.size)}</Label></Box><Label className="subtle" wrap xalign={0}>{`${part.fstype || part.type} ${part.label ? '· ' + part.label : ''} · ${(part.mountpoints ?? []).filter(Boolean).join(', ') || 'Not mounted'}`}</Label>{part.fsused !== null && part.fsavail !== null && <Label className="subtle" xalign={0}>{`${size(part.fsused)} used · ${size(part.fsavail)} available`}</Label>}{part.uuid && <Label className="subtle" selectable wrap xalign={0}>{`UUID: ${part.uuid}`}</Label>}</Box>)}
                </Box> : <Label wrap>{state ? 'No block devices found' : 'Reading disks…'}</Label>}
            </Box></ScrolledWindow>
        </Box>
        <Label className="subtle" wrap xalign={0}>{busy ? "Refreshing disks..." : "Disk information - read only"}</Label>
        {error && <Label className="error" wrap xalign={0}>{error}</Label>}
    </Box>;
}
export default {id: 'org.devos.diskmanager', activate(context) {
    let window: Gtk.ApplicationWindow | undefined;
    context.registerSettingsPage?.('org.devos.diskmanager', () => <DiskManagerSettings openManager={() => context.invoke('disk-manager')}/>);
    context.registerCommand('disk-manager', () => {
        context.invoke('launcher.hide'); if (window) {window.present(); return;}
        window = new Gtk.ApplicationWindow({application: context.application, title: 'Disk Manager', default_width: 1040, default_height: 720}); window.name = 'disk-manager';
        const controls = new Disks(), root = createRoot(window), header = mountWindowHeader(window, {title: 'Disk Manager', iconName: 'dev-os-disk-manager-symbolic', windowIconName: 'dev-os-disk-manager'});
        root.render(<DiskManager controls={controls}/>); window.connect('destroy', () => {root.unmount(); header.destroy(); controls.destroy(); window = undefined;}); window.show_all(); window.present();
    }); return () => window?.destroy();
}} satisfies UIExtension;
