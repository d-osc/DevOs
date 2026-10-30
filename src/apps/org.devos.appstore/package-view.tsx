import {React, Box, Label, Button, Image, ScrolledWindow, Gtk, useState, useEffect} from '@dev-os/core';
import type {PackageControls, InstallResult, InstalledPackage} from './package-backend.js';
import type {PackageInfo} from './package-file.js';

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KiB', 'MiB', 'GiB']; let value = bytes / 1024, unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
export const KIND_LABEL = {dpk: 'Dev OS package (.dpk)', deb: 'Debian package (.deb)', rpm: 'RPM package (.rpm)', 'tar.gz': 'Archive package (.tar.gz)'} as const;
const trustNote: Record<string, string> = {
    dpk: 'Installed for your user only. Files go to the package store and nothing runs as administrator or during installation.',
    'tar.gz': 'Installed for your user only. Files go to the package store and nothing runs as administrator or during installation.',
    deb: 'Files are extracted for your user only. Scripts are not run, dependencies are not installed, links are skipped.',
    rpm: 'Files are extracted for your user only. Scriptlets are not run, dependencies are not installed, links are skipped.',
};
type Phase = 'loading' | 'review' | 'installing' | 'done' | 'failed';
export interface PackageInstallProps {controls: PackageControls; paths: readonly string[]; storeRoot?: string; launch?(command: string): string | null; onClose(): void;}

function Row({label, value, id}: {label: string; value: string; id?: string}) {
    return <Box spacing={12}><Label className="subtle" xalign={0} widthRequest={120}>{label}</Label><Label id={id} xalign={0} wrap hexpand>{value}</Label></Box>;
}

