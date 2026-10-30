import {React, Gtk, Gio, GLib, Box, Label, Button, Entry, Image, ComboBoxText, ScrolledWindow, useEffect, useState} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {powerCapabilities, requestPower, type PowerAction} from '../../legacy/power.js';
import {brandIcon} from './login-view.js';
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

export interface PowerControls {capabilities(): Promise<Record<PowerAction, boolean>>; request(action: PowerAction): Promise<void>;}
const greeterPower: PowerControls = {capabilities: () => powerCapabilities(true), request: action => requestPower(action, true)};
const powerLabels: Record<PowerAction, string> = {sleep: 'Sleep', restart: 'Restart', shutdown: 'Shutdown'};
const powerIcons: Record<PowerAction, string> = {sleep: 'weather-clear-night-symbolic', restart: 'system-reboot-symbolic', shutdown: 'system-shutdown-symbolic'};
// Restart and Shutdown confirm like the panel's power menu; Sleep is harmless and runs at once.
export function GreeterPower({power}: {power: PowerControls}) {
    const [available, setAvailable] = useState<Record<PowerAction, boolean>>({sleep: false, restart: false, shutdown: false});
    const [selected, select] = useState<PowerAction | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    useEffect(() => {let alive = true; void power.capabilities().then(value => {if (alive) setAvailable(value);}).catch(() => undefined); return () => {alive = false;};}, [power]);
    const run = (action: PowerAction) => {setBusy(true); setError(''); void power.request(action).then(() => select(null)).catch(reason => setError(String(reason))).finally(() => setBusy(false));};
    return <Box className="login-power" orientation="vertical" spacing={8} halign="end">
        <Box spacing={8} halign="end">{(Object.keys(powerLabels) as PowerAction[]).map(action => <Button key={action} id={`login-power-${action}`} className="login-secondary" sensitive={available[action] && !busy} tooltip={available[action] ? powerLabels[action] : `${powerLabels[action]} is unavailable on this system`} onClicked={() => {setError(''); if (action === 'sleep') run(action); else select(action);}}><Box spacing={6}><Image iconName={powerIcons[action]} pixelSize={16} /><Label>{powerLabels[action]}</Label></Box></Button>)}</Box>
        {selected && <Box spacing={8} halign="end"><Label>{powerLabels[selected]} this device?</Label><Button id="login-power-cancel" sensitive={!busy} onClicked={() => select(null)}>Cancel</Button><Button id="login-power-confirm" className="login-primary" sensitive={!busy} onClicked={() => run(selected)}>{busy ? 'Please wait…' : powerLabels[selected]}</Button></Box>}
        {!!error && <Label id="login-power-error" className="login-error" wrap maxWidthChars={44}>{error}</Label>}
    </Box>;
}

export function OSLogin({onContinue, controls, createEnrollmentControls, power}: {onContinue(): void; controls?: GreeterControls; createEnrollmentControls?(): GreeterControls; power?: PowerControls}) {
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
        <Box className="login-topbar" spacing={10}><Image className="login-brand" gicon={brandIcon} pixelSize={34} /><Label className="login-wordmark">DevOs</Label></Box>
        <ScrolledWindow expand fill hscrollbarPolicy={Gtk.PolicyType.NEVER}><Box orientation="vertical" valign="center" halign="center" expand fill marginTop={24} marginBottom={24}>
            <Box className="login-card" widthRequest={440} orientation="vertical" spacing={18}>
                <Label className="login-eyebrow">YOUR PERSONAL WORKSPACE</Label><Label className="login-title">Sign in to DevOs</Label>
                {creating ? <NewUserWizard createControls={createEnrollmentControls ?? (() => new GreeterBridge())} onBusy={setEnrolling} onCreated={created => {setCreating(false); setUsername(created); void backend.request('get').then(setState).catch(reason => setError(String(reason)));}} /> : <Box orientation="vertical" spacing={14}>
                    <AccountAvatar githubId={state.users?.find(user => user.username === username)?.githubId} size={72} /><ComboBoxText id="os-login-user" sensitive={!busy && !code} activeId={username} items={(state.users ?? []).filter(user => user.username !== 'devos').map(user => ({id: user.username, text: `${user.name} · ${user.github ? '@' + user.github : user.username}`}))} onChanged={widget => setUsername(widget.get_active_id() ?? '')} />
                    {code ? <Box className="login-code-card" orientation="vertical" spacing={12}><Label className="login-code" selectable>{code}</Label><Label className="login-subtitle" wrap>Authorize at github.com/login/device on this or another device.</Label><Button id="os-login-cancel" sensitive={!busy} onClicked={() => {setCode(''); void perform('cancel');}}>Cancel</Button></Box> : <Box orientation="vertical" spacing={12}>
                        <Entry id="os-login-password" password text={password} placeholder="Local password" sensitive={!busy && !!username} onChanged={entry => setPassword(entry.get_text())} onActivate={() => {if (!busy && username && password) void perform('password');}} />
                        <Button id="os-login-local" className="login-primary" sensitive={!busy && !!username && !!password} onClicked={() => {void perform('password');}}>Sign in</Button>
                        <Button id="os-login-github" className="login-secondary" sensitive={!busy && !!username && username !== 'root'} onClicked={() => {void perform('begin');}}>Sign in with linked GitHub</Button>
                        {state.liveRoot && username === 'root' && <Label id="os-login-live-hint" className="login-subtitle" wrap maxWidthChars={44}>Live USB only: sign in as root with the password "root". Installed systems keep root locked.</Label>}
                        <Label className="login-subtitle" wrap maxWidthChars={44}>Each user has a separate home folder. Link GitHub from Accounts after your first local sign-in.</Label>
                    </Box>}
                </Box>}
                {!code && <Button id="os-login-new-user" className="login-secondary" sensitive={!busy && !enrolling} onClicked={() => {setCreating(!creating); setError('');}}>{creating ? 'Back to sign in' : 'New user'}</Button>}
                {!!error && <Label id="os-login-error" className="login-error" wrap maxWidthChars={44}>{error}</Label>}
                <Button id="os-login-guest" className="login-secondary" sensitive={!busy && !code && !enrolling} onClicked={() => {void perform('guest');}}>Continue as Guest</Button>
            </Box>
        </Box></ScrolledWindow>
        <Box className="login-bottom" spacing={12}><Label>DEVOS / LINUX USER LOGIN</Label><Box expand fill /><GreeterPower power={power ?? greeterPower} /></Box>
    </Box>;
}
