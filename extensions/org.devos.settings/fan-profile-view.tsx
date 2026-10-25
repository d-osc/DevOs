import {React, Box, Label, Image, Button, GLib, useEffect, useRef, useState} from '@dev-os/core';
import {SwitchRow} from './switch-row.js';
import {RadioRow} from './radio-row.js';
import {FanProfile, fanModes, sourceTitles, unsupportedFanProfile, type FanMode, type FanProfileAction, type FanProfileControls, type FanProfileState, type PowerSource} from './fan-profile.js';
/** Fan Profile, laid out like the MyASUS card: description left, mode radios and Power Mode Synchronization right. */
export function FanProfileSettings({controls}: {controls?: FanProfileControls}) {
    const [backend] = useState(() => controls ?? new FanProfile());
    const [state, setState] = useState<FanProfileState>(unsupportedFanProfile), [ready, setReady] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState(''), [nonce, setNonce] = useState(0);
    const [editing, setEditing] = useState<PowerSource | null>(null);
    const alive = useRef(true);
    const request = async (action: FanProfileAction, ...args: string[]) => {
        setBusy(true); setError('');
        try {const next = await backend.request(action, ...args); if (alive.current) {setState(next); setReady(true);}}
        catch (reason) {if (alive.current) {setError(reason instanceof Error ? reason.message : String(reason)); setNonce(value => value + 1);}}
        finally {if (alive.current) setBusy(false);}
    };
    useEffect(() => {
        alive.current = true; void request('get');
        // Pick up the fan speed, an unplugged adapter and the Fn + F hotkey.
        const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {if (alive.current) void request('get'); return GLib.SOURCE_CONTINUE;});
        return () => {alive.current = false; GLib.source_remove(timer); backend.destroy();};
    }, [backend]);
    const usable = ready && state.supported && !busy;
    const active: PowerSource = state.source === 'battery' ? 'battery' : 'ac', source = editing ?? active;
    const selected: FanMode = (state[source] || (source === active ? state.current : '') || 'standard') as FanMode;
    const hotkey = state.supported && state.hotkey;
    const syncOn = state.supported && state.syncAvailable && state.sync;
    return <Box id="fan-profile-card" className="settings-card system-card fan-profile" spacing={28}>
        <Box orientation="vertical" spacing={8} widthRequest={260}>
            <Box spacing={10}><Image iconName="weather-windy-symbolic" pixelSize={23} /><Label className="section-heading" xalign={0}>Fan Profile</Label></Box>
            <Label className="settings-description" xalign={0} wrap>Select a preferred fan speed.</Label>
            {hotkey && <Label id="fan-profile-hotkey" className="settings-description" xalign={0} wrap>Select a preferred fan speed or press [Fn] + [F] to easily switch between Fan Profiles.</Label>}
            {state.supported && state.rpm !== null && <Label id="fan-profile-rpm" className="settings-description" xalign={0}>{`Fan speed: ${state.rpm} RPM`}</Label>}
        </Box>
        <Box orientation="vertical" spacing={14} expand>
            {state.supported && <Box spacing={8}>
                <Button id="fan-source-ac" className={`power-mode ${source === 'ac' ? 'power-mode-selected' : ''}`} sensitive={!busy} onClicked={() => setEditing('ac')}>Plugged-in</Button>
                <Button id="fan-source-battery" className={`power-mode ${source === 'battery' ? 'power-mode-selected' : ''}`} sensitive={!busy} onClicked={() => setEditing('battery')}>On battery</Button>
                <Label id="fan-profile-source" className="settings-description" expand xalign={1}>{source === active ? `${sourceTitles[active]} (current power source)` : `Applies when ${sourceTitles[source].toLowerCase()}`}</Label>
            </Box>}
            <Box orientation="vertical" spacing={9}>
                {(state.supported ? state.modes : (Object.keys(fanModes) as FanMode[])).map(id => <RadioRow key={`${id}-${nonce}`} id={`fan-mode-${id}`} selected={state.supported && selected === id} sensitive={usable} title={fanModes[id].title} description={fanModes[id].description} onClicked={() => {if (id !== selected || (source === active && state.current !== id)) void request('set', source, id);}} />)}
            </Box>
            {state.emulated && <Label id="fan-profile-emulated" className="settings-description" xalign={0} wrap>This device has no fan control. These profiles adjust the CPU performance policy instead; the fan still follows the temperature automatically.</Label>}
            <Box orientation="vertical" spacing={8}>
                <Label className="settings-field-title" xalign={0}>Power Mode Synchronization</Label>
                <Label className="settings-description" xalign={0} wrap>Dynamically adjusts your power mode based on the Fan Profile setting for optimal performance.</Label>
                <SwitchRow key={`sync-${nonce}`} id="fan-sync-switch" stateId="fan-sync-state" active={syncOn} sensitive={usable && state.syncAvailable} label={syncOn ? 'Enable' : 'Disable'} onToggled={on => void request('sync', on ? 'on' : 'off')} />
                {state.supported && !state.syncAvailable && <Label id="fan-sync-unavailable" className="settings-description" xalign={0} wrap>Power modes are not available on this device, so there is nothing to synchronize.</Label>}
            </Box>
            {ready && !state.supported && <Label id="fan-profile-unsupported" className="settings-description" xalign={0} wrap>{`Not supported on this device. ${state.reason || 'The kernel does not provide a fan profile.'} Controls stay off rather than pretending to work.`}</Label>}
            {error && <Label id="fan-profile-error" className="settings-error-banner" xalign={0} wrap>{error}</Label>}
        </Box>
    </Box>;
}