export function PackageInstallView({controls, paths, storeRoot, launch, onClose}: PackageInstallProps) {
    const [index, setIndex] = useState(0), [phase, setPhase] = useState<Phase>('loading');
    const [info, setInfo] = useState<PackageInfo | null>(null), [error, setError] = useState(''), [stage, setStage] = useState('');
    const [result, setResult] = useState<InstallResult | null>(null), [existing, setExisting] = useState<InstalledPackage | null>(null), [note, setNote] = useState('');
    const path = paths[index] ?? '';
    useEffect(() => {
        let live = true; setPhase('loading'); setInfo(null); setError(''); setResult(null); setStage(''); setNote('');
        Promise.all([controls.inspect(path), controls.installed().catch(() => [] as InstalledPackage[])]).then(([found, installed]) => {
            if (!live) return; setInfo(found); setExisting(installed.find(item => item.id === found.id) ?? null); setPhase('review');
        }).catch(reason => { if (live) { setError(String(reason instanceof Error ? reason.message : reason)); setPhase('failed'); } });
        return () => { live = false; };
    }, [controls, path]);
    const advance = () => { if (index + 1 < paths.length) setIndex(index + 1); else onClose(); };
    const install = () => {
        setPhase('installing'); setError(''); setStage('Preparing installation…');
        controls.install(path, line => setStage(line)).then(done => { setResult(done); setPhase('done'); }).catch(reason => { setError(String(reason instanceof Error ? reason.message : reason)); setPhase('failed'); });
    };
    const blocked = !!info?.blockers.length;
    const queue = paths.length > 1 ? `Package ${index + 1} of ${paths.length}` : '';
    const title = phase === 'done' ? `${info?.name ?? result?.id} installed` : phase === 'failed' ? 'Could not install' : phase === 'installing' ? `Installing ${info?.name ?? ''}…` : info ? `Install ${info.name ?? info.fileName}?` : 'Reading package…';
    return <ScrolledWindow expand hexpand vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER}><Box className="app-store-content" orientation="vertical" spacing={16}>
        <Box spacing={16}><Image iconName="system-software-install-symbolic" pixelSize={48}/><Box orientation="vertical" spacing={4} hexpand>
            <Label id="pkg-title" className="app-store-detail-title" xalign={0} wrap>{title}</Label>
            <Label id="pkg-file" className="subtle" xalign={0} wrap>{path}{queue ? `  ·  ${queue}` : ''}</Label></Box></Box>
        {phase === 'loading' && <Label id="pkg-loading" className="app-store-notice" xalign={0}>Reading the package without installing it…</Label>}
        {info && phase !== 'failed' && <Box className="app-store-card" orientation="vertical" spacing={8}>
            <Row id="pkg-kind" label="Format" value={KIND_LABEL[info.kind]}/>
            <Row id="pkg-name" label="Name" value={`${info.name ?? info.fileName}${info.id && info.id !== info.name ? `  (${info.id})` : ''}`}/>
            <Row id="pkg-version" label="Version" value={info.version ?? 'Not declared (0.0.0)'}/>
            {info.arch && <Row id="pkg-arch" label="Architecture" value={info.arch}/>}
            <Row id="pkg-size" label="File size" value={formatBytes(info.size)}/>
            {info.fileCount !== undefined && <Row id="pkg-files" label="Files" value={`${info.fileCount}${info.totalBytes ? `  ·  ${formatBytes(info.totalBytes)} unpacked` : ''}`}/>}
            {(info.summary || info.description) && <Row id="pkg-description" label="Description" value={info.summary ?? info.description ?? ''}/>}
            {info.license && <Row label="License" value={info.license}/>}
            <Row id="pkg-dependencies" label="Dependencies" value={info.dependencies.length ? `${info.dependencies.slice(0, 12).join(', ')}${info.dependencies.length > 12 ? `, +${info.dependencies.length - 12} more` : ''}  (not installed automatically)` : 'None declared'}/>
            <Row id="pkg-commands" label="Provides" value={info.commands.length ? `Commands: ${info.commands.join(', ')}` : info.launchers.length ? `Launcher: ${info.launchers[0]}` : 'No command or launcher'}/>
            <Row id="pkg-location" label="Installs to" value={`${storeRoot ?? '~/.local/share/devos'} (your user only)`}/>
            <Row id="pkg-trust" label="Trust" value={info.signature}/>
            {existing && <Row id="pkg-existing" label="Installed now" value={`Version ${existing.version} will be replaced; it is kept for rollback.`}/>}
        </Box>}
        {info && phase === 'review' && <Label id="pkg-note" wrap xalign={0}>{trustNote[info.kind]}</Label>}
        {info?.blockers.map((text, i) => <Label key={`b${i}`} className="error" id={`pkg-blocker-${i}`} wrap xalign={0}>{`⛔ ${text}`}</Label>)}
        {info && phase !== 'failed' && info.warnings.map((text, i) => <Label key={`w${i}`} className="app-store-notice" id={`pkg-warning-${i}`} wrap xalign={0}>{text}</Label>)}
        {info?.details && <Label className="subtle" wrap xalign={0}>{info.details}</Label>}
        {phase === 'installing' && <Label id="pkg-progress" className="app-store-notice" wrap xalign={0}>{`${stage}  Keep this window open until it finishes.`}</Label>}
        {phase === 'done' && result && <Box className="app-store-card" orientation="vertical" spacing={8}><Label id="pkg-result" className="app-store-success" wrap xalign={0}>{`${result.id} ${result.version} installed${result.extension ? '. Restart the Dev OS session to load the extension.' : '.'}`}</Label>
            {result.path && <Label className="subtle" xalign={0} wrap>{result.path}</Label>}{note && <Label id="pkg-open-note" className="error" wrap xalign={0}>{note}</Label>}</Box>}
        {phase === 'failed' && <Label id="pkg-error" className="error" wrap selectable xalign={0}>{error}</Label>}
        <Box spacing={10}>
            {phase === 'review' && <><Button id="pkg-cancel" onClicked={onClose}>Cancel</Button><Button id="pkg-install" className="app-store-primary" sensitive={!blocked} onClicked={install}>{existing ? 'Replace and install' : 'Install'}</Button></>}
            {phase === 'installing' && <Button id="pkg-cancel" sensitive={false}>Cancel</Button>}
            {phase === 'done' && <>{launch && !!result?.commands.length && <Button id="pkg-open" className="app-store-primary" onClicked={() => setNote(launch(result.commands[0]) ?? '')}>Open app</Button>}
                {index + 1 < paths.length ? <Button id="pkg-next" onClicked={advance}>Next package</Button> : <Button id="pkg-close" onClicked={onClose}>Close</Button>}</>}
            {phase === 'failed' && <>{index + 1 < paths.length && <Button id="pkg-next" onClicked={advance}>Skip to next package</Button>}<Button id="pkg-close" onClicked={onClose}>Close</Button></>}
        </Box>
    </Box></ScrolledWindow>;
}

