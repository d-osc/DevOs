import {Gtk, React, Box, Label, Image, Button, Entry, ProgressBar, ScrolledWindow, createRoot, mountWindowHeader, useState, useEffect, type UIExtension} from '@dev-os/core';
import {Installer, USERNAME, HOSTNAME, type InstallDisk, type InstallerControls, type InstallEvent} from './installer.js';

type Page = 'welcome' | 'disk' | 'account' | 'confirm' | 'progress' | 'done' | 'failed';
const gib = (bytes: number) => `${Math.round(bytes / 1073741824)} GiB`;

export function InstallerWizard({controls, onBusyChanged}: {controls: InstallerControls; onBusyChanged?(busy: boolean): void}) {
    const [page, setPage] = useState<Page>('welcome');
    const [disks, setDisks] = useState<InstallDisk[] | null>(null), [selected, setSelected] = useState<InstallDisk | null>(null);
    const [username, setUsername] = useState(''), [hostname, setHostname] = useState('devos');
    const [password, setPassword] = useState(''), [repeat, setRepeat] = useState(''), [typed, setTyped] = useState('');
    const [step, setStep] = useState<InstallEvent | null>(null), [message, setMessage] = useState(''), [error, setError] = useState('');
    const available = controls.available();
    const loadDisks = async () => {
        setError('');
        try { const found = await controls.disks(); setDisks(found); setSelected(current => found.find(disk => disk.path === current?.path) ?? null); }
        catch (reason) { setDisks([]); setError(String(reason)); }
    };
    useEffect(() => { if (page === 'disk') void loadDisks(); }, [page]);
    const formError = !USERNAME.test(username) ? 'The user name must start with a lowercase letter and use only letters, digits, - and _.'
        : !HOSTNAME.test(hostname) ? 'The computer name may use lowercase letters, digits and -.'
        : password.length < 4 ? 'The password needs at least 4 characters.'
        : password !== repeat ? 'The passwords do not match.' : '';
    const start = async () => {
        if (!selected) return;
        setPage('progress'); setStep({kind: 'step', step: 0, total: 10, message: 'Starting'}); onBusyChanged?.(true);
        try {
            await controls.install({disk: selected, username, hostname, password}, event => {
                if (event.kind === 'step') setStep(event);
                else if (event.kind === 'done') { setMessage(event.message); setPage('done'); }
                else { setError(event.message); setPage('failed'); }
            });
        } catch (reason) { setError(String(reason)); setPage('failed'); }
        finally { setPassword(''); setRepeat(''); onBusyChanged?.(false); }
    };
    const header = (title: string, subtitle: string) => <Box orientation="vertical" spacing={4}><Label className="installer-title" xalign={0}>{title}</Label><Label className="subtle" wrap xalign={0}>{subtitle}</Label></Box>;
    const nav = (back: Page | null, next: {label: string; id: string; enabled: boolean; action(): void}) => <Box className="installer-navigation" spacing={12} halign={Gtk.Align.END}>
        {back && <Button id="installer-back" onClicked={() => { setError(''); setPage(back); }}>Back</Button>}
        <Button id={next.id} className={next.id === 'installer-erase' ? 'destructive-action' : 'suggested-action'} sensitive={next.enabled} onClicked={next.action}>{next.label}</Button>
    </Box>;
    const stages = ['Welcome', 'Choose a disk', 'Your account', 'Review', 'Installation'];
    const current = page === 'welcome' ? 0 : page === 'disk' ? 1 : page === 'account' ? 2 : page === 'confirm' ? 3 : 4;
    return <Box className="installer-shell" spacing={0} expand fill>
        <Box className="installer-sidebar" orientation="vertical" spacing={22} widthRequest={208}>
            <Image iconName="system-software-install-symbolic" pixelSize={38} halign={Gtk.Align.START} />
            <Box orientation="vertical" spacing={6}><Label className="installer-wordmark" xalign={0}>DEV OS</Label><Label className="installer-sidebar-title" xalign={0}>A fresh start.</Label></Box>
            <Box orientation="vertical" spacing={18} expand fill>
                {stages.map((stage, index) => <Box key={stage} className={`installer-stage${index === current ? ' current' : index < current ? ' complete' : ''}`} spacing={12}>
                    <Label className="installer-stage-number">{index < current ? '✓' : String(index + 1).padStart(2, '0')}</Label><Label xalign={0}>{stage}</Label>
                </Box>)}
            </Box>
            <Label className="installer-sidebar-note" wrap xalign={0}>LIVE USB · ARM64</Label>
        </Box>
        <ScrolledWindow expand fill hscrollbarPolicy={Gtk.PolicyType.NEVER}>
        <Box className="installer-body" orientation="vertical" spacing={22} borderWidth={32} hexpand vexpand>
        {!available && <Box orientation="vertical" spacing={8}>
            {header('Install Dev OS', 'The installer erases a whole disk, so it runs only from the Live USB.')}
            <Label id="installer-unavailable" className="error" wrap xalign={0}>Start this computer from the Dev OS Live USB to install. Nothing was changed.</Label>
        </Box>}
        {available && page === 'welcome' && <Box orientation="vertical" spacing={16}>
            <Box className="installer-hero" orientation="vertical" spacing={18}>
                <Image iconName="computer-symbolic" pixelSize={72} halign={Gtk.Align.START} />
                <Label className="installer-eyebrow" xalign={0}>WELCOME TO DEV OS</Label>
                {header('Make it your own.', 'A workspace on your computer, ready whenever you are.')}
            </Box>
            <Box className="installer-info-card" spacing={14}><Image iconName="drive-harddisk-symbolic" pixelSize={26}/><Box orientation="vertical" spacing={4}><Label className="installer-card-title" xalign={0}>Your system. Your account.</Label><Label className="subtle" wrap xalign={0}>Choose a disk, create your account, then review before installing.</Label></Box></Box>
            <Label wrap xalign={0}>The installer will erase one whole disk that you choose and set up Dev OS on it, with a user account of your own. Other disks are not changed. Plug in your charger and keep this window open until it finishes.</Label>
            {nav(null, {label: 'Start', id: 'installer-start', enabled: true, action: () => setPage('disk')})}
        </Box>}
        {available && page === 'disk' && <Box orientation="vertical" spacing={12}>
            {header('Choose the disk to erase', 'Only internal, unused disks are listed. The Live USB itself and disks in use are never offered.')}
            <ScrolledWindow heightRequest={240} hscrollbarPolicy={Gtk.PolicyType.NEVER}><Box orientation="vertical" spacing={8}>
                {disks === null && <Label id="installer-disks-loading" xalign={0}>Looking for disks…</Label>}
                {disks?.length === 0 && <Label id="installer-disks-empty" wrap xalign={0}>No suitable disk was found (at least 8 GiB, not in use, not read-only).</Label>}
                {disks?.map(disk => <Button key={disk.path} id={`installer-disk-${disk.name}`} className={`disk-device${selected?.path === disk.path ? ' selected' : ''}`} onClicked={() => setSelected(disk)}>
                    <Box orientation="vertical" spacing={2}>
                        <Label xalign={0}>{`${disk.model || 'Unknown disk'} · ${gib(disk.size)} · ${disk.path}`}</Label>
                        <Label className="subtle" wrap xalign={0}>{disk.contents ? `Contains existing data (${disk.contents}) that will be erased` : 'Appears empty'}{disk.removable ? ' · removable' : ''}</Label>
                    </Box>
                </Button>)}
            </Box></ScrolledWindow>
            {error && <Label id="installer-error" className="error" wrap xalign={0}>{error}</Label>}
            <Box spacing={12}><Button id="installer-refresh" onClicked={() => { setDisks(null); void loadDisks(); }}>Refresh</Button>
                <Box expand fill hexpand>{nav('welcome', {label: 'Next', id: 'installer-next', enabled: selected !== null, action: () => setPage('account')})}</Box></Box>
        </Box>}
        {available && page === 'account' && <Box orientation="vertical" spacing={12}>
            {header('Your account', 'You will sign in with this user. It can administer the computer.')}
            <Label className="installer-field-label" xalign={0}>User name</Label><Entry id="installer-username" text={username} placeholder="User name (lowercase)" onChanged={entry => setUsername(entry.get_text())} />
            <Label className="installer-field-label" xalign={0}>Computer name</Label><Entry id="installer-hostname" text={hostname} placeholder="Computer name" onChanged={entry => setHostname(entry.get_text())} />
            <Label className="installer-field-label" xalign={0}>Password</Label><Entry id="installer-password" password text={password} placeholder="Password · at least 4 characters" onChanged={entry => setPassword(entry.get_text())} />
            <Label className="installer-field-label" xalign={0}>Confirm password</Label><Entry id="installer-confirm" password text={repeat} placeholder="Repeat the password" onChanged={entry => setRepeat(entry.get_text())} />
            {(username || password || repeat) && formError && <Label id="installer-form-error" className="error" wrap xalign={0}>{formError}</Label>}
            {nav('disk', {label: 'Next', id: 'installer-next', enabled: !formError, action: () => { setTyped(''); setPage('confirm'); }})}
        </Box>}
        {available && page === 'confirm' && selected && <Box orientation="vertical" spacing={12}>
            {header('Erase and install', 'This cannot be undone.')}
            <Label id="installer-warning" className="error" wrap xalign={0}>{`Everything on ${selected.model || 'this disk'} (${gib(selected.size)}, ${selected.path}) will be permanently erased.${selected.contents ? ` It currently contains ${selected.contents}.` : ''}`}</Label>
            <Label wrap xalign={0}>{`Dev OS will be installed for the user "${username}" on a computer named "${hostname}".`}</Label>
            <Label xalign={0}>{`Type ${selected.path} to confirm:`}</Label>
            <Entry id="installer-confirm-disk" text={typed} placeholder={selected.path} onChanged={entry => setTyped(entry.get_text())} />
            {nav('account', {label: 'Erase disk and install', id: 'installer-erase', enabled: typed === selected.path, action: () => void start()})}
        </Box>}
        {available && page === 'progress' && <Box orientation="vertical" spacing={14}>
            {header('Installing Dev OS', 'Do not turn off the computer or remove the USB drive.')}
            <ProgressBar id="installer-progress" fraction={step && step.kind === 'step' ? Math.max(0.02, (step.step - 1) / step.total) : 0.02} />
            <Label id="installer-step" xalign={0}>{step && step.kind === 'step' ? `Step ${step.step} of ${step.total}: ${step.message}` : 'Starting…'}</Label>
        </Box>}
        {available && page === 'done' && <Box orientation="vertical" spacing={14}>
            {header('Dev OS is installed', message || 'Remove the USB drive, then restart the computer.')}
            <Button id="installer-restart" className="suggested-action" onClicked={() => controls.reboot()}>Restart now</Button>
        </Box>}
        {available && page === 'failed' && <Box orientation="vertical" spacing={14}>
            {header('The installation did not finish', 'The disk may be partly written and will not start Dev OS yet. Your other disks were not changed.')}
            <Label id="installer-failure" className="error" wrap xalign={0}>{error}</Label>
            {nav('confirm', {label: 'Try again', id: 'installer-retry', enabled: true, action: () => { setError(''); setPage('disk'); }})}
        </Box>}
    </Box></ScrolledWindow></Box>;
}

export default {id: 'org.devos.installer', activate(context) {
    let window: Gtk.ApplicationWindow | undefined;
    let busy = false;
    context.registerCommand('installer', () => {
        context.invoke('launcher.hide');
        if (window) { window.present(); return; }
        window = new Gtk.ApplicationWindow({application: context.application, title: 'Install Dev OS', default_width: 1000, default_height: 700}); window.name = 'installer';
        const controls = new Installer(), root = createRoot(window), header = mountWindowHeader(window, {title: 'Install Dev OS', iconName: 'system-software-install-symbolic'});
        root.render(<InstallerWizard controls={controls} onBusyChanged={value => { busy = value; }} />);
        // Closing mid-install would leave a half-written disk, so the window stays until the run ends.
        window.connect('delete-event', () => busy);
        window.connect('destroy', () => { root.unmount(); header.destroy(); controls.destroy(); window = undefined; });
        window.show_all(); window.present();
    });
    return () => { if (!busy) window?.destroy(); };
}} satisfies UIExtension;
