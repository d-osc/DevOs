import {serviceClass} from '@dev-os/runtime/app-service';
import {Gio, GLib} from '@dev-os/core';
export interface NetworkProfile {id: string; path: string; name: string; type: string; activePath: string; active: boolean; hotspot: boolean; ownHotspot: boolean;}
export interface NetworkAddresses {addresses: string[]; dns: string[]; gateway: string;}
export interface NetworkAdapter {path: string; name: string; type: number; state: number; managed: boolean; mtu: number; mac: string; driver: string; ap: boolean; ipv4: NetworkAddresses; ipv6: NetworkAddresses;}
const passphraseAlphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Random WPA2 passphrase (12 characters, no look-alike symbols) from the kernel entropy pool. */
export function generatePassphrase(length = 12): string {
    let bytes: Uint8Array | null = null;
    try {const stream = Gio.File.new_for_path('/dev/urandom').read(null); bytes = stream.read_bytes(length * 4, null).toArray(); stream.close(null);} catch {bytes = null;}
    let value = '';
    for (let i = 0; value.length < length; i++) {
        const byte = bytes && i < bytes.length ? bytes[i] : GLib.random_int_range(0, 256);
        if (byte < 256 - (256 % passphraseAlphabet.length)) value += passphraseAlphabet[byte % passphraseAlphabet.length];
    }
    return value;
}
export interface Radio {id: number; type: string; device: string; soft: string; hard: string;}
export interface NetworkSnapshot {radioError?: string; available: boolean; adapters: NetworkAdapter[]; profiles: NetworkProfile[]; radios: Radio[]; airplane: boolean; connectivity: number;}
export const emptyNetwork: NetworkSnapshot = {available:false, adapters:[], profiles:[], radios:[], airplane:false, connectivity:0};
export interface ProxyValues {mode: 'none' | 'auto' | 'manual'; pac: string; http: string; httpPort: number; https: string; httpsPort: number; socks: string; socksPort: number; bypass: string[]; same?: boolean; authentication?: boolean; username?: string; password?: string;}
export interface ProxyControls {load(): ProxyValues | Promise<ProxyValues>; save(value: ProxyValues): void | Promise<void>;}
export function validateProxy(value: ProxyValues) {
    if (!['none','auto','manual'].includes(value.mode)) throw new Error('Choose a proxy mode.');
    if (value.mode === 'auto' && !/^https?:\/\/[^\s@]+$/i.test(value.pac)) throw new Error('Enter an HTTP or HTTPS address for the PAC file.');
    if (value.mode === 'manual') {
        if (value.same && !value.http) throw new Error('Enter the HTTP proxy used for all protocols.');
        if (![value.http, value.https, value.socks].some(Boolean)) throw new Error('Enter at least one proxy server.');
        for (const [host, port] of [[value.http, value.httpPort], [value.https, value.httpsPort], [value.socks, value.socksPort]] as [string, number][]) {
            if (host && (!/^[a-zA-Z0-9.:[\]_-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Use a host name or IP address and a port from 1 to 65535.');
        }
    }
    if (value.bypass.length > 100 || value.bypass.some(host => !host || /[\s\r\n]/.test(host))) throw new Error('Enter comma-separated hosts to bypass.');
}
export type SystemProxy = import('./network-settings.backend.js').SystemProxy;
export const SystemProxy = serviceClass<typeof import('./network-settings.backend.js').SystemProxy>('settings/network-settings.SystemProxy', {}, []);
