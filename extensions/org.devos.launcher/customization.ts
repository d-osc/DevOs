import type {GioTypes as Gio, SettingsValues} from '@dev-os/core';
export const defaultWorkspaceApps = ['builtin:terminal', 'builtin:files', 'builtin:editor'];
export function launcherCustomization(values: SettingsValues = {}) {
    let workspaceApps = [...defaultWorkspaceApps];
    try {
        const parsed: unknown = JSON.parse(String(values.workspaceApps ?? JSON.stringify(defaultWorkspaceApps)));
        if (Array.isArray(parsed) && parsed.length <= 64 && parsed.every(item => typeof item === 'string' && item.length > 0 && item.length <= 512))
            workspaceApps = [...new Set(parsed)] as string[];
    } catch { /* Preserve readable defaults when a preference needs repair. */ }
    return {appView: values.appView === 'grid' ? 'grid' as const : 'list' as const, workspaceApps};
}
export function workspaceAppKey(app: Gio.AppInfo) { return `app:${app.get_id() ?? `name:${app.get_display_name()}`}`; }
