import {React, Box, Image, Label, Switch, GLib, useEffect, useRef, useState} from '@dev-os/core';
import {BatteryCare, remainingText, type BatteryCareAction, type BatteryCareControls, type BatteryCareState} from '../../../src/apps/org.devos.settings/battery-care.js';
import {batteryPresentation, type BatteryContext, type BatteryStatus} from './battery.js';
export function PanelBattery({percent, status, found, acOnline, acFound, presentation}: {percent: number | null; status?: BatteryStatus; presentation?: ReturnType<typeof batteryPresentation>} & BatteryContext) {
    // Desktops and VMs have no power supplies at all; a laptop with a missing battery still has an AC supply.
    if (found === false && !acFound && !acOnline) return null;
    const battery = presentation ?? batteryPresentation(percent, status, {found: found ?? (percent !== null || (status ?? 'Unknown') !== 'Unknown'), acOnline});
    return <Box id="panel-battery" className={`panel-battery ${battery.className}`} spacing={5} valign="center" tooltip={battery.tooltip}>
        <Image iconName={battery.icon} pixelSize={17} /><Label className="panel-battery-label">{battery.text}</Label>
    </Box>;
}
/** Quick Instant Full-Charge switch for the quick-settings popover; hidden unless the device supports a charge limit and the user chose to show it. */
export function PanelFullCharge({controls}: {controls?: BatteryCareControls}) {
    const [backend] = useState(() => controls ?? new BatteryCare());
    const [state, setState] = useState<BatteryCareState | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [nonce, setNonce] = useState(0);
    const alive = useRef(true);
    const request = async (action: BatteryCareAction, enabled?: boolean) => {
        setBusy(true); setError('');
        try {const next = await backend.request(action, enabled); if (alive.current) setState(next);}
        catch (reason) {if (alive.current) {setError(reason instanceof Error ? reason.message : String(reason)); setNonce(value => value + 1);}}
        finally {if (alive.current) setBusy(false);}
    };
    useEffect(() => {
        alive.current = true; void request('get');
        const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {if (alive.current) void request('get'); return GLib.SOURCE_CONTINUE;});
        return () => {alive.current = false; GLib.source_remove(timer); backend.destroy();};
    }, [backend]);
    if (!state || !state.supported || !state.quick || (!state.care && !state.full)) return error ? <Label className="error" wrap xalign={0}>{error}</Label> : null;
    return <Box orientation="vertical" spacing={6}>
        <Box spacing={10}><Image iconName="battery-good-symbolic" pixelSize={16} />
            <Box orientation="vertical" spacing={2} expand><Label xalign={0}>Instant Full-Charge</Label><Label id="panel-full-charge-detail" className="popup-muted" xalign={0} wrap>{state.full ? `Charging to 100% · Battery Care returns in ${remainingText(state.remaining)}` : `Battery Care limits charging to ${state.limit}%`}</Label></Box>
            <Switch key={nonce} id="panel-full-charge" active={state.full} sensitive={!busy} onActiveChanged={w => {if (w.active !== state.full) void request('full', w.active);}} /></Box>
        {error && <Label className="error" wrap xalign={0}>{error}</Label>}
    </Box>;
}
