import {React, Box, Label, Button, useState} from '@dev-os/core';
import {AccountAvatar} from './avatar.js';
import type {AccountResult} from './accounts.js';
import {GreeterBridge, type GreeterControls} from './os-login.js';
import {NewUserWizard} from './new-user.js';

export function UsersSettings({system, busy, perform, embedded = false, createEnrollmentControls, switchUser}: {system: NonNullable<AccountResult['system']>; busy: boolean; perform(action: string, data?: object): Promise<void>; embedded?: boolean; createEnrollmentControls?(): GreeterControls; switchUser?(username?: string): void}) {
    const [adding, setAdding] = useState(embedded), [enrolling, setEnrolling] = useState(false);
    return <Box className="settings-card accounts-users" orientation="vertical">
        {!embedded && <Box className="settings-card-header" spacing={12}><Box orientation="vertical" spacing={5} expand><Label className="section-heading" xalign={0}>People on this device</Label><Label className="settings-description" xalign={0}>{system.users.length} profiles · Separate files and settings</Label></Box><Button id="accounts-add-user" className="settings-primary" sensitive={system.available && !busy && !enrolling} onClicked={() => setAdding(!adding)}>{adding ? 'Close' : 'Add user'}</Button></Box>}
        {!embedded && system.users.map(user => <Box className="accounts-user-row" key={user.username} spacing={14}>
            <AccountAvatar githubId={user.githubId} size={40} />
            <Box orientation="vertical" spacing={5} expand valign="center"><Box spacing={10}><Label className="section-heading" xalign={0} wrap>{user.name}</Label>{user.username === system.currentUser && <Label className="accounts-you">YOU</Label>}</Box><Label className="settings-description" xalign={0}>{user.github ? `@${user.github} · GitHub` : `${user.username} · Local account`}</Label></Box>
            {switchUser && user.username !== system.currentUser && user.username !== 'devos' && <Button id={`accounts-switch-${user.username}`} sensitive={!busy && !enrolling} valign="center" onClicked={() => switchUser(user.username)}>Switch user</Button>}
        </Box>)}
        {!system.available && <Box className="accounts-card-body"><Label className="settings-description" xalign={0} wrap>User management is unavailable in this session.</Label></Box>}
        {adding && <Box className="accounts-card-body" orientation="vertical"><NewUserWizard createControls={createEnrollmentControls ?? (() => new GreeterBridge())} onBusy={setEnrolling} onCreated={() => {setAdding(false); void perform('get');}} /></Box>}
        {!embedded && <Box className="accounts-users-footer"><Label className="settings-description" xalign={0} wrap>Switch profiles here or from the account button on your panel.</Label></Box>}
    </Box>;
}
