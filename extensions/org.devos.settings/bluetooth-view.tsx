import {React, Box, Label, Button, Image, ScrolledWindow, Gtk, Switch, Entry, useEffect, useState} from '@dev-os/core';
import {Bluetooth, type BluetoothControls, type DevicePage} from './bluetooth.js';

const categories: {id: DevicePage; title: string; icon: string; description: string}[] = [
    {id: 'bluetooth-add', title: 'Add a Bluetooth device', icon: 'bluetooth-active-symbolic', description: 'Pair headphones, speakers, keyboards and other devices'},
    {id: 'mouse', title: 'Mouse', icon: 'input-mouse-symbolic', description: 'Pointer speed, scrolling and button layout'},
    {id: 'keyboard', title: 'Keyboard', icon: 'input-keyboard-symbolic', description: 'Typing, layouts and keyboard shortcuts'},
    {id: 'printers', title: 'Printers & Devices', icon: 'printer-symbolic', description: 'Add printers and manage printing devices'},
];
export function BluetoothDevicesSettings({controls, showTouchpad, navigate, adding = false, back}: {controls?: BluetoothControls; showTouchpad?(): void; navigate?(page: DevicePage): void; adding?: boolean; back?(): void}) {
    const [bluetooth] = useState(() => controls ?? new Bluetooth());
    const [state, setState] = useState(bluetooth.state);
    const [forget, confirmForget] = useState('');
    const [code, setCode] = useState('');
    useEffect(() => {setCode('');}, [state.prompt]);
    useEffect(() => {
        const unsubscribe = bluetooth.subscribe(() => setState(bluetooth.state));
        void bluetooth.refresh();
        return () => { unsubscribe(); if (!controls && bluetooth instanceof Bluetooth) bluetooth.destroy(); };
    }, [bluetooth, controls]);
    const powered = state.adapters.some(adapter => adapter.powered);
    return <Box className="settings-content bluetooth-page" orientation="vertical" expand fill>
        <Box className="settings-page-header" spacing={14}>
            <Box orientation="vertical" spacing={6} expand>
                <Label className="settings-eyebrow" xalign={0}>CONNECTED DEVICES</Label>
                <Label className="heading" xalign={0}>{adding ? 'Add a Bluetooth device' : 'Bluetooth & Devices'}</Label>
                {adding && <Button onClicked={back}>‹ Devices</Button>}
                <Label className="settings-description" xalign={0}>Connect your accessories and make them work your way.</Label>
            </Box>
            <Button id="bluetooth-refresh" valign="center" sensitive={!state.busy} onClicked={() => { void bluetooth.refresh(); }}>
                <Box spacing={7}><Image iconName="view-refresh-symbolic" pixelSize={15} /><Label>{state.busy ? 'Working…' : 'Refresh'}</Label></Box>
            </Button>
        </Box>
        <ScrolledWindow expand fill minContentHeight={240} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="settings-form" orientation="vertical" spacing={16}>
                <Box className="settings-card bluetooth-card" orientation="vertical" spacing={12}>
                    <Box spacing={12}>
                        <Image iconName="bluetooth-symbolic" pixelSize={26} valign="center" />
                        <Box orientation="vertical" spacing={5} expand>
                            <Label className="section-heading" xalign={0}>Bluetooth</Label>
                            <Label id="bluetooth-status" className="settings-description" xalign={0} wrap>{state.scanning ? 'Scanning for nearby devices…' : state.adapters.length ? powered ? 'On · Ready to connect' : 'Off' : state.busy ? 'Checking adapters…' : 'No Bluetooth adapter available to Linux'}</Label>
                        </Box>
                        <Button id="bluetooth-scan" sensitive={powered && !state.busy} onClicked={() => { void bluetooth.refresh(true); }}>{state.scanning ? 'Scanning… (10 s)' : 'Scan nearby'}</Button>
                    </Box>
                    {state.adapters.map(adapter => <Box key={adapter.id} spacing={12}>
                        <Label xalign={0} expand>{adapter.name}</Label>
                        <Switch id={`bluetooth-power-${adapter.id.split('/').pop()}`} active={adapter.powered} sensitive={!state.busy}
                            onActiveChanged={widget => { if (widget.active !== adapter.powered) void bluetooth.power(adapter); }} />
                    </Box>)}
                    {state.host === 'Windows' && <Label id="bluetooth-wsl-notice" className="settings-description" xalign={0} wrap>Windows manages the host Bluetooth adapter. Devices not passed through to WSL are managed in Windows settings.</Label>}
                    {state.bluetoothError && state.host !== 'Windows' && <Label className="settings-description" xalign={0} wrap>{state.bluetoothError}</Label>}
                    {state.error && <Label id="bluetooth-error" className="error" xalign={0} wrap>{state.error}</Label>}
                </Box>
                {state.pairing && <Box className="settings-card system-card" orientation="vertical" spacing={12}><Label className="section-heading" xalign={0}>{`Pairing with ${state.pairing}`}</Label>{state.prompt ? <><Label xalign={0} wrap>{state.prompt.kind === 'confirm' ? 'Does this code match the code shown on your device?' : state.prompt.kind === 'display' ? 'Enter this code on your Bluetooth device.' : state.prompt.kind === 'authorize' ? 'Allow this device to connect?' : 'Enter the code shown on your device.'}</Label>{state.prompt.code && <Label className="heading" xalign={0}>{state.prompt.code}</Label>}{['pin', 'passkey'].includes(state.prompt.kind) && <Entry id="bluetooth-code" text={code} placeholder="Pairing code" onChanged={w => setCode(w.get_text())}/>}<Box spacing={10}><Button id="bluetooth-pair-cancel" onClicked={() => bluetooth.cancelPair?.()}>Cancel pairing</Button>{state.prompt.kind !== 'display' && <Button id="bluetooth-pair-confirm" className="settings-primary" onClicked={() => bluetooth.respond?.(true, code)}>Confirm</Button>}</Box></> : <><Label className="settings-description" xalign={0}>Waiting for your device…</Label><Button onClicked={() => bluetooth.cancelPair?.()}>Cancel pairing</Button></>}</Box>}
                <Box className="settings-card bluetooth-card" orientation="vertical" spacing={12}>
                    <Label className="section-heading" xalign={0}>{state.devices.length ? `Bluetooth devices · ${state.devices.length} found${state.devices.some(d => d.named === false) ? `, ${state.devices.filter(d => d.named === false).length} unnamed (listed last)` : ''}` : 'Bluetooth devices'}</Label>
                    {state.devices.map(device => <Box key={device.id} className="bluetooth-device" spacing={12}>
                        <Image iconName={`${device.icon}-symbolic`} pixelSize={24} valign="center" />
                        <Box orientation="vertical" spacing={5} expand>
                            <Label className="settings-field-title" xalign={0} wrap>{device.name}</Label>
                            <Label className="settings-description" xalign={0}>{device.connected ? 'Connected' : device.paired ? 'Paired · Not connected' : 'Available to pair'}</Label>
                        </Box>
                        {device.paired ? <Button sensitive={!state.busy} onClicked={() => { void bluetooth.device(device.connected ? 'disconnect' : 'connect', device); }}>{device.connected ? 'Disconnect' : 'Connect'}</Button> :
                            <Button sensitive={!state.busy} onClicked={() => { void bluetooth.pair?.(device); }}>Pair…</Button>}
                        {device.paired && <Button sensitive={!state.busy} onClicked={() => confirmForget(device.id)}>Forget…</Button>}
                        {forget === device.id && <Box spacing={6}>
                            <Button onClicked={() => confirmForget('')}>Cancel</Button>
                            <Button sensitive={!state.busy} onClicked={() => { confirmForget(''); void bluetooth.device('forget', device); }}>Confirm forget</Button>
                        </Box>}
                    </Box>)}
                    {!state.devices.length && <Label className="settings-description" xalign={0} wrap>{powered ? 'No devices listed. Put your accessory in pairing mode, then scan nearby.' : 'Turn on Bluetooth to discover nearby accessories.'}</Label>}
                </Box>
                {!adding && <Box className="wifi-network-list" orientation="vertical">
                    {showTouchpad && <Button id="devices-category-touchpad" className="network-category" onClicked={showTouchpad}><Box spacing={14}><Image iconName="input-touchpad-symbolic" pixelSize={25} /><Box orientation="vertical" spacing={5} expand><Label className="settings-field-title" xalign={0}>Touchpad</Label><Label className="settings-description" xalign={0}>Pointer speed, taps, scrolling and gestures</Label></Box><Label className="network-host-badge">DevOs</Label><Image iconName="go-next-symbolic" pixelSize={13} /></Box></Button>}
                    {categories.map((item, index) => <Button id={`devices-category-${item.id}`} key={item.id} className={`network-category ${index || showTouchpad ? 'network-category-divider' : ''}`} sensitive={!state.busy} onClicked={() => { navigate?.(item.id); }}>
                        <Box spacing={14}>
                            <Box className="network-category-icon" widthRequest={38} heightRequest={38}><Image iconName={item.icon} pixelSize={21} expand /></Box>
                            <Box orientation="vertical" spacing={5} expand><Label className="network-category-title" xalign={0}>{item.title}</Label><Label className="settings-description" xalign={0} wrap>{item.description}</Label></Box>
                            <Label className="network-host-badge" valign="center">DevOs</Label>
                            <Image iconName="go-next-symbolic" pixelSize={13} valign="center" />
                        </Box>
                    </Button>)}
                </Box>}
                {!adding && <Box className="settings-card bluetooth-card" orientation="vertical" spacing={12}>
                    <Label className="section-heading" xalign={0}>USB &amp; input devices</Label>
                    {[...state.usb.map(d => ({...d, kind: 'USB'})), ...state.inputs.map(d => ({...d, kind: 'Input'}))].map(device =>
                        <Box key={`${device.kind}/${device.id}`} spacing={10}>
                            <Image iconName={device.kind === 'USB' ? 'drive-removable-media-usb-symbolic' : 'input-keyboard-symbolic'} pixelSize={18} />
                            <Label xalign={0} expand wrap>{device.name}</Label><Label className="settings-description">{device.kind}</Label>
                        </Box>)}
                    {!state.usb.length && !state.inputs.length && <Label className="settings-description" xalign={0}>No USB or input devices are exposed to this Linux session.</Label>}
                </Box>}
            </Box>
        </ScrolledWindow>
    </Box>;
}
