// Base apps have independent processes, but keep system-app identity rather
// than consuming third-party ranks in the external application memory policy.
const systemApps = new Set([
    'dev-os-shell.desktop', 'dev-os-terminal.desktop', 'dev-os-files.desktop',
    'dev-os-browser.desktop', 'dev-os-editor.desktop', 'dev-os-task-manager.desktop',
    'dev-os-camera.desktop', 'dev-os-microphone.desktop', 'dev-os-screenshot.desktop', 'dev-os-installer.desktop',
    'dev-os-disk-manager.desktop', 'dev-os-app-store.desktop',
    'dev-os-settings.desktop', 'org.devos.settings.desktop',
    'org.devos.files.desktop', 'org.devos.terminal.desktop',
]);
export function isSystemApp(id: string): boolean {return systemApps.has(id.toLowerCase()) || /^org\.devos\.App\.(settings|files|terminal|editor|camera|microphone|taskmanager|browser|diskmanager|appstore|installer|screenshot)\.s[a-f0-9]+$/i.test(id);}
export function rankExternalApps(previous: readonly string[], open: readonly string[], focused?: string): string[] {
    const live = new Set(open.map(id => id.toLowerCase()).filter(id => !isSystemApp(id)));
    const result = [...new Set(previous.map(id => id.toLowerCase()).filter(id => live.has(id)))];
    for (const id of live) if (!result.includes(id)) result.push(id);
    const active = focused?.toLowerCase();
    return active && live.has(active) ? [active, ...result.filter(id => id !== active)] : result;
}
