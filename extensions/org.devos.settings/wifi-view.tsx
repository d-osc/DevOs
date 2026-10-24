import {React, Box, Label, Button, Image, Entry, Switch, SearchEntry, ScrolledWindow, Gtk, Pango, useEffect, useState} from '@dev-os/core';
import {WindowsWifi, isWsl, type WifiControls, type WifiNetwork} from './wifi.js';

const signalIcon = (signal: number) => signal >= 75 ? 'network-wireless-signal-excellent-symbolic' : signal >= 45 ? 'network-wireless-signal-good-symbolic' : 'network-wireless-signal-weak-symbolic';
const signalLabel = (signal: number) => signal >= 75 ? 'Excellent signal' : signal >= 45 ? 'Good signal' : 'Weak signal';

export function WifiSettings({controls, native: nativeOverride}: {controls?: WifiControls; native?: boolean}) {
    const host = isWsl() ? 'Windows' : 'Linux';
    const [wifi] = useState(() => controls ?? new WindowsWifi());
    const [state, setState] = useState(wifi.state);
    const [query, setQuery] = useState('');
    const [joining, setJoining] = useState<WifiNetwork | null>(null);
    const [password, setPassword] = useState('');
    const [reveal, setReveal] = useState(false);
    const native = nativeOverride ?? !isWsl();
    const join = async (network: WifiNetwork) => {
        if (native && !network.profile && network.secure && network.security !== 'owe') { setPassword(''); setReveal(false); setJoining(network); return; }
        setJoining(null); setPassword(''); await wifi.connect(network);
    };
    useEffect(() => {
        const unsubscribe = wifi.subscribe(() => setState(wifi.state));
        void wifi.refresh();
        return () => { unsubscribe(); if (!controls && wifi instanceof WindowsWifi) wifi.destroy(); };
    }, [wifi, controls]);
    const connected = state.networks.find(network => network.connected);
    const available = state.networks.filter(network => !network.connected);
    const radioOff = native && state.wirelessEnabled === false;
    const matches = available.filter(network => network.ssid.toLowerCase().includes(query.trim().toLowerCase()));
    return <Box className="settings-content wifi-page" orientation="vertical" expand fill>
        <Box className="settings-page-header wifi-header" spacing={14}>
            <Box orientation="vertical" spacing={6} expand>
                <Label className="settings-eyebrow" xalign={0}>CONNECTIONS</Label>
                <Label className="heading" xalign={0}>Wi-Fi</Label>
                <Label id="wifi-status" className="settings-description" xalign={0} wrap>{connected ? `Connected to ${connected.ssid}` : radioOff ? 'Wi-Fi is turned off' : 'Find a network. Make yourself at home.'}</Label>
            </Box>
            <Button id="wifi-refresh" className="wifi-refresh" valign="center" sensitive={!state.busy} tooltip="Refresh nearby networks" onClicked={() => { void wifi.refresh(); }}>
                <Box spacing={7}><Image iconName="view-refresh-symbolic" pixelSize={15} /><Label>{state.busy ? 'Scanning…' : 'Refresh'}</Label></Box>
            </Button>
        </Box>
        <ScrolledWindow expand fill minContentHeight={240} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="wifi-body" orientation="vertical" spacing={20}>
                {native && wifi.setEnabled && <Box className={`wifi-radio-card ${radioOff ? 'wifi-radio-off' : ''}`} spacing={14}>
                    <Box className="wifi-radio-icon" widthRequest={38} heightRequest={38} valign="center"><Image iconName="network-wireless-symbolic" pixelSize={20} expand /></Box>
                    <Box orientation="vertical" spacing={4} expand valign="center">
                        <Label className="section-heading" xalign={0}>Wi-Fi</Label>
                        <Label className="settings-description" xalign={0} wrap>{state.wirelessEnabled === false ? 'Turn on to discover nearby networks.' : 'Discover and connect to wireless networks.'}</Label>
                    </Box>
                    <Switch id="wifi-radio" valign="center" active={state.wirelessEnabled !== false} sensitive={!state.busy && state.wirelessEnabled !== undefined} onActiveChanged={widget => { if (state.wirelessEnabled !== undefined && widget.active !== state.wirelessEnabled) void wifi.setEnabled?.(widget.active); }} />
                </Box>}
                {!radioOff && <Box className={`wifi-connection ${connected ? 'wifi-connection-active' : ''}`} orientation="vertical" spacing={16}>
                    <Box spacing={14}>
                        <Box className={`wifi-connection-icon ${connected ? '' : 'wifi-connection-icon-off'}`} widthRequest={48} heightRequest={48}><Image iconName={connected ? signalIcon(connected.signal) : 'network-wireless-offline-symbolic'} pixelSize={27} expand /></Box>
                        <Box orientation="vertical" spacing={6} expand valign="center">
                            <Label className="wifi-overline" xalign={0}>{connected ? 'CURRENT NETWORK' : 'YOUR CONNECTION'}</Label>
                            <Label className="wifi-network-title" xalign={0} ellipsize={Pango.EllipsizeMode.END}>{connected?.ssid ?? 'Not connected to Wi-Fi'}</Label>
                        </Box>
                        <Label className={`wifi-status-badge ${connected ? 'wifi-status-online' : ''}`} valign="start">{connected ? '●  Connected' : 'Offline'}</Label>
                    </Box>
                    {connected && <Box className="wifi-connection-details" spacing={20}>
                        <Box spacing={7} valign="center"><Image iconName={signalIcon(connected.signal)} pixelSize={14} /><Label>{`${signalLabel(connected.signal)} · ${connected.signal}%`}</Label></Box>
                        <Box spacing={7} valign="center" expand><Image iconName={connected.secure ? 'channel-secure-symbolic' : 'channel-insecure-symbolic'} pixelSize={14} /><Label xalign={0}>{connected.secure ? 'Secured connection' : 'Open network'}</Label></Box>
                        {native && wifi.disconnect && <Button id="wifi-disconnect" className="wifi-disconnect" valign="center" sensitive={!state.busy} onClicked={() => { void wifi.disconnect?.(connected); }}>Disconnect</Button>}
                    </Box>}
                </Box>}
                {radioOff && <Box id="wifi-off" className="wifi-off" orientation="vertical" spacing={10}>
                    <Image iconName="network-wireless-offline-symbolic" pixelSize={34} />
                    <Label className="section-heading">Wi-Fi is off</Label>
                    <Label className="settings-description" wrap>Turn Wi-Fi on with the switch above to see nearby networks.</Label>
                </Box>}
                {state.error && <Box className="wifi-notice wifi-notice-error" spacing={10}><Image iconName="dialog-warning-symbolic" pixelSize={18} /><Label id="wifi-error" wrap xalign={0} expand>{state.error}</Label></Box>}
                {state.accessDenied && <Label className="settings-description" wrap xalign={0}>Allow location access for desktop apps in Windows Privacy settings, then refresh.</Label>}
                {state.message && <Label id="wifi-message" className="settings-description" wrap xalign={0}>{state.message}</Label>}
                {joining && <Box id="wifi-join-form" className="wifi-join" orientation="vertical" spacing={12}>
                    <Box spacing={12}>
                        <Box className="wifi-row-icon wifi-join-icon" widthRequest={36} heightRequest={36} valign="center"><Image iconName="channel-secure-symbolic" pixelSize={18} expand /></Box>
                        <Box orientation="vertical" spacing={3} expand valign="center">
                            <Label className="section-heading" xalign={0} ellipsize={Pango.EllipsizeMode.END}>{`Connect to ${joining.ssid}`}</Label>
                            <Label className="settings-description" xalign={0}>{joining.security === 'sae' ? 'This network uses WPA3. Enter its password.' : 'Enter the network password (at least 8 characters).'}</Label>
                        </Box>
                    </Box>
                    <Box spacing={8}>
                        <Entry id="wifi-password" expand password={!reveal} text={password} placeholder="Wi-Fi password" sensitive={!state.busy} onChanged={entry => setPassword(entry.get_text())} />
                        <Button id="wifi-password-reveal" className="wifi-reveal" tooltip={reveal ? 'Hide password' : 'Show password'} onClicked={() => setReveal(value => !value)}><Image iconName={reveal ? 'view-conceal-symbolic' : 'view-reveal-symbolic'} pixelSize={16} /></Button>
                    </Box>
                    {state.error && <Label className="wifi-join-error" xalign={0} wrap>{state.error}</Label>}
                    <Box spacing={10} halign="end">
                        <Button id="wifi-join-cancel" sensitive={!state.busy} onClicked={() => { setJoining(null); setPassword(''); setReveal(false); }}>Cancel</Button>
                        <Button id="wifi-join-confirm" className="settings-primary" sensitive={!state.busy && password.length >= (joining.security === 'sae' ? 1 : 8)} onClicked={() => {
                            const secret = password; setPassword('');
                            void wifi.connect(joining, secret).then(() => { if (!wifi.state.error) setJoining(null); });
                        }}>{state.busy ? 'Connecting…' : 'Connect'}</Button>
                    </Box>
                </Box>}
                {!radioOff && <Box orientation="vertical" spacing={12}>
                    <Box spacing={10}>
                        <Label className="section-heading" xalign={0} expand>Nearby networks</Label>
                        <Label className="wifi-count">{`${available.length} available`}</Label>
                    </Box>
                    <SearchEntry id="wifi-search" text={query} placeholder="Find a network…" onChanged={entry => setQuery(entry.get_text())} />
                    <Box className="wifi-network-list" orientation="vertical">
                        {matches.map((network, index) => <Box key={`${network.interfaceId}/${network.ssid}/${network.secure}`} className={`wifi-network-row ${index ? 'wifi-row-divider' : ''}`} spacing={12}>
                            <Box className="wifi-row-icon" widthRequest={36} heightRequest={36}><Image iconName={signalIcon(network.signal)} pixelSize={21} expand /></Box>
                            <Box orientation="vertical" spacing={5} expand valign="center">
                                <Box spacing={8}><Label className="wifi-row-name" xalign={0} ellipsize={Pango.EllipsizeMode.END} expand>{network.ssid}</Label></Box>
                                <Box spacing={7}><Label className="wifi-row-detail">{`${signalLabel(network.signal).replace(' signal', '')} · ${network.signal}%`}</Label><Label className="wifi-row-detail">·</Label><Image iconName={network.secure ? 'channel-secure-symbolic' : 'channel-insecure-symbolic'} pixelSize={11} /><Label className="wifi-row-detail">{network.secure ? 'Secured' : 'Open'}</Label>{network.profile && <Label className="wifi-saved-badge">Saved</Label>}</Box>
                            </Box>
                            <Button className={network.profile ? 'wifi-connect-button' : 'wifi-setup-button'} valign="center" sensitive={!state.busy && network.connectable} tooltip={network.profile ? 'Connect using your saved profile' : native ? 'Connect in DevOs Settings' : `Set up this network in ${host}`} onClicked={() => { void join(network); }}>
                                {network.profile || native ? 'Connect' : 'Set up'}
                            </Button>
                        </Box>)}
                        {!matches.length && <Box className="wifi-empty" orientation="vertical" spacing={10}>
                            <Image iconName={state.busy ? 'view-refresh-symbolic' : query ? 'edit-find-symbolic' : 'network-wireless-symbolic'} pixelSize={30} />
                            <Label id="wifi-empty" className="section-heading">{state.busy ? 'Looking for networks…' : query ? 'No matching networks' : 'No nearby networks found'}</Label>
                            <Label className="settings-description" wrap>{state.busy ? 'This only takes a moment.' : query ? 'Try another network name.' : native ? 'Move closer to a router, then refresh.' : `Check Wi-Fi in ${host}, then refresh.`}</Label>
                        </Box>}
                    </Box>
                </Box>}
                {!native && <Box className="wifi-manage" orientation="vertical" spacing={10}>
                    <Box spacing={8}><Image iconName="preferences-system-symbolic" pixelSize={15} /><Label className="wifi-manage-title" xalign={0}>More connection options</Label></Box>
                    <Label className="settings-description" xalign={0} wrap>{`Add a new password, manage saved networks, or turn Wi-Fi on and off in ${host}.`}</Label>
                    <Button id="wifi-windows-settings" className="wifi-manage-button" halign="start" sensitive={!state.busy} onClicked={() => { void wifi.openWindowsSettings(); }}>
                        <Box spacing={8}><Label>{`Open ${host} Wi-Fi settings`}</Label><Image iconName="go-next-symbolic" pixelSize={13} /></Box>
                    </Button>
                </Box>}
            </Box>
        </ScrolledWindow>
    </Box>;
}
