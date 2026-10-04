import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {writeJson} from './preferences.js';

export type Command = 'terminal' | 'files' | 'lock';
export interface Config {
    name: string; accent: string; background: string; panel_height: number;
    clock_format: string; terminal: string[]; files: string[]; lock: string[]; autostart: string[][];
}
declare const __DEV_OS_VERSION__: string;
export const VERSION = typeof __DEV_OS_VERSION__ === 'string' ? __DEV_OS_VERSION__ : '0.3.2';
export const ROOT = GLib.getenv('DEV_OS_ROOT') ??
    Gio.File.new_for_uri(import.meta.url).get_parent()!.get_parent()!.get_path()!;
export const DEFAULTS: Readonly<Config> = Object.freeze({
    name: 'Dev OS', accent: '#88e0c0', background: '#101b25', panel_height: 36,
    clock_format: '%H:%M', terminal: ['dev-os-terminal'],
    files: ['thunar', '~'], lock: ['swaylock', '-c', '101b25'], autostart: [],
});

export function configPath() {
    return GLib.build_filenamev([GLib.get_user_config_dir(), 'dev-os', 'config.json']);
}

export function readText(path: string): string {
    const [ok, contents] = GLib.file_get_contents(path);
    if (!ok) throw new Error(`Cannot read ${path}`);
    return new TextDecoder().decode(contents);
}

function validateCommand(value: unknown, key: string): asserts value is string[] {
    if (!Array.isArray(value) || !value.length ||
        !value.every(arg => typeof arg === 'string' && arg.length && !arg.includes('\0')))
        throw new Error(`${key} must be a non-empty array of non-empty command arguments`);
}

export function validateConfig(data: unknown): Config {
    if (data === null || typeof data !== 'object' || Array.isArray(data))
        throw new Error('Config must be a JSON object');
    const input = data as Record<string, unknown>;
    const unknown = Object.keys(input).filter(key => !Object.hasOwn(DEFAULTS, key));
    if (unknown.length) throw new Error(`Unknown settings: ${unknown.join(', ')}`);
    for (const key of ['name', 'clock_format']) {
        if (Object.hasOwn(input, key) && (typeof input[key] !== 'string' || !input[key].trim()))
            throw new Error(`${key} must be a non-empty string`);
    }
    for (const key of ['accent', 'background']) {
        if (Object.hasOwn(input, key) && (typeof input[key] !== 'string' ||
            !/^#[0-9a-fA-F]{6}$/.test(input[key])))
            throw new Error(`${key} must be a six-digit hex color, e.g. #88e0c0`);
    }
    if (Object.hasOwn(input, 'panel_height') &&
        (typeof input.panel_height !== 'number' || !Number.isInteger(input.panel_height) || input.panel_height < 32 || input.panel_height > 96))
        throw new Error('panel_height must be an integer between 32 and 96');
    for (const key of ['terminal', 'files', 'lock']) {
        if (Object.hasOwn(input, key)) validateCommand(input[key], key);
    }
    if (Object.hasOwn(input, 'autostart')) {
        if (!Array.isArray(input.autostart)) throw new Error('autostart must be an array of command arrays');
        input.autostart.forEach(command => validateCommand(command, 'autostart'));
    }
    return JSON.parse(JSON.stringify({...DEFAULTS, ...input})) as Config;
}

export function loadConfig(path = configPath()) {
    if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
        if (path === configPath()) {
            const legacy = path.replace(/\.json$/, '.toml');
            if (GLib.file_test(legacy, GLib.FileTest.EXISTS))
                throw new Error(`Found legacy ${legacy}; run python3 tools/migrate-config.py first.`);
        }
        return validateConfig({});
    }
    try { return validateConfig(JSON.parse(readText(path))); }
    catch (error) { throw new Error(`Cannot read ${path}: ${(error instanceof Error ? error.message : String(error))}`); }
}

export function expandHome(argument: string): string {
    if (argument === '~') return GLib.get_home_dir();
    return argument.startsWith('~/') ? GLib.get_home_dir() + argument.slice(1) : argument;
}
export function saveConfig(data: unknown, path = configPath()): Config {
    const config = validateConfig(data);
    writeJson(path, config);
    return config;
}
