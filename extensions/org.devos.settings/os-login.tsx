import {React, Gtk, Gio, GLib, Box, Label, Button, Entry, ComboBoxText, ScrolledWindow, useEffect, useState} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {AccountAvatar} from './avatar.js';
import {NewUserWizard} from './new-user.js';

export interface GreeterResult {liveRoot?: boolean; users?: {username: string; name: string; uid: number; home: string; github?: string; githubId?: number}[]; firstSetup?: boolean; code?: string; pending?: boolean; interval?: number; started?: boolean; verified?: boolean; github?: string; githubId?: number; username?: string; created?: boolean;}
export interface GreeterControls {request(action: string, data?: object): Promise<GreeterResult>; destroy(): void;}
export class GreeterBridge implements GreeterControls {
    private process: Gio.Subprocess;
    private input: Gio.DataInputStream;
    private output: Gio.OutputStream;
    private pending: Promise<unknown> = Promise.resolve();
    constructor() {
        const local = `${ROOT}/bin/dev-os-greeter-backend`;
        const helper = GLib.file_test(local, GLib.FileTest.IS_REGULAR) ? local : '/usr/bin/dev-os-greeter-backend';
        this.process = Gio.Subprocess.new(['d', helper], Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE);
        this.output = this.process.get_stdin_pipe()!;
        this.input = new Gio.DataInputStream({base_stream: this.process.get_stdout_pipe()!});
    }
    request(action: string, data?: object): Promise<GreeterResult> {
        const result = this.pending.then(() => this.send(action, data));
        this.pending = result.catch(() => undefined);
        return result;
    }
    private send(action: string, data?: object): Promise<GreeterResult> {
        return new Promise((resolve, reject) => {
            try {this.output.write_all(new TextEncoder().encode(JSON.stringify({...data, action}) + '\n'), null);
                this.input.read_line_async(GLib.PRIORITY_DEFAULT, null, (_source, result) => {
                    try {const [line] = this.input.read_line_finish_utf8(result); const value = JSON.parse(line || '{}'); if (!value.ok) throw new Error(value.error || 'Login service disconnected.'); resolve(value);}
                    catch (error) {reject(error);}
                });
            } catch (error) {reject(error);}
        });
    }
    destroy() {this.process.force_exit();}
}

export function OSLogin({onContinue, controls, createEnrollmentControls}: {onContinue(): void; controls?: GreeterControls; createEnrollmentControls?(): GreeterControls}) {
    const [backend] = useState(() => controls ?? new GreeterBridge());
    const [state, setState] = useState<GreeterResult>({}), [username, setUsername] = useState(''), [password, setPassword] = useState('');
    const [busy, setBusy] = useState(true), [error, setError] = useState(''), [code, setCode] = useState('');
    const [creating, setCreating] = useState(false);
    const [enrolling, setEnrolling] = useState(false);
    useEffect(() => {let alive = true; void backend.request('get').then(value => {if (alive) {setState(value); setUsername(value.users?.find(user => user.username !== 'devos')?.username ?? '');}}).catch(reason => {if (alive) setError(String(reason));}).finally(() => {if (alive) setBusy(false);}); return () => {alive = false; backend.destroy();};}, [backend]);
    const perform = async (action: string, data?: object) => {
        setBusy(true); setError('');
        try {const value = await backend.request(action, {username, password, ...data});
            if (value.started) onContinue();
            else if (value.code) {setCode(value.code); try {Gio.AppInfo.launch_default_for_uri('https://github.com/login/device', null);} catch { /* The code can also be entered on another device. */ }}
            else {if (action === 'cancel') setCode(''); if (value.users) {setState(value); setUsername(value.users.find(user => user.username !== 'devos')?.username ?? ''); if (action === 'create-user') setCreating(false);}}
        } catch (reason) {setError(String(reason));}
        finally {setPassword(''); setBusy(false);}
    };
    useEffect(() => {
        if (!code) return;
        let alive = true, timer = 0;
        const schedule = (seconds: number) => {timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {timer = 0; void backend.request('poll').then(value => {if (!alive) return; if (value.started) onContinue(); else schedule(value.interval ?? 5);}).catch(reason => {if (alive) {setCode(''); setError(String(reason));}}); return GLib.SOURCE_REMOVE;});};
        schedule(5);
        return () => {alive = false; if (timer) GLib.source_remove(timer);};
    }, [code, backend]);
    return <Box className="login-screen" orientation="vertical" expand fill>
        <Box className="login-topbar" spacing={10}><Label className="login-brand">D</Label><Label className="login-wordmark">DevOs</Label></Box>
        <ScrolledWindow expand fill hscrollbarPolicy={Gtk.PolicyType.NEVER}><Box orientation="vertical" valign="center" halign="center" expand fill marginTop={24} marginBottom={24}>
            <Box className="login-card" widthRequest={440} orientation="vertical" spacing={18}>
                <Label className="login-eyebrow">YOUR PERSONAL WORKSPACE</Label><Label className="login-title">Sign in to DevOs</Label>
                {creating ? <NewUserWizard createControls={createEnrollmentControls ?? (() => new GreeterBridge())} onBusy={setEnrolling} onCreated={created => {setCreating(false); setUsername(created); void backend.request('get').then(setState).catch(reason => setError(String(reason)));}} /> : <Box orientation="vertical" spacing={14}>
                    <AccountAvatar githubId={state.users?.find(user => user.username === username)?.githubId} size={72} /><ComboBoxText id="os-login-user" sensitive={!busy && !code} activeId={username} items={(state.users ?? []).filter(user => user.username !== 'devos').map(user => ({id: user.username, text: `${user.name} · ${user.github ? '@' + user.github : user.username}`}))} onChanged={widget => setUsername(widget.get_active_id() ?? '')} />
                    {code ? <Box className="login-code-card" orientation="vertical" spacing={12}><Label className="login-code" selectable>{code}</Label><Label className="login-subtitle" wrap>Authorize at github.com/login/device on this or another device.</Label><Button id="os-login-cancel" sensitive={!busy} onClicked={() => {setCode(''); void perform('cancel');}}>Cancel</Button></Box> : <Box orientation="vertical" spacing={12}>
                        <Entry id="os-login-password" password text={password} placeholder="Local password" sensitive={!busy && !!username} onChanged={entry => setPassword(entry.get_text())} onActivate={() => {if (!busy && username && password) void perform('password');}} />
                        <Button id="os-login-local" className="login-primary" sensitive={!busy && !!username && !!password} onClicked={() => {void perform('password');}}>Sign in</Button>
                        <Button id="os-login-github" className="login-secondary" sensitive={!busy && !!username && username !== 'root'} onClicked={() => {void perform('begin');}}>Sign in with linked GitHub</Button>
                        <Label className="login-subtitle" wrap maxWidthChars={44}>Each user has a separate home folder. Link GitHub from Accounts after your first local sign-in.</Label>
                    </Box>}
                </Box>}
                {!code && <Button id="os-login-new-user" className="login-secondary" sensitive={!busy && !enrolling} onClicked={() => {setCreating(!creating); setError('');}}>{creating ? 'Back to sign in' : 'New user'}</Button>}
                {!!error && <Label id="os-login-error" className="login-error" wrap maxWidthChars={44}>{error}</Label>}
                <Button id="os-login-guest" className="login-secondary" sensitive={!busy && !code && !enrolling} onClicked={() => {void perform('guest');}}>Continue as Guest</Button>
            </Box>
        </Box></ScrolledWindow>
        <Box className="login-bottom"><Label>DEVOS / LINUX USER LOGIN</Label></Box>
    </Box>;
}
