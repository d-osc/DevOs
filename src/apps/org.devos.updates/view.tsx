import {
    Gtk, React, Box, Label, Button,
    Entry, Switch, Image, ScrolledWindow, ProgressBar, useState,
    useEffect, type SettingsHost
} from '@dev-os/core';
import type {Updates} from '@dev-os/updates';
import {SWAYLOCK_RELEASES} from '@dev-os/updates';
import {repository} from '@dev-os/updates/protocol';

/** Ask for an update package with the system file chooser. Resolves to null when cancelled. */
export function chooseUpdateFile(): Promise<string | null> {
    return new Promise(resolve => {
        const dialog = new Gtk.FileChooserDialog({title: 'Choose a Dev OS update file', modal: true, action: Gtk.FileChooserAction.OPEN});
        dialog.set_local_only(true);
        dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
        dialog.add_button('Choose update', Gtk.ResponseType.ACCEPT);
        const filter = new Gtk.FileFilter(); filter.set_name('Update packages (*.tar.gz)'); filter.add_pattern('*.tar.gz'); dialog.add_filter(filter);
        dialog.connect('response', (_dialog, response) => {
            const path = response === Gtk.ResponseType.ACCEPT ? dialog.get_filename() : null;
            dialog.destroy(); resolve(path);
        });
        dialog.show();
    });
}
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export function UpdatesView({updater, preferences, useVersion, chooseFile = chooseUpdateFile}: {updater: Updates; preferences: SettingsHost; useVersion?: (root: string) => Promise<void>; chooseFile?: () => Promise<string | null>}) {
    const id = 'org.devos.updates';
    const [state, setState] = useState(updater.state);
    const [source, setSource] = useState(String(preferences.get(id).state.values.repository));
    const [checkOnOpen, setCheckOnOpen] = useState(preferences.get(id).state.values.checkOnOpen === true);
    const [sourceError, setSourceError] = useState('');
    const [confirmSwitch, setConfirmSwitch] = useState(false);
    const [restartLater, setRestartLater] = useState(false);
    const [restartComputerLater, setRestartComputerLater] = useState(false);
    const [file, setFile] = useState('');
    const [confirmFile, setConfirmFile] = useState(false);
    const [periodic, setPeriodic] = useState(preferences.get(id).state.values.periodicCheck === true);
    useEffect(() => updater.subscribe(() => setState(updater.state)), [updater]);
    useEffect(() => { void updater.refreshSystem(); }, [updater]);
    useEffect(() => { if (preferences.get(id).state.values.checkOnOpen === true && updater.state.status === 'idle') void updater.check(); }, [updater, preferences]);
    const sourceDirty = source !== preferences.get(id).state.values.repository;
    const saveSource = () => {
        try {
            repository(source);
            preferences.update(id, true, {repository: source, checkOnOpen, periodicCheck: periodic}); setSourceError('');
            void updater.check();
        } catch (error) { setSourceError(error instanceof Error ? error.message : String(error)); }
    };
    const canInstall = !sourceDirty && updater.canInstall;
    return <Box className="settings-content" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={14}>
            <Label className="settings-eyebrow" xalign={0}>WORKSPACE / SYSTEM</Label>
            <Box spacing={14}>
                <Box className="settings-page-icon" widthRequest={44} heightRequest={44} valign="center"><Image iconName="software-update-available-symbolic" pixelSize={24} expand /></Box>
                <Box orientation="vertical" spacing={5} expand>
                    <Label className="heading" xalign={0}>System updates</Label>
                    <Label className="settings-description" xalign={0}>Keep Dev OS, its extensions and native dependencies up to date.</Label>
                </Box>
                <Label className="settings-badge badge-on" valign="start">{state.blocked ? 'LIVE USB' : 'STABLE'}</Label>
            </Box>
        </Box>
        <ScrolledWindow expand fill minContentHeight={240} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="settings-form" orientation="vertical" spacing={16}>
                <Box className="settings-card updates-summary" orientation="vertical" spacing={16}>
                    <Box spacing={14}>
                        <Image className={state.error ? 'error' : 'settings-saved'} iconName={state.error ? 'dialog-warning-symbolic' : state.busy ? 'view-refresh-symbolic' : 'software-update-available-symbolic'} pixelSize={30} />
                        <Box orientation="vertical" spacing={5} expand>
                            <Label id="updates-status" className="section-heading" xalign={0} wrap>{state.message}</Label>
                            <Label className="settings-description" xalign={0}>{`Running ${state.running}  ·  Installed ${state.installed}`}</Label>
                        </Box>
                    </Box>
                    {state.error && <Label id="updates-error" className="error" xalign={0} wrap maxWidthChars={65}>{state.error}</Label>}
                    {state.progress !== null && <ProgressBar id="updates-progress" fraction={state.progress} showText text={`${Math.round(state.progress * 100)}%`} />}
                    {state.blocked && <Label id="updates-live" className="settings-description" xalign={0} wrap maxWidthChars={65}>{state.blocked}</Label>}
                    <Box spacing={8}>
                        <Button id="updates-check" sensitive={!state.busy && !sourceDirty} onClicked={() => { void updater.check(); }}>{state.status === 'checking' ? 'Checking…' : 'Check for updates'}</Button>
                        {canInstall && <Button id="updates-install" className="settings-primary" sensitive={!state.busy} onClicked={() => { void updater.install(); }}>Install update</Button>}
                        {state.previous && <Button id="updates-rollback" sensitive={!state.busy} onClicked={() => { void updater.rollback(); }}>Use previous version</Button>}
                    </Box>
                    {state.checked && <Label className="settings-description" xalign={0}>{`Last checked ${new Date(state.checked).toLocaleString()}`}</Label>}
                </Box>
                <Box id="updates-swaylock" className="settings-card" orientation="vertical">
                    <Box className="settings-card-header" spacing={10}>
                        <Image iconName="system-lock-screen-symbolic" pixelSize={18} />
                        <Label className="section-heading" xalign={0} expand>swaylock · Lock screen</Label>
                        <Label className="settings-badge">{`INSTALLED ${state.swaylock.installed ?? 'unknown'}`}</Label>
                    </Box>
                    <Box className="updates-details" orientation="vertical" spacing={10}>
                        <Label id="updates-swaylock-version" className="settings-description" xalign={0} wrap>{`Installed: ${state.swaylock.installed ?? (state.swaylock.latest ? 'Not installed' : 'Unknown')}  ·  Latest upstream: ${state.swaylock.latest ?? 'Unknown'}`}</Label>
                        {state.swaylock.error && <Label className="error" xalign={0} wrap>{state.swaylock.error}</Label>}
                        <Label className="settings-description" xalign={0} wrap>{'Manage swaylock through your Linux distribution. Upstream releases are shown for reference.'}</Label>
                        <Button id="updates-swaylock-releases" onClicked={() => {
                            try { Gtk.show_uri_on_window(null, SWAYLOCK_RELEASES, 0); setSourceError(''); }
                            catch (error) { setSourceError(`Could not open releases: ${String(error)}`); }
                        }}>View swaylock releases</Button>
                    </Box>
                </Box>
                {state.release && <Box className="settings-card" orientation="vertical">
                    <Box className="settings-card-header" spacing={10}><Image iconName="document-new-symbolic" pixelSize={18} /><Label className="section-heading" xalign={0}>{`Dev OS ${state.release.version}`}</Label></Box>
                    <Box className="updates-details" orientation="vertical" spacing={10}>
                        <Label id="updates-release-info" className="settings-description" xalign={0} wrap>{`${state.release.platform}  ·  ${state.patch ? `patch from ${state.patch.from} ${megabytes(state.patch.size)} (full package ${megabytes(state.release.size)})` : megabytes(state.release.size)}  ·  SHA-256 verified before installation  ·  ${state.trust === 'verified' ? 'Signature verified' : state.trust === 'unsigned' ? 'Not signed (checksum only)' : 'Signature checked when installing'}`}</Label>
                        <Label xalign={0} wrap selectable maxWidthChars={75}>{state.release.notes || 'This release has no release notes.'}</Label>
                    </Box>
                </Box>}
                <Box id="updates-system" className="settings-card" orientation="vertical">
                    <Box className="settings-card-header" spacing={10}>
                        <Image iconName="computer-symbolic" pixelSize={18} /><Label className="section-heading" xalign={0} expand>System · kernel, firmware, boot image</Label>
                        <Label className="settings-badge">{state.system.supported ? `INSTALLED ${state.system.version}` : 'NOT AVAILABLE'}</Label>
                    </Box>
                    <Box className="updates-details" orientation="vertical" spacing={10}>
                        {!state.system.supported && <Label id="updates-system-reason" className="settings-description" xalign={0} wrap>{state.system.reason || 'Checking the system update helper…'}</Label>}
                        {state.system.supported && <Label id="updates-system-info" className="settings-description" xalign={0} wrap>{`Running kernel ${state.system.kernel}. Updates replace the boot image (kernel, initramfs, bootloader stub), firmware and system files, and take effect after a restart.`}</Label>}
                        {state.system.offer && <Box orientation="vertical" spacing={6}>
                            <Label id="updates-system-offer" className="section-heading" xalign={0} wrap>{`System update ${state.system.offer.version}: ${state.system.offer.components.join(', ')}${state.system.offer.kernel ? ` · kernel ${state.system.offer.kernel}` : ''} · ${megabytes(state.system.offer.size)} · ${state.system.offer.files} files`}</Label>
                            <Label className="settings-description" xalign={0} wrap>{state.system.safeBoot
                                ? 'The new boot image starts once. If it does not boot, the next start returns to the current system automatically.'
                                : 'This computer cannot try the new boot image once (no UEFI boot manager): the old image is kept as a copy only. Keep a Live USB at hand.'}</Label>
                            <Box spacing={8}><Button id="updates-install-system" className="settings-primary" sensitive={!state.busy && !state.blocked && state.system.pending === ''} onClicked={() => { void updater.installSystem(); }}>Install system update</Button></Box>
                        </Box>}
                        {state.system.pending && <Label id="updates-system-pending" className="settings-description" xalign={0} wrap>{`System update ${state.system.pending} is installed and waits for a restart.`}</Label>}
                        {state.system.lastError && <Label id="updates-system-error" className="error" xalign={0} wrap>{state.system.lastError}</Label>}
                        <Box spacing={8}>
                            {state.system.pending && <Button id="updates-system-cancel" sensitive={!state.busy} onClicked={() => { void updater.cancelSystem(); }}>Cancel system update</Button>}
                            {state.system.canRollback && !state.system.pending && <Button id="updates-system-rollback" sensitive={!state.busy} onClicked={() => { void updater.rollbackSystem(); }}>Restore previous system</Button>}
                        </Box>
                    </Box>
                </Box>
                {state.system.restart && !restartComputerLater && <Box id="updates-restart-card" className="settings-card updates-details" orientation="vertical" spacing={10}>
                    <Label className="section-heading" xalign={0}>Restart the computer to finish the system update</Label>
                    <Label className="settings-description" xalign={0} wrap>Save your work first: the computer restarts and all apps close. Your files and preferences are kept.</Label>
                    <Box spacing={8}>
                        <Button id="updates-restart-computer" className="settings-primary" sensitive={!state.busy} onClicked={() => { void updater.restartComputer(); }}>Restart now</Button>
                        <Button id="updates-restart-computer-later" sensitive={!state.busy} onClicked={() => setRestartComputerLater(true)}>Restart later</Button>
                    </Box>
                </Box>}
                {updater.canUseInstalled && !restartLater && <Box className="settings-card updates-details" orientation="vertical" spacing={10}>
                    <Label className="section-heading" xalign={0}>{`Ready to use Dev OS ${state.installed}`}</Label>
                    <Label className="settings-description" xalign={0} wrap>Installation is complete. Switch the desktop to the installed version when you are ready.</Label>
                    {useVersion && <Box orientation="vertical" spacing={10}>
                        {confirmSwitch && <Label id="updates-switch-warning" className="settings-description" xalign={0} wrap>Save your work first. This closes built-in desktop apps and restarts the shell. Your preferences will be kept.</Label>}
                        <Box spacing={8}>
                            <Button id="updates-use-version" className="settings-primary" sensitive={!state.busy} onClicked={() => {
                                if (!confirmSwitch) { setConfirmSwitch(true); return; }
                                setConfirmSwitch(false); void updater.useInstalled(useVersion);
                            }}>{confirmSwitch ? `Restart and use v${state.installed}` : 'Restart shell now'}</Button>
                            {confirmSwitch && <Button id="updates-cancel-switch" sensitive={!state.busy} onClicked={() => setConfirmSwitch(false)}>Cancel</Button>}
                            {!confirmSwitch && <Button id="updates-restart-later" sensitive={!state.busy} onClicked={() => setRestartLater(true)}>Restart later</Button>}
                        </Box>
                    </Box>}
                    <Label className="updates-command" selectable xalign={0}>dev-os-updated-session --nested</Label>
                    <Label className="settings-description" xalign={0}>Windows / WSL: .\dev.ps1 updated</Label>
                </Box>}
                <Box id="updates-file-card" className="settings-card" orientation="vertical">
                    <Box className="settings-card-header" spacing={10}><Image iconName="document-open-symbolic" pixelSize={18} /><Label className="section-heading" xalign={0}>Apply an update file (desktop, patch or system)</Label></Box>
                    <Box className="updates-details" orientation="vertical" spacing={10}>
                        <Label className="settings-description" xalign={0} wrap>No internet? Copy dev-os-linux-&lt;arch&gt;.tar.gz (or a dev-os-patch-… file) from a GitHub release to a USB stick or Downloads, and choose it here. Put SHA256SUMS and SHA256SUMS.sig from the same release next to it so it can be verified.</Label>
                        <Box spacing={8}>
                            <Entry id="updates-file" text={file} placeholder="/path/to/dev-os-linux-arm64.tar.gz" sensitive={!state.busy && !state.blocked} expand
                                onChanged={entry => { setFile(entry.get_text()); setConfirmFile(false); }} />
                            <Button id="updates-browse" sensitive={!state.busy && !state.blocked} onClicked={() => { void chooseFile().then(path => { if (path) { setFile(path); setConfirmFile(false); } }); }}>Browse…</Button>
                        </Box>
                        {confirmFile && <Label id="updates-file-warning" className="settings-description" xalign={0} wrap>Only install files you trust: an update runs as part of your desktop. Click again to install.</Label>}
                        <Box spacing={8}><Button id="updates-install-file" sensitive={!state.busy && !state.blocked && file.trim().length > 0} onClicked={() => {
                            if (!confirmFile) { setConfirmFile(true); return; }
                            setConfirmFile(false); void updater.installFile(file.trim());
                        }}>{confirmFile ? 'Install this file' : 'Apply update file'}</Button></Box>
                    </Box>
                </Box>
                <Box id="updates-versions" className="settings-card" orientation="vertical">
                    <Box className="settings-card-header" spacing={10}><Image iconName="view-list-symbolic" pixelSize={18} /><Label className="section-heading" xalign={0}>Versions on this computer</Label></Box>
                    <Box className="updates-details" orientation="vertical" spacing={8}>
                        {updater.versions.map((row, index) => <Box key={index} spacing={10}>
                            <Label className="settings-field-title" xalign={0} expand>{row.version}</Label>
                            <Label className="settings-badge">{row.role === 'running' ? 'RUNNING' : row.role === 'installed' ? 'SELECTED FOR NEXT START' : 'PREVIOUS'}</Label>
                        </Box>)}
                        {state.previous && <Label className="settings-description" xalign={0} wrap>{`Use previous version selects ${state.previous} again; the files of every version stay untouched.`}</Label>}
                    </Box>
                </Box>
                <Box className="settings-card" orientation="vertical">
                    <Box className="settings-card-header" spacing={10}><Image iconName="network-server-symbolic" pixelSize={18} /><Label className="section-heading" xalign={0}>Update source</Label></Box>
                    <Box className="updates-details" orientation="vertical" spacing={12}>
                        <Label className="settings-description" xalign={0}>Public GitHub repository · owner/repo</Label>
                        <Box spacing={8}><Entry id="updates-repository" text={source} sensitive={!state.busy} expand
                            onChanged={entry => { setSource(entry.get_text()); setSourceError(''); }} /><Button id="updates-save-source" sensitive={sourceDirty && !state.busy} onClicked={saveSource}>Save source</Button></Box>
                        {sourceError && <Label className="error" xalign={0} wrap>{sourceError}</Label>}
                        <Box spacing={16}>
                            <Label className="settings-field-title" xalign={0} expand>Check when opening Updates</Label>
                            <Switch id="updates-auto-check" active={checkOnOpen} sensitive={!state.busy} onActiveChanged={button => {
                                setCheckOnOpen(button.active);
                                preferences.update(id, true, {...preferences.get(id).state.values, checkOnOpen: button.active});
                            }} />
                        </Box>
                        <Box spacing={16}>
                            <Label className="settings-field-title" xalign={0} expand>Check for updates daily in the background (sends a request to GitHub)</Label>
                            <Switch id="updates-periodic" active={periodic} sensitive={!state.busy} onActiveChanged={button => {
                                setPeriodic(button.active);
                                preferences.update(id, true, {...preferences.get(id).state.values, periodicCheck: button.active});
                            }} />
                        </Box>
                    </Box>
                </Box>
            </Box>
        </ScrolledWindow>
        <Box className="settings-action-bar" spacing={10}><Image iconName="changes-prevent-symbolic" pixelSize={16} className="settings-saved" /><Label className="settings-description" xalign={0} wrap expand>Updates install alongside existing versions; switch back any time. The desktop updates alongside the old one; kernel, firmware and boot image updates replace system files (with a restart and automatic fallback).</Label></Box>
    </Box>;
}
