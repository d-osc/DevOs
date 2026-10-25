import {React, Box, Label, Image, Button, Switch, ComboBoxText, GLib, useEffect, useRef, useState} from '@dev-os/core';
import {Keyboard, fnModes, sleepModes, timeoutTitle, unsupportedKeyboard, type FnMode, type KeyboardAction, type KeyboardControls, type KeyboardState, type SleepMode} from './keyboard.js';
/** Function key, Automatic keyboard backlight and Keyboard backlight sleep mode, laid out like the three MyASUS cards. */
export function KeyboardHotkeySettings({controls}: {controls?: KeyboardControls}) {
    const [backend] = useState(() => controls ?? new Keyboard());
    const [state, setState] = useState<KeyboardState>(unsupportedKeyboard), [ready, setReady] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState(''), [nonce, setNonce] = useState(0);
    const alive = useRef(true), working = useRef(false);
    const request = async (action: KeyboardAction, ...args: string[]) => {
        if (working.current) return; working.current = true;
        setBusy(true); setError('');
        try {const next = await backend.request(action, ...args); if (alive.current) {setState(next); setReady(true);}}
        catch (reason) {if (alive.current) {setError(reason instanceof Error ? reason.message : String(reason)); setNonce(value => value + 1); setReady(true);}}
        finally {working.current = false; if (alive.current) setBusy(false);}
    };
    useEffect(() => {
        alive.current = true; void request('get');
        // Pick up the light level, a changed power source and the Fn lock key.
        const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {if (alive.current && !working.current) void request('get'); return GLib.SOURCE_CONTINUE;});
        return () => {alive.current = false; GLib.source_remove(timer); backend.destroy();};
    }, [backend]);
    const prefs = state.settings, free = ready && !busy;
    const fnUsable = free && state.fn.supported, lightUsable = free && state.backlight.supported && state.sensor.supported, sleepUsable = free && state.backlight.supported && state.idle.supported;
    const radio = (id: string, selected: boolean, title: string, description: string, usable: boolean, click: () => void) =>
        <Button key={`${id}-${nonce}`} id={id} className={`power-mode ${selected ? 'power-mode-selected' : ''}`} sensitive={usable} onClicked={click}>
            <Box spacing={14}><Image iconName={selected ? 'radio-checked-symbolic' : 'radio-symbolic'} pixelSize={18} /><Box orientation="vertical" spacing={3} expand><Label className="settings-field-title" xalign={0}>{title}</Label><Label className="settings-description" xalign={0} wrap>{description}</Label></Box></Box>
        </Button>;
    const toggle = (id: string, title: string, description: string, key: 'auto-brighten' | 'auto-dim', active: boolean) =>
        <Box orientation="vertical" spacing={6}>
            <Label className="settings-field-title" xalign={0}>{title}</Label><Label className="settings-description" xalign={0} wrap>{description}</Label>
            <Box spacing={12}><Switch key={`${id}-${nonce}`} id={id} active={active} sensitive={lightUsable} onActiveChanged={w => {if (w.active !== active) void request('set', key, w.active ? 'on' : 'off');}} /><Label id={`${id}-state`} className="settings-description">{active ? 'On' : 'Off'}</Label></Box>
        </Box>;
    const timer = (id: string, which: 'sleepBoth' | 'sleepBattery', arg: 'sleep-both' | 'sleep-battery', enabled: boolean) =>
        <ComboBoxText key={`${id}-${nonce}`} id={id} sensitive={sleepUsable && enabled} activeId={String(prefs[which])} items={state.timeouts.map(seconds => ({id: String(seconds), text: timeoutTitle(seconds)}))} onChanged={widget => {const value = widget.get_active_id(); if (value && Number(value) !== prefs[which]) void request('set', arg, value);}} />;
    const sleep = (id: SleepMode) => radio(`keyboard-sleep-${id}`, prefs.sleep === id, sleepModes[id].title, sleepModes[id].description, sleepUsable, () => {if (prefs.sleep !== id) void request('set', 'sleep', id);});
    return <Box orientation="vertical" spacing={18}>
        <Box id="keyboard-fn-card" className="settings-card system-card keyboard-fn" spacing={28}>
            <Box orientation="vertical" spacing={8} widthRequest={260}>
                <Box spacing={10}><Image iconName="input-keyboard-symbolic" pixelSize={23} /><Label className="section-heading" xalign={0}>Function key</Label></Box>
                <Label className="settings-description" xalign={0} wrap>An optional function key setting that allows you to change your keyboard hotkeys.</Label>
            </Box>
            <Box orientation="vertical" spacing={9} expand>
                {(['locked', 'normal'] as FnMode[]).map(id => radio(`keyboard-fn-${id}`, state.fn.supported && state.fn.mode === id, fnModes[id].title, fnModes[id].description, fnUsable, () => {if (state.fn.mode !== id) void request('set', 'fn', id);}))}
                {ready && !state.fn.supported && <Label id="keyboard-fn-unsupported" className="settings-description" xalign={0} wrap>{`Not supported on this device. ${state.fn.reason || 'The kernel does not provide an Fn lock control.'} The hotkeys keep working the way the firmware sends them.`}</Label>}
            </Box>
        </Box>
        <Box id="keyboard-light-card" className="settings-card system-card keyboard-light" spacing={28}>
            <Box orientation="vertical" spacing={8} widthRequest={260}>
                <Box spacing={10}><Image iconName="keyboard-brightness-symbolic" pixelSize={23} /><Label className="section-heading" xalign={0}>Automatic keyboard backlight</Label></Box>
                <Label className="settings-description" xalign={0} wrap>Automatically adjusts the keyboard backlight brightness based on the current light conditions using the built-in ambient light sensor.</Label>
                {state.sensor.supported && state.sensor.lux !== null && <Label id="keyboard-lux" className="settings-description" xalign={0}>{`Ambient light: ${Math.round(state.sensor.lux)} lux`}</Label>}
            </Box>
            <Box orientation="vertical" spacing={16} expand>
                {toggle('keyboard-auto-brighten', 'Auto-brighten', 'The keyboard backlight turns on when the light conditions change from bright to dark.', 'auto-brighten', lightUsable && prefs.autoBrighten)}
                {toggle('keyboard-auto-dim', 'Auto-dim', 'The keyboard backlight turns off when the light conditions change from dark to bright.', 'auto-dim', lightUsable && prefs.autoDim)}
                {ready && !state.backlight.supported && <Label id="keyboard-light-unsupported" className="settings-description" xalign={0} wrap>{`Not supported on this device. ${state.backlight.reason}`}</Label>}
                {ready && state.backlight.supported && !state.sensor.supported && <Label id="keyboard-light-nosensor" className="settings-description" xalign={0} wrap>{`Not supported on this device. ${state.sensor.reason}`}</Label>}
            </Box>
        </Box>
        <Box id="keyboard-sleep-card" className="settings-card system-card keyboard-sleep" spacing={28}>
            <Box orientation="vertical" spacing={8} widthRequest={260}>
                <Box spacing={10}><Image iconName="preferences-system-time-symbolic" pixelSize={23} /><Label className="section-heading" xalign={0}>Keyboard backlight sleep mode</Label></Box>
                <Label className="settings-description" xalign={0} wrap>Automatically turns off the keyboard backlight based on your preferences. You can set the idle time for the backlight to turn off when running on battery or running either on battery or AC power.</Label>
            </Box>
            <Box orientation="vertical" spacing={9} expand>
                {sleep('nothing')}
                {sleep('both')}{timer('keyboard-timeout-both', 'sleepBoth', 'sleep-both', prefs.sleep === 'both')}
                {sleep('battery')}{timer('keyboard-timeout-battery', 'sleepBattery', 'sleep-battery', prefs.sleep === 'battery')}
                {ready && state.backlight.supported && !state.idle.supported && <Label id="keyboard-sleep-unsupported" className="settings-description" xalign={0} wrap>{`Not supported in this session. ${state.idle.reason}`}</Label>}
                {ready && !state.backlight.supported && <Label id="keyboard-sleep-nobacklight" className="settings-description" xalign={0} wrap>{`Not supported on this device. ${state.backlight.reason}`}</Label>}
            </Box>
        </Box>
        {error && <Label id="keyboard-hotkey-error" className="settings-error-banner" xalign={0} wrap>{error}</Label>}
    </Box>;
}
