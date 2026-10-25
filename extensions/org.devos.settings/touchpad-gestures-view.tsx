import {React, Box, Label, Image, ComboBoxText} from '@dev-os/core';
import {SwitchRow} from './switch-row.js';
import {useHelper} from './use-helper.js';
import {TouchpadGestures, unsupportedTouchpadGestures, type GestureTarget, type TouchpadGesturesAction, type TouchpadGesturesControls, type TouchpadGesturesState} from './touchpad-gestures.js';
/** The touchpad with the Smart Gestures zones tinted: left and right strips, the top strip and the top-right corner. */
function Diagram({active}: {active: boolean}) {
    const zone = (name: string) => `tp-zone ${name} ${active ? 'tp-zone-on' : ''}`;
    return <Box id="touchpad-diagram" className="tp-pad" orientation="vertical" widthRequest={200} heightRequest={118}>
        <Box heightRequest={16}><Box className={zone('tp-zone-top')} expand /><Box className={zone('tp-zone-corner')} widthRequest={30} /></Box>
        <Box expand><Box className={zone('tp-zone-side')} widthRequest={16} /><Box expand /><Box className={zone('tp-zone-side')} widthRequest={16} /></Box>
    </Box>;
}
/** Touchpad lock and Smart Gestures, laid out like the two MyASUS cards: description left, switch and gesture list right. */
export function TouchpadGesturesSettings({controls}: {controls?: TouchpadGesturesControls}) {
    // Pick up the Fn + F9 lock key and a touchpad that was connected or removed.
    const {state, ready, busy, error, nonce, request} = useHelper<TouchpadGesturesState, TouchpadGesturesAction>(controls, () => new TouchpadGestures(), unsupportedTouchpadGestures, 10);
    const usable = ready && state.supported && !busy;
    const lockUsable = usable || (ready && !busy && state.locked);   // an existing lock can always be released
    const gestures = state.supported && state.gesturesAvailable && state.enabled && !state.locked;
    const gestureUsable = usable && state.gesturesAvailable;
    const list: {id: string; title: string; description: string; ok: boolean}[] = [
        {id: 'volume', title: 'Adjust volume', description: 'Slide one finger along the left edge', ok: state.backends.volume},
        {id: 'brightness', title: 'Adjust brightness', description: 'Slide one finger along the right edge', ok: state.backends.brightness},
        {id: 'seek', title: 'Forward/Rewind', description: 'Slide one finger across the top edge', ok: state.backends.seek},
        {id: 'launch', title: `Launch ${state.targets.find(item => item.id === state.launch)?.title ?? 'an app'}`, description: 'Swipe in from the top-right corner with one finger', ok: state.backends.launch},
    ];
    return <Box orientation="vertical" spacing={18}>
        <Box id="touchpad-lock-card" className="settings-card system-card" spacing={28}>
            <Box spacing={20} expand><Image iconName="input-touchpad-symbolic" pixelSize={26} /><Box orientation="vertical" spacing={5} expand><Label className="section-heading" xalign={0}>Touchpad</Label><Label className="settings-description" xalign={0} wrap>When set to Lock, touchpad input is disabled.</Label></Box></Box>
            <Box orientation="vertical" spacing={8} expand>
                <Label className="settings-description" xalign={0}>Lock/unlock the touchpad input function</Label>
                <SwitchRow key={`lock-${nonce}`} id="touchpad-lock-switch" stateId="touchpad-lock-state" active={!state.locked} sensitive={lockUsable} label={state.locked ? 'Lock' : 'Unlock'} onToggled={on => void request('lock', on ? 'off' : 'on')} />
                {ready && !state.supported && <Label id="touchpad-lock-unsupported" className="settings-description" xalign={0} wrap>{`${state.reason || 'No touchpad was detected.'} The lock stays off rather than pretending to work.`}</Label>}
                {state.supported && <Label id="touchpad-lock-hint" className="settings-description" xalign={0} wrap>The touchpad key (Fn + F9 on many laptops) also locks and unlocks it when your keyboard sends it.</Label>}
            </Box>
        </Box>
        <Box id="touchpad-gestures-card" className="settings-card system-card" spacing={28}>
            <Box spacing={20} expand><Image iconName="input-touchpad-symbolic" pixelSize={26} /><Box orientation="vertical" spacing={8} expand><Label className="section-heading" xalign={0}>Smart Gestures</Label><Label className="settings-description" xalign={0} wrap>Quickly access commonly used settings and apps</Label><Diagram active={gestures} /></Box></Box>
            <Box orientation="vertical" spacing={10} expand>
                <Label className="settings-description" xalign={0}>Enable/disable advanced gestures</Label>
                <SwitchRow key={`gestures-${nonce}`} id="touchpad-gestures-switch" stateId="touchpad-gestures-state" active={state.enabled} sensitive={gestureUsable} label={state.enabled ? 'Enable' : 'Disable'} onToggled={on => void request('gestures', on ? 'on' : 'off')} />
                {list.map(item => <Box key={item.id} id={`touchpad-gesture-item-${item.id}`} orientation="vertical" spacing={2}><Label className="settings-field-title" xalign={0}>{item.title}</Label><Label className="settings-description" xalign={0} wrap>{item.ok || !state.supported ? item.description : `${item.description} · unavailable on this system`}</Label></Box>)}
                <Box spacing={12}><Label className="settings-description">Corner swipe opens</Label><ComboBoxText id="touchpad-gesture-launch" sensitive={gestureUsable} activeId={state.launch} items={state.targets.map(item => ({id: item.id, text: item.title}))} onChanged={w => {const id = w.get_active_id() as GestureTarget | null; if (id && id !== state.launch) void request('launch', id);}} /></Box>
                {ready && state.supported && !state.gesturesAvailable && <Label id="touchpad-gestures-unavailable" className="settings-description" xalign={0} wrap>{`${state.reason} Gestures stay off rather than pretending to work.`}</Label>}
                {ready && !state.supported && <Label id="touchpad-gestures-unsupported" className="settings-description" xalign={0} wrap>{`${state.reason || 'No touchpad was detected.'} Gestures stay off rather than pretending to work.`}</Label>}
                {state.enabled && state.locked && <Label id="touchpad-gestures-locked" className="settings-description" xalign={0} wrap>The touchpad is locked, so gestures are paused.</Label>}
                <Label id="touchpad-gestures-note" className="settings-description" xalign={0} wrap>The pointer still moves while you slide along an edge; gestures only watch the touchpad and do not take it over.</Label>
            </Box>
        </Box>
        {error && <Label id="touchpad-gestures-error" className="settings-error-banner" xalign={0} wrap>{error}</Label>}
    </Box>;
}
