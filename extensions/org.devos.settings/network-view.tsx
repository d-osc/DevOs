import {React, Box, Label, Button, Image, ScrolledWindow, Gtk} from '@dev-os/core';
import {WifiSettings} from './wifi-view.js';
import {NativeNetworkSettings, type NativeNetworkPage} from './network-pages.js';
import {ProxySettings} from './proxy-view.js';
import {ConnectivitySettings} from './connectivity-view.js';
export type NetworkPage = 'network' | 'wifi' | 'proxy' | 'connectivity' | NativeNetworkPage;
export const isNetworkPage = (page: string): page is NetworkPage => ['network','wifi','connectivity','vpn','hotspot','airplane','proxy','advanced'].includes(page);

export const networkPages = [
    {id: 'wifi', title: 'Wi-Fi', icon: 'network-wireless-symbolic', description: 'Nearby networks, saved connections and signal strength'},
    {id: 'connectivity', title: 'Connectivity', icon: 'network-transmit-symbolic', description: 'TaskFirst traffic priority and WiFi SmartConnect'},
    {id: 'vpn', title: 'VPN', icon: 'network-vpn-symbolic', description: 'Add and manage your VPN connections'},
    {id: 'hotspot', title: 'Mobile hotspot', icon: 'network-wireless-hotspot-symbolic', description: 'Share your internet connection with other devices'},
    {id: 'airplane', title: 'Airplane mode', icon: 'airplane-mode-symbolic', description: 'Manage wireless radios and airplane mode'},
    {id: 'proxy', title: 'Proxy', icon: 'network-server-symbolic', description: 'PAC files, proxy servers and bypass rules'},
    {id: 'advanced', title: 'Advanced network settings', icon: 'preferences-system-symbolic', description: 'Network adapters, IP addresses, DNS and connection status'},
] as const;

export function NetworkSettings({page, navigate}: {page: NetworkPage; navigate(page: string): void}) {
    if (page === 'proxy') return <ProxySettings back={() => navigate('network')} />;
    if (page === 'connectivity') return <ConnectivitySettings back={() => navigate('network')} />;
    if (page !== 'network' && page !== 'wifi') return <NativeNetworkSettings key={page} page={page} back={() => navigate('network')} />;
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
                    {networkPages.map((item, index) => <Button key={item.id} id={`network-category-${item.id}`} className={`network-category ${index ? 'network-category-divider' : ''}`} onClicked={() => navigate(item.id)}>
                        <Box spacing={14}>
                            <Box className={`network-category-icon ${item.id === 'wifi' ? 'network-category-primary' : ''}`} widthRequest={38} heightRequest={38}><Image iconName={item.icon} pixelSize={21} expand /></Box>
                            <Box orientation="vertical" spacing={6} expand valign="center">
                                <Label className="network-category-title" xalign={0}>{item.title}</Label>
                                <Label className="settings-description" xalign={0} wrap>{item.description}</Label>
                            </Box>
                            <Label className="network-host-badge" valign="center">DevOs</Label>
                            <Image iconName="go-next-symbolic" pixelSize={13} valign="center" />
                        </Box>
                    </Button>)}
                </Box>
                <Label className="settings-description" wrap xalign={0}>Manage connections, sharing, wireless radios and proxy preferences inside DevOs.</Label>
            </Box>
        </ScrolledWindow>
    </Box>;
}
