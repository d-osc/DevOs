import type {SettingsHost} from './types.js';

export function clockFormat(host: SettingsHost | undefined, fallback: string): string {
    if (!host) return fallback;
    try {
        const {state} = host.get('org.devos.clock');
        if (!state.enabled || typeof state.values.format !== 'string') return fallback;
        const format = state.values.format;
        if (state.values.showSeconds !== true || format.includes('%S')) return format;
        return format.includes('%M') ? format.replace('%M', '%M:%S') : `${format}:%S`;
    } catch { return fallback; }
}
