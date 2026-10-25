import {React, Box, Label, Image, Button, ScrolledWindow, Gtk, GLib, useEffect, useRef, useState} from '@dev-os/core';
import {SwitchRow} from './switch-row.js';
import {RadioRow} from './radio-row.js';
import {Connectivity, taskFirstProfiles, unsupportedConnectivity, type ConnectivityAction, type ConnectivityControls, type ConnectivityState, type TaskFirstProfile} from './connectivity.js';
/** Connectivity, laid out like the MyASUS page: TaskFirst (radios) and WiFi SmartConnect (switch), one card each. */
export function ConnectivitySettings({back, controls}: {back(): void; controls?: ConnectivityControls}) {
    const [backend] = useState(() => controls ?? new Connectivity());
    const [state, setState] = useState<ConnectivityState>(unsupportedConnectivity), [ready, setReady] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState(''), [nonce, setNonce] = useState(0);
    const alive = useRef(true);
    const request = async (action: ConnectivityAction, ...args: string[]) => {
        setBusy(true); setError('');
        try {const next = await backend.request(action, ...args); if (alive.current) {setState(next); setReady(true);}}
        catch (reason) {if (alive.current) {setError(reason instanceof Error ? reason.message : String(reason)); setNonce(value => value + 1);}}
        finally {if (alive.current) setBusy(false);}
    };
    useEffect(() => {
        alive.current = true; void request('get');
        // Pick up the last SmartConnect decision and interfaces that appeared after a network change.
        const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {if (alive.current) void request('get'); return GLib.SOURCE_CONTINUE;});
        return () => {alive.current = false; GLib.source_remove(timer); backend.destroy();};
    }, [backend]);
    const tfUsable = ready && state.taskfirstSupported && !busy, scUsable = ready && state.smartconnectSupported && !busy;
    const choose = (id: TaskFirstProfile) => {if (id !== state.taskfirst) void request('taskfirst', id);};
    return <Box className="settings-content" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={10}>
            <Box spacing={8}><Button id="connectivity-back" onClicked={back}>‹ Network &amp; Internet</Button><Label className="settings-eyebrow" expand xalign={0}>CONNECTIONS &amp; SHARING</Label></Box>
            <Label className="heading" xalign={0}>Connectivity</Label>
            <Label className="settings-description" xalign={0}>Prioritize the traffic that matters and connect to the best access point.</Label>
        </Box>
        <ScrolledWindow expand fill hscrollbarPolicy={Gtk.PolicyType.NEVER}><Box className="settings-form" orientation="vertical" spacing={18}>
            <Box id="taskfirst-card" className="settings-card system-card taskfirst" spacing={28}>
                <Box orientation="vertical" spacing={8} widthRequest={260}>
                    <Box spacing={10}><Image iconName="network-transmit-symbolic" pixelSize={23} /><Label className="section-heading" xalign={0}>TaskFirst</Label></Box>
                    <Label className="settings-description" xalign={0} wrap>Prioritize your internet connection&apos;s available bandwidth to particular activities for the smoothest possible performance.</Label>
                    <Label id="taskfirst-honest" className="settings-description" xalign={0} wrap>This sends the chosen kind of traffic first from this computer (fair queueing with priority classes, based on well-known ports and DSCP markings). It cannot add bandwidth, and it only helps while your connection is busy.</Label>
                    {state.taskfirstActive && <Label id="taskfirst-active" className="settings-description" xalign={0} wrap>{`Active on ${state.taskfirstInterfaces}.`}</Label>}
                    {ready && state.taskfirstSupported && state.taskfirst !== 'off' && !state.taskfirstActive && <Label id="taskfirst-waiting" className="settings-description" xalign={0} wrap>Waiting for a network connection. It is applied as soon as one is up.</Label>}
                </Box>
                <Box orientation="vertical" spacing={9} expand>
                    {taskFirstProfiles.map(item => <RadioRow key={`${item.id}-${nonce}`} id={`taskfirst-${item.id}`} selected={state.taskfirst === item.id} sensitive={tfUsable} title={item.title} description={item.description} onClicked={() => choose(item.id)} />)}
                    {ready && !state.taskfirstSupported && <Label id="taskfirst-unsupported" className="settings-description" xalign={0} wrap>{`Not supported on this system. ${state.taskfirstReason || 'Traffic control is not available.'} Controls stay off rather than pretending to work.`}</Label>}
                </Box>
            </Box>
            <Box id="smartconnect-card" className="settings-card system-card smartconnect" spacing={28}>
                <Box orientation="vertical" spacing={8} widthRequest={260}>
                    <Box spacing={10}><Image iconName="network-wireless-signal-excellent-symbolic" pixelSize={23} /><Label className="section-heading" xalign={0}>WiFi SmartConnect</Label></Box>
                    <Label className="settings-description" xalign={0} wrap>Enable the WiFi SmartConnect feature to automatically connect to the wireless router with the best signal in your current environment.</Label>
                    <Label id="smartconnect-honest" className="settings-description" xalign={0} wrap>It only moves between access points that share the name of the network you are connected to, only when the signal is weak and another one is clearly stronger for a while, and never during a busy transfer or call.</Label>
                </Box>
                <Box orientation="vertical" spacing={10} expand>
                    <Label className="settings-description" xalign={0}>Switch on to enable WiFi SmartConnect.</Label>
                    <SwitchRow key={`sc-${nonce}`} id="smartconnect-switch" stateId="smartconnect-state" active={state.smartconnectSupported && state.smartconnect} sensitive={scUsable} label={state.smartconnectSupported && state.smartconnect ? 'On' : 'Off'} onToggled={on => void request('smartconnect', on ? 'on' : 'off')} />
                    {state.smartconnectSupported && state.smartconnect && state.smartconnectLast && <Label id="smartconnect-last" className="settings-description" xalign={0} wrap>{state.smartconnectLast}</Label>}
                    {ready && !state.smartconnectSupported && <Label id="smartconnect-unsupported" className="settings-description" xalign={0} wrap>{`Not supported on this system. ${state.smartconnectReason || 'No Wi-Fi adapter was found.'} The switch stays off rather than pretending to work.`}</Label>}
                </Box>
            </Box>
            {error && <Label id="connectivity-error" className="settings-error-banner" xalign={0} wrap>{error}</Label>}
        </Box></ScrolledWindow>
    </Box>;
}
