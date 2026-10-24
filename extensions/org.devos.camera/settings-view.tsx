import {React, Gtk, Gio, GLib, Box, Label, Button, Image, ScrolledWindow, useState, useEffect, useRef} from '@dev-os/core';

async function inspectCameras(): Promise<string[]> {
    const {devices} = await import('./capture.js');
    return devices('camera').map(device => device.title);
}

export function CameraSettings({open, inspect = inspectCameras}: {open(): void; inspect?: () => Promise<string[]>}) {
    const [cameras, setCameras] = useState<string[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
    const alive = useRef(true), working = useRef(false);
    const refresh = async () => {
        if (working.current) return;
        working.current = true; setLoading(true); setError('');
        try {const found = await inspect(); if (alive.current) setCameras(found);}
        catch (reason) {if (alive.current) {setCameras([]); setError(String(reason));}}
        finally {working.current = false; if (alive.current) setLoading(false);}
    };
    useEffect(() => {alive.current = true; void refresh(); return () => {alive.current = false;};}, [inspect]);
    const photos = () => {
        try {
            const directory = GLib.build_filenamev([GLib.get_home_dir(), 'Pictures', 'Camera']);
            if (GLib.mkdir_with_parents(directory, 0o700) !== 0) throw new Error('Could not open the photos folder.');
            Gio.AppInfo.launch_default_for_uri(Gio.File.new_for_path(directory).get_uri(), null);
        } catch (reason) {setError(String(reason));}
    };
    return <Box className="settings-content camera-settings-page" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={6}>
            <Label className="settings-eyebrow" xalign={0}>CAPTURE / CAMERA &amp; PHOTOS</Label>
            <Label className="heading" xalign={0}>Camera</Label>
            <Label className="settings-description" xalign={0} wrap>A clear view, whenever you need it.</Label>
        </Box>
        <ScrolledWindow expand fill minContentHeight={240} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="settings-form" orientation="vertical" spacing={22}>
                <Box className="camera-settings-hero" spacing={20}>
                    <Box className="camera-settings-emblem" widthRequest={76} heightRequest={76} valign="center"><Image iconName="camera-photo-symbolic" pixelSize={36} expand /></Box>
                    <Box orientation="vertical" spacing={8} expand valign="center"><Label className="camera-settings-title" xalign={0}>A new perspective.</Label><Label className="settings-description" wrap xalign={0}>Check your cameras, open a live preview and keep your favorite moments.</Label><Label className="camera-settings-privacy" wrap xalign={0}>Your camera stays off while you browse settings.</Label></Box>
                </Box>
                <Box spacing={12}><Box orientation="vertical" spacing={4} expand><Label className="section-heading" xalign={0}>Connected cameras</Label><Label className="settings-description" xalign={0} wrap>Devices available to the Camera app.</Label></Box><Button id="camera-settings-refresh" sensitive={!loading} tooltip="Refresh cameras" onClicked={() => {void refresh();}}><Image iconName="view-refresh-symbolic" pixelSize={16} /></Button></Box>
                {error && <Label id="camera-settings-error" className="settings-error-banner" xalign={0} wrap>{error}</Label>}
                <Box className="settings-card camera-devices-card" orientation="vertical" spacing={16}>
                    {loading ? <Label className="settings-description" xalign={0}>Finding cameras…</Label> : cameras.length ? cameras.map((name, index) => <Box key={index} className="camera-device-row" spacing={14}><Box className="camera-device-icon" widthRequest={42} heightRequest={42}><Image iconName="camera-photo-symbolic" pixelSize={23} expand /></Box><Box orientation="vertical" spacing={5} expand valign="center"><Label className="settings-field-title" xalign={0} wrap>{name}</Label><Label className="settings-description" xalign={0}>Detected · preview is off</Label></Box></Box>) : <Box orientation="vertical" spacing={10} className="camera-settings-empty"><Image iconName="camera-disabled-symbolic" pixelSize={32} /><Label className="section-heading">No camera detected</Label><Label className="settings-description" wrap>Connect a supported camera, then refresh. Built-in cameras may need additional Linux hardware support.</Label></Box>}
                </Box>
                <Box className="settings-card camera-launch-card" orientation="vertical" spacing={16}>
                    <Box spacing={12}><Image iconName="view-reveal-symbolic" pixelSize={22} /><Box orientation="vertical" spacing={5} expand><Label className="section-heading" xalign={0}>See it before you capture it</Label><Label className="settings-description" xalign={0} wrap>Choose a camera and start the preview in the Camera app.</Label></Box></Box>
                    <Box spacing={10}><Button id="camera-settings-open" className="suggested-action" onClicked={open}><Box spacing={8}><Image iconName="camera-photo-symbolic" pixelSize={16} /><Label>Open Camera</Label></Box></Button><Button id="camera-settings-photos" onClicked={photos}><Box spacing={8}><Image iconName="folder-pictures-symbolic" pixelSize={16} /><Label>Open photos</Label></Box></Button></Box>
                </Box>
                <Box className="camera-settings-tip" spacing={12}><Image iconName="folder-pictures-symbolic" pixelSize={18} valign="start" /><Box orientation="vertical" spacing={4} expand><Label className="settings-description" xalign={0}>Photos are saved as JPEG files</Label><Label className="settings-description" xalign={0} wrap>Pictures / Camera</Label></Box></Box>
            </Box>
        </ScrolledWindow>
    </Box>;
}
