// DevOs tools share the protected shell process. They do not consume external
// app ranks; third-party applications remain external.
const systemApps = new Set([
    'dev-os-shell.desktop', 'dev-os-terminal.desktop', 'dev-os-files.desktop',
    'dev-os-browser.desktop', 'dev-os-editor.desktop', 'dev-os-task-manager.desktop',
    'dev-os-disk-manager.desktop', 'dev-os-app-store.desktop',
    'dev-os-settings.desktop', 'org.devos.settings.desktop',
    'org.devos.files.desktop', 'org.devos.terminal.desktop',
]);
export function isSystemApp(id: string): boolean {return systemApps.has(id.toLowerCase());}
export function rankExternalApps(previous: readonly string[], open: readonly string[], focused?: string): string[] {
    const live = new Set(open.map(id => id.toLowerCase()).filter(id => !isSystemApp(id)));
    const result = [...new Set(previous.map(id => id.toLowerCase()).filter(id => live.has(id)))];
    for (const id of live) if (!result.includes(id)) result.push(id);
    const active = focused?.toLowerCase();
    return active && live.has(active) ? [active, ...result.filter(id => id !== active)] : result;
}
