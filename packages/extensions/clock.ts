import type {SettingsHost} from './types.js';
export function clockDisplayFormat(format: string, showSeconds: boolean): string {
    if (!showSeconds || format.includes('%S')) return format;
    return format.includes('%M') ? format.replace('%M', '%M:%S') : `${format}:%S`;
}

export function clockFormat(host: SettingsHost | undefined, fallback: string): string {
    if (!host) return fallback;
    try {
        const {state} = host.get('org.devos.clock');
        if (!state.enabled || typeof state.values.format !== 'string') return fallback;
        return clockDisplayFormat(state.values.format, state.values.showSeconds === true);
    } catch { return fallback; }
}
