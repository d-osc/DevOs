import {React, Box, Label, Image, Button, Switch, Scale, ComboBoxText, GLib, useEffect, useRef, useState} from '@dev-os/core';
import {DisplayCare, splendidModes, unsupportedDisplayCare, type DisplayCareAction, type DisplayCareControls, type DisplayCareState, type CareSettings, type Splendid} from './display-care.js';

/** A slider that follows the saved value, but never fights the hand: it saves once the thumb stops moving. */
function Slider({id, value, lower, upper, sensitive, commit}: {id: string; value: number; lower: number; upper: number; sensitive: boolean; commit(value: number): void}) {
    const [shown, setShown] = useState(value), timer = useRef(0);
    useEffect(() => {if (!timer.current) setShown(value);}, [value]);
    useEffect(() => () => {if (timer.current) GLib.source_remove(timer.current);}, []);
    return <Scale id={id} expand value={shown} lower={lower} upper={upper} sensitive={sensitive} drawValue onValueChanged={widget => {
        const next = Math.round(widget.get_value()); if (next === shown) return; setShown(next);
        if (timer.current) GLib.source_remove(timer.current);
        timer.current = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {timer.current = 0; if (next !== value) commit(next); return GLib.SOURCE_REMOVE;});
    }} />;
}
const onOff = (value: boolean) => value ? 'On' : 'Off';
function Toggle({id, title, description, notice, note, active, sensitive, nonce, change}: {id: string; title: string; description: string; notice?: string; note?: string; active: boolean; sensitive: boolean; nonce: number; change(value: boolean): void}) {
    return <Box orientation="vertical" spacing={8}>
        <Label className="settings-field-title" xalign={0} wrap>{title}</Label>
        <Label className="settings-description" xalign={0} wrap>{description}</Label>
        {notice && <Label className="settings-notice" xalign={0} wrap>{notice}</Label>}
        <Box spacing={12}><Switch key={`${id}-${nonce}`} id={`${id}-switch`} active={active} sensitive={sensitive} onActiveChanged={w => {if (w.active !== active) change(w.active);}} /><Label id={`${id}-state`} className="settings-description">{onOff(active)}</Label></Box>
        {note && <Label id={`${id}-note`} className="settings-description" xalign={0} wrap>{note}</Label>}
    </Box>;
}
function Heading({icon, title, description}: {icon: string; title: string; description?: string}) {
    return <><Box spacing={10}><Image iconName={icon} pixelSize={23} /><Label className="section-heading" xalign={0}>{title}</Label></Box>{description && <Label className="settings-description" xalign={0} wrap>{description}</Label>}</>;
}

