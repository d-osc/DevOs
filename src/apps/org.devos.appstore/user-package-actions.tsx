import {React, Box, Label, Button, Image, useEffect, useState} from '@dev-os/core';
import type {App} from './backend.js';
import type {PackageControls, InstalledPackage} from './package-backend.js';
import type {RegistryApp} from './registry.js';
import type {RegistryControls, PreparedRegistryPackage} from './registry-backend.js';
import {formatBytes} from './package-view.js';

export function UserPackageActions({app, packages, registry, installed, onChanged, onBusy, launch, website}: {
    app: App; packages?: PackageControls; registry?: RegistryControls; installed?: InstalledPackage;
    onChanged(): Promise<void>; onBusy(label: string): void; launch?(command: string): string | null; website?(): void;
}) {
    const [confirm, setConfirm] = useState<'source' | 'uninstall' | 'rollback' | null>(null), [prepared, setPrepared] = useState<PreparedRegistryPackage | null>(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    useEffect(() => () => {if (prepared) registry?.discard(prepared);}, [prepared, registry]);
    const run = async (label: string, work: () => Promise<void>) => {
        if (busy || packages?.busy || registry?.busy) return;
        setBusy(true); onBusy(label); setError(''); setNotice('');
        try {await work();} catch (reason) {setError(reason instanceof Error ? reason.message : String(reason));}
        finally {setBusy(false); onBusy('');}
    };
    const download = () => run(`Downloading ${app.name}…`, async () => {
        if (!registry || !app.registry) throw new Error('Registry installation is not available.');
        setPrepared(await registry.prepare(app as RegistryApp)); setConfirm(null);
    });
    const install = () => run(`Installing ${app.name}…`, async () => {
        if (!registry || !prepared || !app.registry) return;
        try {
            const result = await registry.install(app as RegistryApp, prepared, line => onBusy(line));
            setNotice(`${app.name} ${result.version} installed for your user.`);
        } finally {setPrepared(null); await onChanged();}
    });
    return <Box className="app-store-user-actions" orientation="vertical" spacing={12} hexpand>
        <Box className="app-store-detail-actions" spacing={10} valign="center">
            {installed ? <>
                {launch && installed.commands.length > 0 && <Button id="app-store-user-open" className="app-store-primary app-store-install-button" sensitive={!busy} onClicked={() => setError(launch(installed.commands[0]) ?? '')}><Box spacing={8}><Image iconName="media-playback-start-symbolic" pixelSize={14}/><Label>Open</Label></Box></Button>}
                <Button id="app-store-user-uninstall" sensitive={!busy} onClicked={() => setConfirm('uninstall')}>Uninstall</Button>
                {installed.previousVersion && <Button id="app-store-user-rollback" sensitive={!busy} onClicked={() => setConfirm('rollback')}>Roll back</Button>}
            </> : <Button id="app-store-user-install" className="app-store-primary app-store-install-button" sensitive={!busy && !prepared && !!packages && !!registry && !!app.registry?.download} onClicked={() => setConfirm('source')}><Box spacing={8}><Image iconName="folder-download-symbolic" pixelSize={16}/><Label>Install</Label></Box></Button>}
            {website && <Button id="app-store-user-website" className="app-store-website-button" sensitive={!busy} onClicked={website}><Box spacing={8}><Label>Website</Label><Image iconName="go-jump-symbolic" pixelSize={14}/></Box></Button>}
            <Box hexpand/>
            <Box className="app-store-managed-by" spacing={6} valign="center"><Image iconName="utilities-terminal-symbolic" pixelSize={12}/><Label>dev</Label></Box>
        </Box>
        <Box className="app-store-install-caption" spacing={6}><Image iconName="avatar-default-symbolic" pixelSize={12}/><Label xalign={0} wrap>{installed ? `Version ${installed.version} · Installed for your user` : 'Installs for your user'}</Label></Box>
        {confirm === 'source' && <Box className="app-store-confirm" orientation="vertical" spacing={10}>
            <Label className="app-store-section" xalign={0}>{`Install ${app.name} with dev?`}</Label>
            <Label wrap xalign={0} selectable>{app.registry?.download?.url}</Label>
            <Label wrap xalign={0}>Download the publisher's Linux ARM64 package, then review its actual name, version and dependencies. This upstream file has no registry checksum and has not been verified to run on DevOs. dev installs for your user, skips package scripts and links, and does not install dependencies.</Label>
            <Box spacing={10}><Button id="app-store-user-cancel" sensitive={!busy} onClicked={() => setConfirm(null)}>Cancel</Button><Button id="app-store-user-download" sensitive={!busy} onClicked={() => {void download();}}>Download and review</Button></Box>
        </Box>}
        {prepared && <Box className="app-store-confirm" orientation="vertical" spacing={10}>
            <Label className="app-store-section" xalign={0}>Review downloaded package</Label>
            <Label id="app-store-user-review" wrap xalign={0}>{`${prepared.info.id} · ${prepared.info.version || 'Version not declared'} · ${prepared.info.arch || 'Architecture not declared'} · ${formatBytes(prepared.info.size)}`}</Label>
            <Label wrap xalign={0}>{prepared.info.dependencies.length ? `Dependencies (not installed automatically): ${prepared.info.dependencies.join(', ')}` : 'No dependencies declared.'}</Label>
            {prepared.info.warnings.map((warning, index) => <Label key={index} wrap xalign={0}>{warning}</Label>)}
            {prepared.existing && <Label wrap xalign={0}>{`This replaces installed package ${prepared.existing.id} ${prepared.existing.version}. dev retains one previous version for rollback.`}</Label>}
            <Box spacing={10}><Button id="app-store-user-review-cancel" sensitive={!busy} onClicked={() => setPrepared(null)}>Cancel</Button><Button id="app-store-user-confirm-install" className="app-store-primary" sensitive={!busy} onClicked={() => {void install();}}>{prepared.existing ? 'Replace and install' : 'Install package'}</Button></Box>
        </Box>}
        {(confirm === 'uninstall' || confirm === 'rollback') && installed && <Box className="app-store-confirm" orientation="vertical" spacing={10}>
            <Label wrap xalign={0}>{confirm === 'uninstall' ? `Uninstall ${installed.title} (${installed.id}) from your user package store and remove its launchers?` : `Roll back ${installed.id} to ${installed.previousVersion}?`}</Label>
            <Box spacing={10}><Button id="app-store-user-cancel" sensitive={!busy} onClicked={() => setConfirm(null)}>Cancel</Button><Button id="app-store-user-confirm-remove" sensitive={!busy} onClicked={() => {void run(confirm === 'uninstall' ? `Uninstalling ${app.name}…` : `Rolling back ${app.name}…`, async () => {
                if (!packages) return;
                if (confirm === 'uninstall') await packages.remove(installed.id); else await packages.rollback(installed.id);
                setNotice(confirm === 'uninstall' ? `${app.name} uninstalled.` : `${app.name} rolled back.`); setConfirm(null); await onChanged();
            });}}>{confirm === 'uninstall' ? 'Uninstall package' : 'Roll back package'}</Button></Box>
        </Box>}
        {error && <Label id="app-store-user-error" className="error" wrap selectable xalign={0}>{error}</Label>}
        {notice && <Label id="app-store-user-notice" className="app-store-success" wrap xalign={0}>{notice}</Label>}
    </Box>;
}
