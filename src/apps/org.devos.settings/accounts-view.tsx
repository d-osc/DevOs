import {React, Gtk, Gio, GLib, Box, Label, Button, Image, ScrolledWindow, useEffect, useState} from '@dev-os/core';
import {Accounts, type AccountControls, type AccountResult} from './accounts.js';
import {LoginView} from './login-view.js';
import {AccountAvatar} from './avatar.js';
import {UsersSettings} from './users-view.js';
import {NewUserWizard} from './new-user.js';
import {GreeterBridge, type GreeterControls} from './os-login.js';

export function AccountsSettings({controls, onContinue, createEnrollmentControls, switchUser}: {controls?: AccountControls; onContinue?(): void; createEnrollmentControls?(): GreeterControls; switchUser?(username?: string): void}) {
    const [backend] = useState(() => controls ?? new Accounts());
    const [state, setState] = useState<AccountResult>({});
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(true), [error, setError] = useState('');
    const [generation, setGeneration] = useState(0);
    const [creating, setCreating] = useState(false), [notice, setNotice] = useState('');
    const [enrolling, setEnrolling] = useState(false), [selectedUser, setSelectedUser] = useState('');
    useEffect(() => {let alive = true; void backend.request('get').then(value => {if (alive) setState(value);}).catch(reason => {if (alive) setError(String(reason));}).finally(() => {if (alive) setBusy(false);}); return () => {alive = false; backend.destroy();};}, [backend]);
    useEffect(() => {
        if (!code) return;
        let alive = true, timer = 0;
        const poll = async () => {
            try {const value = await backend.request('poll'); if (!alive) return;
                if (value.pending) schedule(value.interval ?? 5);
                else {setState(value); setCode(''); setBusy(false); onContinue?.();}
            } catch (reason) {if (alive) {setError(String(reason)); setCode(''); setBusy(false);}}
        };
        const schedule = (seconds: number) => {timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {timer = 0; void poll(); return GLib.SOURCE_REMOVE;});};
        schedule(5);
        return () => {alive = false; if (timer) GLib.source_remove(timer);};
    }, [code, generation, backend]);
    const perform = async (action: string, data?: object) => {
        setBusy(true); setError('');
        try {
            const value = await backend.request(action, undefined, {...data, link: !onContinue && state.system?.available === true});
            if (action === 'begin') {setCode(value.code ?? ''); setGeneration(value => value + 1); Gio.AppInfo.launch_default_for_uri('https://github.com/login/device', null);}
            else {setState(value); setCode(''); if (action === 'guest') onContinue?.(); if (action === 'create-user') {setCreating(false); setNotice('User created. Start a Linux session as the new user to use its personal desktop.');}}
        } catch (reason) {setError(String(reason));}
        finally {setBusy(false);}
    };
    const currentUser = state.system?.currentUser ?? '';
    const selected = selectedUser || currentUser;
    const created = (username: string) => {setCreating(false); setSelectedUser(username); setNotice(`User ${username} created. On WSL, start a Linux session as this user to open its desktop.`); void backend.request('get').then(setState).catch(reason => setError(String(reason)));};
    if (onContinue) return <LoginView busy={busy || enrolling} configured={!!state.clientId && (!selected || selected === currentUser)} code={code} error={error}
        continueLabel={currentUser ? `Continue as ${selected}` : undefined} canContinue={!selected || selected === currentUser}
        profiles={state.system && <Box orientation="vertical" spacing={8}><Label className="login-eyebrow" xalign={0}>ACCOUNTS ON THIS DEVICE</Label>{state.system.users.map(user => <Button id={`login-profile-${user.username}`} key={user.username} className={`login-profile ${selected === user.username ? 'login-profile-selected' : ''}`} sensitive={!busy && !enrolling && !code} onClicked={() => setSelectedUser(user.username)}><Box spacing={10}><AccountAvatar githubId={user.githubId} size={40} /><Box orientation="vertical" spacing={3} expand><Label xalign={0}>{user.name}</Label><Label className="login-subtitle" xalign={0}>{user.github ? `@${user.github}` : user.username}{user.username === currentUser ? ' Â· Current OS user' : ''}</Label></Box></Box></Button>)}{selected !== currentUser && <Label className="login-subtitle" wrap maxWidthChars={40}>This WSL session runs as {currentUser}. Start WSL as {selected} to use that userâ€™s desktop.</Label>}</Box>}
        notice={notice} onNewUser={() => {setCreating(!creating); setError(''); setNotice('');}}
        newUser={creating ? <NewUserWizard createControls={createEnrollmentControls ?? (() => new GreeterBridge())} onBusy={setEnrolling} onCreated={created} /> : undefined}
        perform={action => {if (action === 'cancel') setCode(''); void perform(action);}}
        openBrowser={() => {try {Gio.AppInfo.launch_default_for_uri('https://github.com/login/device', null);} catch (reason) {setError(String(reason));}}} />;
    const binding = state.system?.binding;
    const profile = state.system?.users.find(user => user.username === currentUser);
    return <Box className="settings-content accounts-page" orientation="vertical" expand fill>
        <Box className="settings-page-header" spacing={16}>
            <Box orientation="vertical" spacing={6} expand><Label className="settings-eyebrow" xalign={0}>YOUR PERSONAL SPACE</Label><Label className="heading" xalign={0}>Accounts</Label><Label className="settings-description" xalign={0}>Your profile, sign-in options and people on this device.</Label></Box>
            <Button id="accounts-refresh" valign="center" tooltip="Refresh accounts" sensitive={!busy && !code} onClicked={() => {void perform('get');}}><Image iconName="view-refresh-symbolic" pixelSize={18} /></Button>
        </Box>
        <ScrolledWindow expand fill hscrollbarPolicy={Gtk.PolicyType.NEVER}>
            <Box className="settings-form" orientation="vertical" spacing={18}>
                <Box className="accounts-hero" spacing={18}>
                    <AccountAvatar githubId={binding?.id ?? state.identity?.id} size={64} />
                    <Box orientation="vertical" spacing={7} expand valign="center"><Label className="accounts-overline" xalign={0}>CURRENT PROFILE</Label><Label id="accounts-name" className="accounts-profile-name" xalign={0} wrap>{profile?.name ?? (currentUser || state.identity?.name || 'Loading…')}</Label><Label className="settings-description" xalign={0}>{binding ? `@${binding.login} · ${currentUser}` : currentUser || 'Local profile'}</Label></Box>
                    <Label className={`accounts-status ${binding ? 'accounts-status-connected' : ''}`} valign="start">{binding ? 'GITHUB LINKED' : 'LOCAL ACCOUNT'}</Label>
                </Box>
                <Box className="settings-card" orientation="vertical">
                    <Box className="settings-card-header" spacing={12}><Image iconName="network-workgroup-symbolic" pixelSize={22} /><Box orientation="vertical" spacing={4} expand><Label className="section-heading" xalign={0}>GitHub sign-in</Label><Label className="settings-description" xalign={0}>Connect your online identity to this OS profile.</Label></Box><Label className={`accounts-status ${binding ? 'accounts-status-connected' : ''}`}>{binding ? 'Connected' : 'Not connected'}</Label></Box>
                    <Box className="accounts-card-body" orientation="vertical" spacing={14}>
                        <Label className="settings-description" xalign={0} wrap maxWidthChars={68}>{binding ? `Signed in with @${binding.login}. You can use GitHub or your local password at the DevOs login screen.` : 'Sign in through your browser to link GitHub. DevOs uses your public profile to identify you.'}</Label>
                        <Box spacing={10}><Button id="accounts-github" className={binding ? '' : 'settings-primary'} sensitive={!busy && !code && !!state.clientId && (!state.system?.available || !['devos', 'root', 'devos-greeter'].includes(currentUser))} onClicked={() => {void perform('begin');}}>{binding ? 'Reconnect GitHub' : state.system?.available ? 'Connect GitHub' : 'Sign in with GitHub'}</Button>
                        {binding && <Button id="accounts-unlink" sensitive={!busy && !code} onClicked={() => {void perform('unlink');}}>Unlink account</Button>}</Box>
                        {currentUser === 'devos' && <Label className="settings-description" xalign={0} wrap>Create a personal user to connect GitHub. The public Guest profile stays separate.</Label>}
                        {!!code && <Box className="accounts-auth-code" orientation="vertical" spacing={12}><Label className="settings-eyebrow" xalign={0}>VERIFY IN YOUR BROWSER</Label><Label className="login-code" id="accounts-code" selectable>{code}</Label><Label className="settings-description" xalign={0} wrap>Enter this code at github.com/login/device. Waiting for your approval…</Label><Box spacing={10}><Button onClicked={() => Gio.AppInfo.launch_default_for_uri('https://github.com/login/device', null)}>Open GitHub</Button><Button id="accounts-cancel" sensitive={!busy} onClicked={() => {setCode(''); void perform('cancel');}}>Cancel</Button></Box></Box>}
                        {state.identity?.provider === 'github' && <Box spacing={10}><Label className="settings-description" xalign={0} wrap expand>Online sign-out keeps your OS login link. Use Unlink to remove it.</Label><Button id="accounts-signout" sensitive={!busy && !code} onClicked={() => {void perform('signout');}}>Sign out online</Button></Box>}
                    </Box>
                </Box>
                {state.system && <UsersSettings createEnrollmentControls={createEnrollmentControls} switchUser={switchUser} system={state.system} busy={busy || !!code} perform={perform} />}
                <Box className="accounts-security-note" spacing={12}><Image iconName="changes-allow-symbolic" pixelSize={20} valign="start" /><Box orientation="vertical" spacing={5} expand><Label className="section-heading" xalign={0}>Your local password stays with you</Label><Label className="settings-description" xalign={0} wrap maxWidthChars={68}>Use it for offline login and screen lock. Changing users or GitHub links requires administrator approval when needed.</Label></Box></Box>
                {!!error && <Label id="accounts-error" className="settings-error-banner" xalign={0} wrap>{error}</Label>}
            </Box>
        </ScrolledWindow>
    </Box>;
}