/** "Packages" section of the App Store: user-level packages with Remove and Rollback. */
export function PackagesList({controls, launch, storeRoot}: {controls: PackageControls; launch?(command: string): string | null; storeRoot?: string}) {
    const [items, setItems] = useState<InstalledPackage[] | null>(null), [error, setError] = useState(''), [confirm, setConfirm] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
    const refresh = () => controls.installed().then(setItems).catch(reason => setError(String(reason instanceof Error ? reason.message : reason)));
    useEffect(() => { void refresh(); }, [controls]);
    const act = async (label: string, work: () => Promise<unknown>) => {
        setBusy(true); setError(''); setNotice('');
        try { await work(); setNotice(label); setConfirm(''); await refresh(); } catch (reason) { setError(String(reason instanceof Error ? reason.message : reason)); } finally { setBusy(false); }
    };
    return <Box orientation="vertical" spacing={12}>
        <Label className="app-store-section" xalign={0}>Installed packages</Label>
        <Label className="subtle" wrap xalign={0}>{`Packages installed from .dpk, .deb, .rpm and .tar.gz files for your user (${storeRoot ?? '~/.local/share/devos'}). Remove deletes the package and its launcher.`}</Label>
        {error && <Label id="pkg-list-error" className="error" wrap selectable xalign={0}>{error}</Label>}
        {notice && <Label id="pkg-list-notice" className="app-store-success" wrap xalign={0}>{notice}</Label>}
        {items && !items.length && <Label id="pkg-list-empty" wrap xalign={0}>No packages installed from files yet. Double-click a package in Files to install one.</Label>}
        {items?.map(item => <Box key={item.id} className="app-store-card" orientation="vertical" spacing={8}>
            <Label id={`pkg-item-${item.id}`} className="app-store-app-name" xalign={0}>{`${item.title}  ${item.version}`}</Label>
            <Label className="subtle" wrap xalign={0}>{`${item.id} · ${item.kind} · ${item.files} files · ${formatBytes(item.bytes)}${item.description ? ` · ${item.description}` : ''}`}</Label>
            {confirm === item.id ? <Box spacing={10}><Label wrap xalign={0} hexpand>{`Remove ${item.title}?`}</Label><Button id={`pkg-remove-cancel-${item.id}`} onClicked={() => setConfirm('')}>Cancel</Button><Button id={`pkg-remove-confirm-${item.id}`} className="app-store-primary" sensitive={!busy} onClicked={() => { void act(`${item.id} removed`, () => controls.remove(item.id)); }}>Remove package</Button></Box>
                : <Box spacing={10}>{launch && item.commands.length > 0 && <Button id={`pkg-run-${item.id}`} sensitive={!busy} onClicked={() => setNotice(launch(item.commands[0]) ?? '')}>Open</Button>}
                    {item.previousVersion && <Button id={`pkg-rollback-${item.id}`} sensitive={!busy} onClicked={() => { void act(`${item.id} rolled back`, () => controls.rollback(item.id)); }}>{`Roll back to ${item.previousVersion}`}</Button>}
                    <Button id={`pkg-remove-${item.id}`} sensitive={!busy} onClicked={() => setConfirm(item.id)}>Remove…</Button></Box>}
        </Box>)}
    </Box>;
}
