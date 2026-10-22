import {React, Gtk, Box, Label, Button, Image, ScrolledWindow} from '@dev-os/core';

export function LoginView({busy, configured, code, error, perform, openBrowser, newUser, onNewUser, notice, profiles, continueLabel, canContinue = true}: {
    busy: boolean; configured: boolean; code: string; error: string;
    perform(action: string): void; openBrowser(): void;
    newUser?: React.ReactNode; onNewUser?(): void; notice?: string;
    profiles?: React.ReactNode; continueLabel?: string; canContinue?: boolean;
}) {
    return <Box className="login-screen" orientation="vertical" expand fill>
        <Box className="login-topbar" spacing={10}><Label className="login-brand">D</Label><Label className="login-wordmark">DevOs</Label><Label className="login-top-note" xalign={1} expand>Your space to create</Label></Box>
        <ScrolledWindow expand fill hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box orientation="vertical" expand fill halign="center" valign="center" marginTop={24} marginBottom={24}>
                <Box className="login-card" orientation="vertical" spacing={profiles || newUser ? 14 : 20} widthRequest={400}>
                    {!profiles && !newUser && <Box className="login-avatar" halign="center" widthRequest={64} heightRequest={64}><Image iconName={code ? 'dialog-password-symbolic' : 'avatar-default-symbolic'} pixelSize={28} expand /></Box>}
                    <Box orientation="vertical" spacing={9}><Label className="login-eyebrow">{code ? 'ONE MORE STEP' : 'MAKE YOURSELF AT HOME'}</Label><Label className="login-title">{code ? 'Connect your GitHub' : 'Welcome to DevOs'}</Label><Label className="login-subtitle" wrap ref={label => label?.set_justify(Gtk.Justification.CENTER)} maxWidthChars={38}>{code ? 'Enter this code in your browser to finish signing in.' : 'A fresh space for your next idea.\nChoose how you want to get started.'}</Label></Box>
                    {newUser ? newUser : code ? <Box orientation="vertical" spacing={14}>
                        <Box className="login-code-card" orientation="vertical" spacing={8}><Label className="login-code" id="accounts-code" selectable>{code}</Label><Label className="login-subtitle">github.com/login/device</Label></Box>
                        <Button className="login-primary" onClicked={openBrowser}>Open GitHub in browser</Button>
                        <Box spacing={8} halign="center"><Image className="login-wait-icon" iconName="view-refresh-symbolic" pixelSize={14} /><Label className="login-subtitle">Waiting for your approval…</Label></Box>
                        <Button className="login-secondary" id="accounts-cancel" sensitive={!busy} onClicked={() => perform('cancel')}>Back to sign in</Button>
                    </Box> : <Box orientation="vertical" spacing={14}>
                        {profiles}
                        {!profiles && <Button className="login-primary" id="accounts-github" sensitive={!busy && configured} onClicked={() => perform('begin')}><Box spacing={10} halign="center"><Image iconName="network-workgroup-symbolic" pixelSize={18} /><Label>{busy ? 'Please wait…' : 'Continue with GitHub'}</Label><Image iconName="go-next-symbolic" pixelSize={16} /></Box></Button>}
                        {!profiles && <Box className="login-divider" spacing={12}><Box className="login-divider-line" expand valign="center" heightRequest={1} /><Label>or</Label><Box className="login-divider-line" expand valign="center" heightRequest={1} /></Box>}
                        <Button className="login-secondary" id="accounts-guest" sensitive={!busy && canContinue} onClicked={() => perform('guest')}><Box spacing={10} halign="center"><Image iconName="avatar-default-symbolic" pixelSize={17} /><Label>{continueLabel ?? 'Continue as Guest'}</Label></Box></Button>
                        <Label className="login-subtitle" wrap ref={label => label?.set_justify(Gtk.Justification.CENTER)} maxWidthChars={38}>Your files and settings belong to your OS user.</Label>
                    </Box>}
                    {!code && <Button id="login-new-user" className="login-secondary" sensitive={!busy} onClicked={onNewUser}>{newUser ? 'Back to sign in' : 'New user'}</Button>}
                    {!!notice && <Label id="login-notice" className="login-subtitle" wrap maxWidthChars={40}>{notice}</Label>}
                    {!!error && <Label id="accounts-error" className="login-error" xalign={0} wrap maxWidthChars={40}>{error}</Label>}
                    <Box className="login-card-footer" spacing={7} halign="center"><Image iconName="changes-allow-symbolic" pixelSize={13} /><Label>Simple. Personal. Yours.</Label></Box>
                </Box>
                <Label className="login-profile-note" wrap ref={label => label?.set_justify(Gtk.Justification.CENTER)} maxWidthChars={58} marginTop={20}>A personal profile for every OS user.</Label>
            </Box>
        </ScrolledWindow>
        <Box className="login-bottom" spacing={12}><Label>DEVOS / WAYLAND</Label><Label xalign={1} expand>Make room for your ideas.</Label></Box>
    </Box>;
}
