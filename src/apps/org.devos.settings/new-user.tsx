import {React, Gio, GLib, Box, Label, Button, Entry, useState, useEffect} from '@dev-os/core';
import {AccountAvatar} from './avatar.js';
import type {GreeterControls, GreeterResult} from './os-login.js';

export function NewUserWizard({createControls, onCreated, onBusy, openAuthorization}: {createControls(): GreeterControls; onCreated(username: string): void; onBusy?(busy: boolean): void; openAuthorization?(): void}) {
    const [backend] = useState(createControls);
    const [provider, setProvider] = useState<'guest' | 'github' | null>(null);
    const [githubId, setGithubId] = useState<number | undefined>();
    const [code, setCode] = useState(''), [github, setGithub] = useState('');
    const [username, setUsername] = useState(''), [name, setName] = useState('');
    const [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    useEffect(() => () => backend.destroy(), [backend]);
    useEffect(() => {onBusy?.(busy); return () => onBusy?.(false);}, [busy]);
    const verified = (value: GreeterResult) => {setGithub(value.github ?? ''); setGithubId(value.githubId); setUsername(value.username ?? ''); setCode('');};
    const openBrowser = () => {try {if (openAuthorization) openAuthorization(); else Gio.AppInfo.launch_default_for_uri('https://github.com/login/device', null);} catch {setError('Open github.com/login/device on this or another device and enter the code.');}};
    useEffect(() => {
        if (!code) return;
        let alive = true, timer = 0;
        const schedule = (interval: number) => {timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            timer = 0; void backend.request('enroll-poll').then(value => {if (!alive) return; if (value.verified) verified(value); else schedule(value.interval ?? 5);}).catch(reason => {if (alive) {setCode(''); setProvider(null); setError(String(reason));}});
            return GLib.SOURCE_REMOVE;
        });};
        schedule(5);
        return () => {alive = false; if (timer) GLib.source_remove(timer);};
    }, [code, backend]);
    const begin = async () => {
        setBusy(true); setError(''); setProvider('github');
        try {const result = await backend.request('enroll-begin'); setCode(result.code ?? ''); openBrowser();}
        catch (reason) {setProvider(null); setError(String(reason));}
        finally {setBusy(false);}
    };
    const reset = async () => {
        setCode(''); setGithub(''); setPassword(''); setConfirm(''); setUsername(''); setName(''); setProvider(null); setError('');
        try {await backend.request('cancel');} catch (reason) {setError(String(reason));}
    };
    const create = async () => {
        setBusy(true); setError('');
        const data = {provider, username, name, password}; setPassword(''); setConfirm('');
        try {const result = await backend.request('enroll-create', data); if (!result.created || !result.username) throw new Error('The OS user was not created.'); onCreated(result.username);}
        catch (reason) {setError(String(reason));}
        finally {setBusy(false);}
    };
    const details = provider === 'guest' || !!github;
    return <Box orientation="vertical" spacing={14}>
        <Label className="section-heading" xalign={0}>New user</Label>
        {!provider && <Box orientation="vertical" spacing={12}>
            <Label className="login-subtitle" wrap maxWidthChars={40}>Choose an account for your personal OS profile.</Label>
            <Button id="new-user-github" className="login-primary" sensitive={!busy} onClicked={() => {void begin();}}>Use GitHub</Button>
            <Button id="new-user-guest" className="login-secondary" sensitive={!busy} onClicked={() => {setProvider('guest'); setError('');}}>Use Guest / Local account</Button>
        </Box>}
        {!!code && <Box className="login-code-card" orientation="vertical" spacing={10}>
            <Label id="new-user-code" className="login-code" selectable>{code}</Label><Label className="login-subtitle" wrap maxWidthChars={38}>Verify your GitHub account first at github.com/login/device.</Label>
            <Button onClicked={openBrowser}>Open GitHub</Button><Label className="login-subtitle">Waiting for GitHub authorization…</Label>
        </Box>}
        {details && <Box orientation="vertical" spacing={10}>
            {github ? <Box className="login-code-card" orientation="vertical" spacing={6}><AccountAvatar githubId={githubId} size={64} /><Label id="new-user-verified">GitHub verified · @{github}</Label><Label id="new-user-os-name">OS username: {username}</Label>{github.toLowerCase() !== username && <Label className="login-subtitle" wrap maxWidthChars={38}>The username was adjusted to Linux naming limits.</Label>}</Box> : <Box orientation="vertical" spacing={10}>
                <Entry id="accounts-new-name" text={name} placeholder="Display name" sensitive={!busy} onChanged={entry => setName(entry.get_text())} />
                <Entry id="accounts-new-username" text={username} placeholder="OS username" sensitive={!busy} onChanged={entry => setUsername(entry.get_text())} />
            </Box>}
            <Label className="login-subtitle" wrap maxWidthChars={40}>Set your OS password for local login and screen lock.</Label>
            <Entry id="accounts-new-password" password text={password} placeholder="OS password · at least 4 characters" sensitive={!busy} onChanged={entry => setPassword(entry.get_text())} />
            <Entry id="accounts-new-confirm" password text={confirm} placeholder="Confirm OS password" sensitive={!busy} onChanged={entry => setConfirm(entry.get_text())} />
            <Button id="accounts-create-user" className="login-primary" sensitive={!busy && /^[a-z][a-z0-9_-]{0,30}$/.test(username) && password.length >= 4 && password === confirm} onClicked={() => {void create();}}>{busy ? 'Creating user…' : 'Create OS user'}</Button>
        </Box>}
        {provider && <Button id="new-user-back" sensitive={!busy} onClicked={() => {void reset();}}>Choose another account type</Button>}
        {!!error && <Label id="new-user-error" className="login-error" wrap maxWidthChars={40}>{error}</Label>}
    </Box>;
}
