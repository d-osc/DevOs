import {serviceClass} from '@dev-os/runtime/app-service';
import {Gio, GLib} from '@dev-os/core';

export type AudioKind = 'sink' | 'source' | 'sink-input';
export interface AudioItem {id: number; name: string; title: string; volume: number; muted: boolean; device?: number;}
export interface AudioState {outputs: AudioItem[]; inputs: AudioItem[]; applications: AudioItem[]; defaultOutput: string; defaultInput: string;}
export interface AudioControls {load(): Promise<AudioState>; volume(kind: AudioKind, id: number, value: number): Promise<void>; mute(kind: AudioKind, id: number, muted: boolean): Promise<void>; select(kind: 'sink' | 'source', name: string): Promise<void>; route(id: number, output: number): Promise<void>; destroy(): void;}
interface PulseItem {index: number; name?: string; description?: string; mute?: boolean; sink?: number; volume?: Record<string, {value: number}>; properties?: Record<string, string>;}
export function audioItem(item: PulseItem): AudioItem {
    const channels = Object.values(item.volume ?? {}).map(channel => channel.value / 65536 * 100).filter(Number.isFinite);
    return {id: item.index, name: item.name ?? String(item.index), title: item.description || item.properties?.['application.name'] || item.properties?.['media.name'] || item.name || 'Application', volume: channels.length ? Math.round(channels.reduce((a, b) => a + b, 0) / channels.length) : 0, muted: item.mute === true, device: item.sink};
}
export type LinuxAudio = import('./audio.backend.js').LinuxAudio;
export const LinuxAudio = serviceClass<typeof import('./audio.backend.js').LinuxAudio>('settings/audio.LinuxAudio', {}, []);
