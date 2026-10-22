import {React, Box, Label, Button, Image, ScrolledWindow, Gtk, useState, useEffect} from '@dev-os/core';
import {WifiSettings} from './wifi-view.js';
import {WindowsWifi, isWsl} from './wifi.js';

export const networkPages = [
    {id: 'wifi', title: 'Wi-Fi', icon: 'network-wireless-symbolic', description: 'Nearby networks, saved connections and signal strength'},
    {id: 'vpn', title: 'VPN', icon: 'network-vpn-symbolic', description: 'Add and manage your VPN connections'},
    {id: 'hotspot', title: 'Mobile hotspot', icon: 'network-wireless-hotspot-symbolic', description: 'Share your internet connection with other devices'},
    {id: 'airplane', title: 'Airplane mode', icon: 'airplane-mode-symbolic', description: 'Manage wireless radios and airplane mode'},
    {id: 'proxy', title: 'Proxy', icon: 'network-server-symbolic', description: 'Automatic detection and manual proxy configuration'},
    {id: 'advanced', title: 'Advanced network settings', icon: 'preferences-system-symbolic', description: 'Network adapters, connection properties and reset options'},
] as const;

export function NetworkSettings({page, navigate}: {page: 'network' | 'wifi'; navigate(page: string): void}) {
    const host = isWsl() ? 'Windows' : 'Linux';
    const native = !isWsl();
    const [windows] = useState(() => new WindowsWifi());
    const [opening, setOpening] = useState('');
    const [error, setError] = useState('');
    useEffect(() => () => windows.destroy(), [windows]);
    const open = async (id: typeof networkPages[number]['id']) => {
        if (id === 'wifi') { navigate('wifi'); return; }
        setOpening(id); setError('');
        await windows.openWindowsSettings(id);
        setError(windows.state.error); setOpening('');
    };
    if (page === 'wifi') return <Box orientation="vertical" expand fill>
        <Box className="network-breadcrumb" spacing={6}>
            <Button id="network-back" onClicked={() => navigate('network')}><Box spacing={6}><Image iconName="go-previous-symbolic" pixelSize={13} /><Label>Network &amp; Internet</Label></Box></Button>
            <Image iconName="go-next-symbolic" pixelSize={11} /><Label>Wi-Fi</Label>
        </Box>
        <WifiSettings />
    </Box>;
    return <Box className="settings-content" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={8}>
            <Label className="settings-eyebrow" xalign={0}>CONNECTIONS &amp; SHARING</Label>
            <Label className="heading" xalign={0}>Network &amp; Internet</Label>
            <Label className="settings-description" xalign={0}>All your connection settings, in one place.</Label>
        </Box>
        <ScrolledWindow expand fill minContentHeight={240} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="settings-form" orientation="vertical" spacing={16}>
                <Box className="wifi-network-list" orientation="vertical">
                    {networkPages.map((item, index) => <Button key={item.id} id={`network-category-${item.id}`} className={`network-category ${index ? 'network-category-divider' : ''}`} sensitive={!opening && (!native || item.id === 'wifi')} onClicked={() => { void open(item.id); }}>
                        <Box spacing={14}>
                            <Box className={`network-category-icon ${item.id === 'wifi' ? 'network-category-primary' : ''}`} widthRequest={38} heightRequest={38}><Image iconName={item.icon} pixelSize={21} expand /></Box>
                            <Box orientation="vertical" spacing={6} expand valign="center">
                                <Label className="network-category-title" xalign={0}>{item.title}</Label>
                                <Label className="settings-description" xalign={0} wrap>{item.description}</Label>
                            </Box>
                            {item.id !== 'wifi' && <Label className="network-host-badge" valign="center">{native ? 'Coming soon' : opening === item.id ? 'Opening…' : host}</Label>}
                            <Image iconName="go-next-symbolic" pixelSize={13} valign="center" />
                        </Box>
                    </Button>)}
                </Box>
                <Label className="settings-description" wrap xalign={0}>{native ? 'Wi-Fi is managed in DevOs Settings. Additional network pages are being developed.' : `VPN, hotspot, airplane mode, proxy and advanced options open their ${host} settings page.`}</Label>
                {error && <Label className="error" wrap xalign={0}>{error}</Label>}
            </Box>
        </ScrolledWindow>
    </Box>;
}
