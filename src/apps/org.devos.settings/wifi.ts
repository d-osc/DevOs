import {serviceClass} from '@dev-os/runtime/app-service';
import {Gio, GLib, Listeners} from '@dev-os/core';
import {ROOT} from '@dev-os/config';

export interface WifiNetwork {
    ssid: string; profile: string; adapter: string; interfaceId: string;
    signal: number; secure: boolean; connected: boolean; connectable: boolean;
    security?: string;
}
export interface WifiState {networks: WifiNetwork[]; busy: boolean; error: string; message: string; accessDenied: boolean; wirelessEnabled?: boolean;}
export interface WifiControls {
    state: WifiState;
    subscribe(listener: () => void): () => void;
    refresh(): Promise<void>;
    connect(network: WifiNetwork, password?: string): Promise<void>;
    setEnabled?(enabled: boolean): Promise<void>;
    disconnect?(network: WifiNetwork): Promise<void>;
    openWindowsSettings(): Promise<void>;
}
export function normalizeWifiNetworks(value: unknown): WifiNetwork[] {
    if (!Array.isArray(value)) throw new Error('Invalid Wi-Fi network list.');
    const result = new Map<string, WifiNetwork>();
    for (const item of value) {
        if (!item || typeof item !== 'object') throw new Error('Invalid Wi-Fi network.');
        const n = item as Record<string, unknown>;
        if (typeof n.ssid !== 'string' || typeof n.profile !== 'string' || typeof n.adapter !== 'string' ||
            typeof n.interfaceId !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(n.interfaceId) ||
            typeof n.signal !== 'number' || !Number.isFinite(n.signal) ||
            ['secure', 'connected', 'connectable'].some(key => typeof n[key] !== 'boolean')) throw new Error('Invalid Wi-Fi network data.');
        if (!n.ssid) continue; // Hidden networks are configured in Windows.
        const next = {...n, signal: Math.max(0, Math.min(100, n.signal))} as unknown as WifiNetwork;
        const key = JSON.stringify([next.interfaceId, next.ssid, next.secure]);
        const previous = result.get(key);
        if (!previous || next.connected || (!previous.connected && !previous.profile && !!next.profile)) result.set(key, next);
        else previous.signal = Math.max(previous.signal, next.signal);
    }
    return [...result.values()].sort((a, b) => Number(b.connected) - Number(a.connected) || b.signal - a.signal || a.ssid.localeCompare(b.ssid));
}
export function isWsl(): boolean {
    try { return /microsoft/i.test(new TextDecoder().decode(GLib.file_get_contents('/proc/sys/kernel/osrelease')[1])); }
    catch { return false; }
}
export function nativeWifiHelper(root = ROOT): string {
    const source = `${root}/bin/dev-os-network-linux`;
    const helper = GLib.file_test(source, GLib.FileTest.IS_REGULAR) ? source : GLib.find_program_in_path('dev-os-network-linux');
    if (!helper) throw new Error('The Linux Wi-Fi helper is missing. Reinstall the DevOs desktop package.');
    return helper;
}
export function parseNativeWifiResponse(stdout: string | null, stderr: string | null, successful: boolean, timedOut = false): Record<string, unknown> {
    if (timedOut) throw new Error('The Linux Wi-Fi request timed out. Check NetworkManager and the Wi-Fi driver.');
    const detail = stderr?.trim().slice(0, 500);
    let response: unknown;
    try { response = JSON.parse((stdout ?? '').replace(/^\uFEFF/, '').trim()); }
    catch { throw new Error(detail ? `Linux Wi-Fi helper failed: ${detail}` : 'The Linux Wi-Fi helper returned no valid data. Check NetworkManager and the installed desktop package.'); }
    if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('Invalid Linux Wi-Fi response.');
    const result = response as Record<string, unknown>;
    if (!successful || result.ok !== true) throw new Error(typeof result.error === 'string' && result.error ? result.error : detail || 'Linux NetworkManager request failed.');
    return result;
}
export type WindowsWifi = import('./wifi.backend.js').WindowsWifi;
export const WindowsWifi = serviceClass<typeof import('./wifi.backend.js').WindowsWifi>('settings/wifi.WindowsWifi', {state: {networks: [], busy: false, error: '', message: '', accessDenied: false}}, []);
