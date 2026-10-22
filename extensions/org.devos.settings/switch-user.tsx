import {React, Gtk, Gio, GLib, Box, Label, Button, ComboBoxText, createRoot, useEffect, useState, type UIContext} from '@dev-os/core';
import {Accounts, type AccountControls, type AccountResult} from './accounts.js';
import {AccountAvatar} from './avatar.js';

export function SwitchUserView({controls, initialUser, wsl, switchUser, cancel}: {controls: AccountControls; initialUser?: string; wsl: boolean; switchUser(username: string): Promise<void>; cancel(): void}) {
    const [system, setSystem] = useState<AccountResult['system']>();
    const [selected, select] = useState(initialUser ?? ''), [busy, setBusy] = useState(true), [error, setError] = useState('');
    useEffect(() => {let alive = true; void controls.request('get').then(value => {if (!alive) return; setSystem(value.system); select(initialUser ?? value.system?.users.find(user => user.username !== value.system?.currentUser && user.username !== 'devos')?.username ?? '');}).catch(reason => {if (alive) setError(String(reason));}).finally(() => {if (alive) setBusy(false);}); return () => {alive = false; controls.destroy();};}, [controls]);
    return <Box className="settings-content" orientation="vertical" spacing={18} borderWidth={24}>
        <Label className="heading" xalign={0}>Switch OS user</Label>
        <AccountAvatar githubId={system?.users.find(user => user.username === selected)?.githubId} size={64} />
        <ComboBoxText id="switch-user-choice" activeId={selected} sensitive={!busy} items={(system?.users ?? []).filter(user => user.username !== system?.currentUser && user.username !== 'devos').map(user => ({id: user.username, text: `${user.name} · ${user.github ? '@' + user.github : user.username}`}))} onChanged={widget => select(widget.get_active_id() ?? '')} />
        <Label className="settings-description" xalign={0} wrap maxWidthChars={52}>{wsl ? 'Open a new DevOs desktop as the selected Linux user. Your current desktop stays open; you can lock it from the session menu.' : 'Switching signs out of this desktop and closes its applications. Save your work first, then select the user on the login screen.'}</Label>
        {!busy && !selected && <Label className="settings-description" xalign={0} wrap>Add another user in Settings → Accounts before switching.</Label>}
        {!!error && <Label id="switch-user-error" className="settings-error-banner" wrap maxWidthChars={52}>{error}</Label>}
        <Box spacing={12} halign="end"><Button sensitive={!busy} onClicked={cancel}>Cancel</Button><Button id="switch-user-confirm" className="settings-primary" sensitive={!busy && !!selected} onClicked={() => {setBusy(true); setError(''); void switchUser(selected).catch(reason => setError(String(reason))).finally(() => setBusy(false));}}>Switch user</Button></Box>
    </Box>;
}

export class UserSwitcher {
    private window?: Gtk.ApplicationWindow;
    private root?: ReturnType<typeof createRoot>;
    constructor(private context: UIContext) {}
    show(username?: string) {
        if (this.window) {this.window.present(); return;}
        const window = new Gtk.ApplicationWindow({application: this.context.application, title: 'Switch OS user', default_width: 480, resizable: false}); window.name = 'settings';
        this.window = window; this.root = createRoot(window);
        const wsl = !!GLib.getenv('WSL_DISTRO_NAME') || !!GLib.getenv('WSL_INTEROP');
        this.root.render(<SwitchUserView controls={new Accounts()} initialUser={username} wsl={wsl} cancel={() => this.destroy()} switchUser={async target => {
            if (wsl) {
                const project = GLib.getenv('DEV_OS_WINDOWS_PROJECT');
                if (!project) throw new Error('Restart DevOs with dev.ps1 run to enable WSL user switching.');
                if (!/^[a-z][a-z0-9_-]{0,30}$/.test(target) || ['root', 'devos-greeter', 'nobody'].includes(target)) throw new Error('Select a personal Linux user.');
                const process = Gio.Subprocess.new(['/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${project}\\bin\\dev-os-switch-user.ps1`, '-User', target], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
                await new Promise<void>((resolve, reject) => process.communicate_utf8_async(null, null, (_source, result) => {try {const [, , error] = process.communicate_utf8_finish(result); if (!process.get_successful()) throw new Error(error || 'Could not open the selected user session.'); resolve();} catch (reason) {reject(reason);}}));
                this.destroy();
            } else {this.destroy(); this.context.quit();}
        }} />);
        window.connect('delete-event', () => {this.destroy(); return true;}); window.show_all(); window.present();
    }
    destroy() {this.root?.unmount(); this.root = undefined; this.window?.destroy(); this.window = undefined;}
}