/** OLED Care, Flicker-Free Dimming, Splendid and Target Mode / Adaptive Edge Brightness, laid out like the MyASUS cards. */
export function DisplayCareSettings({controls}: {controls?: DisplayCareControls}) {
    const [backend] = useState(() => controls ?? new DisplayCare());
    const [state, setState] = useState<DisplayCareState>(unsupportedDisplayCare), [ready, setReady] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState(''), [nonce, setNonce] = useState(0), [resetNote, setResetNote] = useState('');
    const alive = useRef(true), queue = useRef<Promise<unknown>>(Promise.resolve());
    // Requests run one at a time: the helper rewrites one file, so two at once could lose a value.
    const request = (action: DisplayCareAction, ...args: string[]) => {
        setBusy(true); setError('');
        const run = queue.current.then(async () => {
            try {const next = await backend.request(action, ...args); if (alive.current) {setState(next); setReady(true); if (action === 'reset') setResetNote(next.brightness && !next.brightness.ok ? `The brightness could not be restored: ${next.brightness.reason}` : '');}}
            catch (reason) {if (alive.current) {setError(reason instanceof Error ? reason.message : String(reason)); setNonce(value => value + 1);}}
        });
        queue.current = run.finally(() => {if (alive.current) setBusy(false);});
    };
    const set = (key: keyof CareSettings, value: string | number | boolean) => request('set', key, typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value));
    useEffect(() => {
        alive.current = true; request('get');
        // A charger being unplugged changes what Adaptive Edge Brightness does.
        const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {if (alive.current) request('get'); return GLib.SOURCE_CONTINUE;});
        return () => {alive.current = false; GLib.source_remove(timer); backend.destroy();};
    }, [backend]);
    const s = state.settings, usable = ready && !busy, colour = ready && state.gamma.available;
    const unsupported = (id: string, available: boolean, reason: string, fallback: string) => ready && !available && <Label id={id} className="settings-description" xalign={0} wrap>{`Not supported on this device. ${reason || fallback} Controls stay off rather than pretending to work.`}</Label>;
    const modes: Splendid[] = ['normal', 'vivid', 'manual', 'eyecare'];
    return <Box orientation="vertical" spacing={16}>
        <Box id="oled-care-card" className="settings-card system-card oled-care" spacing={28}>
            <Box orientation="vertical" spacing={8} widthRequest={260}>
                <Heading icon="video-display-symbolic" title="OLED Care" description="OLED Care includes a set of optimization settings that's proven to protect your OLED display and maximize display lifespan." />
                <Label className="settings-notice" xalign={0} wrap>Notice: Avoid displaying static images at maximum brightness for extended periods; otherwise, it might cause permanent burn-in damage to your OLED display.</Label>
                <Label id="pixel-shift-notice" className="settings-notice" xalign={0} wrap>To preserve long-term screen quality, Pixel Shift is permanently enabled and cannot be disabled: the panel moves by up to 2 pixels every few minutes.</Label>
            </Box>
            <Box orientation="vertical" spacing={18} expand>
                <Toggle id="pixel-refresh" title="Pixel refresh" description="Launch a special screen saver after being idle for 30 minutes. This screen saver refreshes your screen pixels and optimizes picture quality." notice="*To prevent permanent burn-in damage to your OLED display, we strongly suggest that you always leave this feature enabled." active={s.pixelRefresh} sensitive={usable && state.idle.available} nonce={nonce} change={value => set('pixelRefresh', value)}
                    note={ready && !state.idle.available ? `Not supported on this device. ${state.idle.reason || 'The compositor does not report idle time.'}` : undefined} />
                <Toggle id="panel-autohide" title="Automatically hide the panel in desktop mode" description="Automatically hide the panel in desktop mode when not in use to avoid consistently showing static images. Move the pointer to the screen edge to bring it back." active={s.autoHidePanel} sensitive={usable} nonce={nonce} change={value => set('autoHidePanel', value)} />
                <Toggle id="panel-transparency" title="Panel transparency effect" description="Enable a semi-transparent effect on the panel." active={s.panelTransparency} sensitive={usable} nonce={nonce} change={value => set('panelTransparency', value)} />
            </Box>
        </Box>
        <Box id="flicker-card" className="settings-card system-card flicker-free" spacing={28}>
            <Box orientation="vertical" spacing={8} widthRequest={260}>
                <Heading icon="display-brightness-symbolic" title="OLED Flicker-Free Dimming" description="For a better visual experience and to reduce the possibility of OLED flickering at low brightness levels, use Flicker-Free Dimming to adjust the display brightness." />
                <Label className="settings-notice" xalign={0} wrap>Notice</Label>
                <Label className="settings-notice" xalign={0} wrap>*To enjoy high-fidelity images while protecting your eyes, please make sure your system brightness is set above 60%, then adjust the Flicker-Free Dimming slider on the right-hand side to a level that suits your needs.</Label>
                <Label className="settings-notice" xalign={0} wrap>*Image quality may be slightly affected when this feature is in use. This is normal and does not affect use of the display.</Label>
            </Box>
            <Box orientation="vertical" spacing={10} expand>
                <Label className="settings-description" xalign={0}>Drag to adjust the dimming level of your OLED panel</Label>
                <Slider id="dimming-scale" value={s.dimming} lower={0} upper={100} sensitive={colour} commit={value => set('dimming', value)} />
                <Label className="settings-description" xalign={0} wrap>Dimming lowers the value of every pixel through the compositor's gamma table, so the panel never pulses. It is applied on top of the brightness keys and never goes fully black.</Label>
                {unsupported('flicker-unsupported', state.gamma.available, state.gamma.reason, 'The compositor does not offer gamma control.')}
            </Box>
        </Box>
        <Box id="splendid-card" className="settings-card system-card splendid" spacing={28}>
            <Box orientation="vertical" spacing={8} widthRequest={260}>
                <Heading icon="preferences-color-symbolic" title="Splendid" description="Optimize the color of your screen with Gamma and Color temperature correction." />
                <Label className="settings-field-title" xalign={0}>Display Settings</Label>
                <Label className="settings-description" xalign={0} wrap>Restore the display settings, which include Splendid, Color Gamut, OLED Flicker-Free Dimming and Brightness to the recommended settings.</Label>
                <Button id="splendid-reset" className="settings-primary" sensitive={usable} onClicked={() => request('reset')}>Reset to recommended settings</Button>
                {resetNote && <Label id="splendid-reset-note" className="settings-description" xalign={0} wrap>{resetNote}</Label>}
            </Box>
            <Box orientation="vertical" spacing={12} expand>
                {modes.map(id => <Button key={`${id}-${nonce}`} id={`splendid-${id}`} className={`power-mode ${s.splendid === id ? 'power-mode-selected' : ''}`} sensitive={colour && !busy} onClicked={() => {if (s.splendid !== id) set('splendid', id);}}>
                    <Box spacing={14}><Image iconName={s.splendid === id ? 'radio-checked-symbolic' : 'radio-symbolic'} pixelSize={18} /><Box orientation="vertical" spacing={6} expand>
                        <Label className="settings-field-title" xalign={0}>{splendidModes[id].title}</Label>
                        <Label className="settings-description" xalign={0} wrap>{splendidModes[id].description}</Label>
                        {id === 'vivid' && <Label id="splendid-vivid-note" className="settings-description" xalign={0} wrap>This panel path cannot raise saturation per colour, so Vivid is a contrast boost with fixed black and white points.</Label>}
                    </Box></Box>
                </Button>)}
                <Box orientation="vertical" spacing={4}>
                    <Label className="settings-description" xalign={0}>Manual color temperature (-50 warm … +50 cool)</Label>
                    <Slider id="splendid-temperature-scale" value={s.temperature} lower={-50} upper={50} sensitive={colour && s.splendid === 'manual'} commit={value => set('temperature', value)} />
                    <Label className="settings-description" xalign={0}>Eye Care strength (1 … 5)</Label>
                    <Slider id="splendid-eyecare-scale" value={s.eyeCare} lower={1} upper={5} sensitive={colour && s.splendid === 'eyecare'} commit={value => set('eyeCare', value)} />
                </Box>
                <Button id="splendid-ereading" className="power-mode" sensitive={false}>
                    <Box spacing={14}><Image iconName="radio-symbolic" pixelSize={18} /><Box orientation="vertical" spacing={6} expand>
                        <Label className="settings-field-title" xalign={0}>{splendidModes.ereading.title}</Label>
                        <Label className="settings-description" xalign={0} wrap>{splendidModes.ereading.description}</Label>
                        <Label id="splendid-ereading-note" className="settings-description" xalign={0} wrap>{`Not supported on this device. ${state.ereading.reason || 'A gamma table cannot remove colour.'}`}</Label>
                    </Box></Box>
                </Button>
                <Box orientation="vertical" spacing={6}>
                    <Label className="settings-field-title" xalign={0}>Color Gamut</Label>
                    <Label className="settings-description" xalign={0} wrap>Select the screen color gamut that best meets your requirements.</Label>
                    <ComboBoxText id="gamut-select" sensitive={false} activeId="native" items={[{id: 'native', text: 'Native - Default vivid colors'}]} />
                    <Label id="gamut-note" className="settings-description" xalign={0} wrap>{`sRGB and DCI-P3 are not available. ${state.gamut.reason || 'The compositor has no colour management.'}`}</Label>
                </Box>
                {unsupported('splendid-unsupported', state.gamma.available, state.gamma.reason, 'The compositor does not offer gamma control.')}
            </Box>
        </Box>
        <Box id="target-card" className="settings-card system-card target-mode" spacing={28}>
            <Box orientation="vertical" spacing={8} widthRequest={260}>
                <Heading icon="view-fullscreen-symbolic" title="Target Mode" description="When enabled, the brightness of the active window will remain unchanged, whereas non-active areas will be dimmed for power saving." />
                <Label className="settings-notice" xalign={0} wrap>Note: The dimming layer never blocks clicks and never covers the panel. With the panel hidden, the whole screen except the active window is dimmed.</Label>
            </Box>
            <Box orientation="vertical" spacing={18} expand>
                <Toggle id="target-mode" title="Switch on to enable Target Mode." description="Everything except the active window is covered by a translucent dark layer. On an OLED panel darker pixels draw less power, but a lower backlight saves more." active={s.targetMode} sensitive={usable} nonce={nonce} change={value => set('targetMode', value)} />
            </Box>
        </Box>
        <Box id="edge-card" className="settings-card system-card edge-brightness" spacing={28}>
            <Box orientation="vertical" spacing={8} widthRequest={260}>
                <Heading icon="battery-good-symbolic" title="Adaptive Edge Brightness" description="Save battery power by automatically dimming the edges of your screen. This reduces power consumption without significantly impacting image quality (brightness only; contrast is not changed)." />
                <Label className="settings-notice" xalign={0} wrap>This feature is only supported in DC mode.</Label>
            </Box>
            <Box orientation="vertical" spacing={10} expand>
                <Label className="settings-description" xalign={0}>Adjust the brightness of the screen edges (0 = off)</Label>
                <Slider id="edge-scale" value={s.edgeBrightness} lower={0} upper={4} sensitive={ready && state.battery.present} commit={value => set('edgeBrightness', value)} />
                {ready && state.battery.present && <Label id="edge-source" className="settings-description" xalign={0} wrap>{state.battery.onBattery ? 'Running on battery: the edges are dimmed.' : 'Plugged in: the edges stay at full brightness until you unplug.'}</Label>}
                {ready && !state.battery.present && <Label id="edge-unsupported" className="settings-description" xalign={0} wrap>Not supported on this device. No battery was found, so there is no battery mode.</Label>}
            </Box>
        </Box>
        {error && <Label id="display-care-error" className="settings-error-banner" xalign={0} wrap>{error}</Label>}
    </Box>;
}
