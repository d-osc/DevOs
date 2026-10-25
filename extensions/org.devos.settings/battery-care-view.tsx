import {React, Box, Label, Image, CheckButton, GLib, useEffect, useRef, useState} from '@dev-os/core';
import {SwitchRow} from './switch-row.js';
import {BatteryCare, remainingText, unsupportedBatteryCare, type BatteryCareAction, type BatteryCareControls, type BatteryCareState} from './battery-care.js';
/** Battery Care Mode and Instant Full-Charge Mode, laid out like the MyASUS card: description left, switches right. */
export function BatteryCareSettings({controls}: {controls?: BatteryCareControls}) {
    const [backend] = useState(() => controls ?? new BatteryCare());
    const [state, setState] = useState<BatteryCareState>(unsupportedBatteryCare), [ready, setReady] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState(''), [nonce, setNonce] = useState(0);
    const alive = useRef(true);
    const request = async (action: BatteryCareAction, enabled?: boolean) => {
        setBusy(true); setError('');
        try {const next = await backend.request(action, enabled); if (alive.current) {setState(next); setReady(true);}}
        catch (reason) {if (alive.current) {setError(reason instanceof Error ? reason.message : String(reason)); setNonce(value => value + 1);}}
        finally {if (alive.current) setBusy(false);}
    };
    useEffect(() => {
        alive.current = true; void request('get');
        // Refresh the countdown and pick up an expired full charge.
        const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {if (alive.current) void request('get'); return GLib.SOURCE_CONTINUE;});
        return () => {alive.current = false; GLib.source_remove(timer); backend.destroy();};
    }, [backend]);
    const usable = ready && state.supported && !busy;
    return <Box id="battery-care-card" className="settings-card system-card battery-care" spacing={28}>
        <Box orientation="vertical" spacing={8} widthRequest={260}>
            <Box spacing={10}><Image iconName="battery-good-symbolic" pixelSize={23} /><Label className="section-heading" xalign={0}>Battery Care Mode</Label></Box>
            <Label className="settings-description" xalign={0} wrap>Keeps your battery healthy even when it's connected to an AC adapter for an extended period of time.</Label>
        </Box>
        <Box orientation="vertical" spacing={18} expand>
            <Box orientation="vertical" spacing={8}>
                <Label className="settings-field-title" xalign={0}>Battery Care Mode</Label>
                <Label className="settings-description" xalign={0} wrap>{`Enable Battery Care Mode to limit battery charging to ${state.limit}% of full capacity, which will improve the battery's lifespan.`}</Label>
                <SwitchRow key={`care-${nonce}`} id="battery-care-switch" stateId="battery-care-state" active={state.care} sensitive={usable} label={state.care ? 'On' : 'Off'} onToggled={on => void request('care', on)} />
            </Box>
            <Box orientation="vertical" spacing={8}>
                <Label className="settings-field-title" xalign={0}>Instant Full-Charge Mode</Label>
                <Label className="settings-description" xalign={0} wrap>Instant Full-Charge Mode charges the battery to 100%. Battery Care Mode will be re-enabled after 24 hours.</Label>
                <SwitchRow key={`full-${nonce}`} id="battery-full-switch" stateId="battery-full-state" active={state.full} sensitive={usable && (state.care || state.full)} label={state.full ? 'On' : 'Off'} onToggled={on => void request('full', on)} />
                {state.full && <Label id="battery-full-remaining" className="settings-description" xalign={0} wrap>{`Battery Care Mode returns in ${remainingText(state.remaining)}.`}</Label>}
                {state.supported && !state.care && !state.full && <Label id="battery-full-hint" className="settings-description" xalign={0} wrap>Turn on Battery Care Mode to use Instant Full-Charge Mode.</Label>}
                <CheckButton id="battery-quick-check" active={state.quick} sensitive={ready && state.supported && !busy} onToggled={w => {if (w.active !== state.quick) void request('quick', w.active);}}>Display this switch in the panel to quickly change the Instant Full-Charge setting.</CheckButton>
            </Box>
            {ready && !state.supported && <Label id="battery-care-unsupported" className="settings-description" xalign={0} wrap>{`Not supported on this device. ${state.reason || 'The battery driver does not provide a charge limit.'} Controls stay off rather than pretending to work.`}</Label>}
            {error && <Label id="battery-care-error" className="settings-error-banner" xalign={0} wrap>{error}</Label>}
        </Box>
    </Box>;
}
