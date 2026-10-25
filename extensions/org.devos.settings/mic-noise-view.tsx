import {React, Box, Label, Image, Button, ComboBoxText, GLib, useEffect, useRef, useState} from '@dev-os/core';
import {MicNoise, noiseModes, unsupportedMicNoise, type MicNoiseAction, type MicNoiseControls, type MicNoiseState, type NoiseMode} from './mic-noise.js';
/** AI Noise-Canceling Microphone, laid out like the MyASUS card: device choice on the left, mode radios on the right. */
export function MicNoiseSettings({controls}: {controls?: MicNoiseControls}) {
    const [backend] = useState(() => controls ?? new MicNoise());
    const [state, setState] = useState<MicNoiseState>(unsupportedMicNoise), [ready, setReady] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState(''), [nonce, setNonce] = useState(0);
    const alive = useRef(true), working = useRef(false);
    const request = async (action: MicNoiseAction, ...args: string[]) => {
        if (working.current) return; working.current = true;
        setBusy(true); setError('');
        try {const next = await backend.request(action, ...args); if (alive.current) {setState(next); setReady(true);}}
        catch (reason) {if (alive.current) {setError(reason instanceof Error ? reason.message : String(reason)); setNonce(value => value + 1); setReady(true);}}
        finally {working.current = false; if (alive.current) setBusy(false);}
    };
    useEffect(() => {
        alive.current = true; void request('get');
        // Pick up a microphone that was plugged in or removed.
        const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {if (alive.current && !working.current) void request('get'); return GLib.SOURCE_CONTINUE;});
        return () => {alive.current = false; GLib.source_remove(timer); backend.destroy();};
    }, [backend]);
    const usable = ready && state.supported && !busy, noise = state.supported && state.noise.available;
    const selected: NoiseMode = noise ? state.mode : 'authentic';
    const radio = (id: NoiseMode) => {
        const offered = id === 'authentic' || noise;
        return <Button key={`${id}-${nonce}`} id={`mic-mode-${id}`} className={`power-mode ${state.supported && selected === id ? 'power-mode-selected' : ''}`} sensitive={usable && offered} onClicked={() => {if (id !== selected) void request('mode', id);}}>
            <Box spacing={14}><Image iconName={state.supported && selected === id ? 'radio-checked-symbolic' : 'radio-symbolic'} pixelSize={18} /><Box orientation="vertical" spacing={3} expand><Label className="settings-field-title" xalign={0}>{noiseModes[id].title}</Label><Label className="settings-description" xalign={0} wrap>{noiseModes[id].description}</Label></Box></Box>
        </Button>;
    };
    return <Box id="mic-noise-card" className="settings-card system-card mic-noise" spacing={28}>
        <Box orientation="vertical" spacing={8} widthRequest={260}>
            <Box spacing={10}><Image iconName="audio-input-microphone-symbolic" pixelSize={23} /><Label className="section-heading" xalign={0}>AI Noise-Canceling Microphone</Label></Box>
            <Label className="settings-description" xalign={0} wrap>Suppresses ambient noise and normalizes all individual voices</Label>
            <Label className="settings-field-title" xalign={0}>Choose your input device</Label>
            {state.sources.length > 0
                ? <ComboBoxText id="mic-noise-device" sensitive={usable} activeId={state.device} items={state.sources.map(source => ({id: source.name, text: source.title}))} onChanged={widget => {const name = widget.get_active_id(); if (name && name !== state.device) void request('device', name);}} />
                : <Label id="mic-noise-no-device" className="settings-description" xalign={0} wrap>{ready ? 'No microphone is connected.' : 'Finding microphones…'}</Label>}
        </Box>
        <Box orientation="vertical" spacing={14} expand>
            <Label className="settings-field-title" xalign={0}>General Noise Canceling</Label>
            <Box orientation="vertical" spacing={9}>{radio('general')}{radio('authentic')}</Box>
            <Label className="settings-field-title" xalign={0}>Conference AI Noise Canceling</Label>
            <Box orientation="vertical" spacing={9}>{radio('conference')}</Box>
            {ready && state.supported && !state.noise.available && <Label id="mic-noise-unavailable" className="settings-description" xalign={0} wrap>{`Noise canceling is not available. ${state.noise.reason}`}</Label>}
            {ready && state.supported && state.warning && state.noise.available && <Label id="mic-noise-warning" className="settings-description" xalign={0} wrap>{state.warning}</Label>}
            {ready && !state.supported && <Label id="mic-noise-unsupported" className="settings-description" xalign={0} wrap>{`Not available. ${state.reason || 'The audio server is not running.'}`}</Label>}
            {state.supported && noise && <Label id="mic-noise-note" className="settings-description" xalign={0} wrap>Processing uses WebRTC noise suppression and gain control on this device, not a speech-separation model.</Label>}
            {error && <Label id="mic-noise-error" className="settings-error-banner" xalign={0} wrap>{error}</Label>}
        </Box>
    </Box>;
}
