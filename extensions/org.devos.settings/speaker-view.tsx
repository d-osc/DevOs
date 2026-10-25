import {React, Box, Label, Image, Scale, ComboBoxText, GLib, useEffect, useRef, useState} from '@dev-os/core';
import {SwitchRow} from './switch-row.js';
import {RadioRow} from './radio-row.js';
import {useHelper} from './use-helper.js';
import {Speaker, soundModes, unsupportedSpeaker, type CustomSlot, type SoundMode, type SpeakerAction, type SpeakerControls, type SpeakerState} from './speaker.js';
const order: SoundMode[] = ['dynamic', 'game', 'movie', 'music', 'voice', 'custom1', 'custom2', 'custom3'];
const bands = ['Bass', 'Mid', 'Treble'] as const;
/** AI Noise-Canceling Speaker and Sound Modes, laid out like the MyASUS cards. */
export function SpeakerSettings({controls}: {controls?: SpeakerControls}) {
    // Pick up outputs that were plugged in and the Voice mode switch while an app records.
    const {state, ready, busy, error, nonce, request} = useHelper<SpeakerState, SpeakerAction>(controls, () => new Speaker(), unsupportedSpeaker, 10);
    const [levels, setLevels] = useState<[number, number, number] | null>(null);
    const pending = useRef(0);
    useEffect(() => () => {if (pending.current) GLib.source_remove(pending.current);}, []);
    const usable = ready && state.supported && !busy, effects = state.supported && state.filters.available;
    const selected: SoundMode = effects ? state.mode : 'dynamic', custom = selected.startsWith('custom') ? selected as CustomSlot : null;
    const shown = custom ? levels ?? state.custom[custom] : [0, 0, 0];
    const change = (index: number, value: number) => {
        if (!custom) return;
        const next = [...shown] as [number, number, number]; next[index] = value; setLevels(next);
        if (pending.current) GLib.source_remove(pending.current);
        pending.current = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {pending.current = 0; void request('custom', custom, ...next.map(String)).then(() => setLevels(null)); return GLib.SOURCE_REMOVE;});
    };
    const voice = effects && state.voice, boost = effects && state.boost;
    return <Box orientation="vertical" spacing={18}>
        <Box id="speaker-voice-card" className="settings-card system-card speaker-voice" spacing={28}>
            <Box orientation="vertical" spacing={8} widthRequest={260}>
                <Box spacing={10}><Image iconName="audio-speakers-symbolic" pixelSize={23} /><Label className="section-heading" xalign={0}>AI Noise-Canceling Speaker</Label></Box>
                <Label className="settings-description" xalign={0} wrap>Filter out all sounds except human voices from the laptop speaker</Label>
                <Label className="settings-field-title" xalign={0}>Choose your output device</Label>
                {state.speakers.length > 0
                    ? <ComboBoxText id="speaker-device" sensitive={usable} activeId={state.device} items={state.speakers.map(speaker => ({id: speaker.name, text: speaker.title}))} onChanged={widget => {const name = widget.get_active_id(); if (name && name !== state.device) void request('device', name);}} />
                    : <Label id="speaker-no-device" className="settings-description" xalign={0} wrap>{ready ? 'No audio output is available.' : 'Finding outputs…'}</Label>}
            </Box>
            <Box orientation="vertical" spacing={10} expand>
                <Label className="settings-description" xalign={0} wrap>Switch on to enable AI Noise-Canceling Speaker.</Label>
                <SwitchRow key={`voice-${nonce}`} id="speaker-voice-switch" stateId="speaker-voice-state" active={voice} sensitive={usable && effects} label={voice ? 'On' : 'Off'} onToggled={on => void request('voice', on ? 'on' : 'off')} />
                <Label id="speaker-voice-note" className="settings-description" xalign={0} wrap>This keeps the voice range (300 Hz to 3.4 kHz) with a filter and cuts everything outside it. It is not an AI model, so noise inside the voice range stays.</Label>
            </Box>
        </Box>
        <Box id="speaker-boost-card" className="settings-card system-card speaker-boost" spacing={28}>
            <Box orientation="vertical" spacing={8} widthRequest={260}>
                <Box spacing={10}><Image iconName="audio-volume-high-symbolic" pixelSize={23} /><Label className="section-heading" xalign={0}>Volume Booster</Label></Box>
                <Label className="settings-description" xalign={0} wrap>Makes all the sounds on your device much louder, with minimum distortion.</Label>
            </Box>
            <Box orientation="vertical" spacing={10} expand>
                <Label className="settings-description" xalign={0} wrap>Switch on to enable Volume Booster.</Label>
                <SwitchRow key={`boost-${nonce}`} id="speaker-boost-switch" stateId="speaker-boost-state" active={boost} sensitive={usable && effects} label={boost ? 'On' : 'Off'} onToggled={on => void request('boost', on ? 'on' : 'off')} />
                <Label id="speaker-boost-note" className="settings-description" xalign={0} wrap>Adds about 9.5 dB of gain and rounds off loud peaks instead of letting them clip. It is not a full limiter, so very loud music can still sound compressed.</Label>
            </Box>
        </Box>
        <Box id="speaker-modes-card" className="settings-card system-card speaker-modes" spacing={28}>
            <Box orientation="vertical" spacing={8} widthRequest={260}>
                <Box spacing={10}><Image iconName="multimedia-volume-control-symbolic" pixelSize={23} /><Label className="section-heading" xalign={0}>Sound Modes</Label></Box>
                <Label className="settings-description" xalign={0} wrap>Select your own sound modes</Label>
                <Label id="speaker-modes-note" className="settings-description" xalign={0} wrap>These are equalizer curves. Dolby Atmos is not available on this system.</Label>
            </Box>
            <Box orientation="vertical" spacing={9} expand>
                {order.map(id => <RadioRow key={`${id}-${nonce}`} id={`speaker-mode-${id}`} selected={state.supported && selected === id} sensitive={usable && (id === 'dynamic' || effects)} title={soundModes[id].title} description={soundModes[id].description} onClicked={() => {if (id !== selected) {setLevels(null); void request('mode', id);}}} />)}
                {custom && effects && bands.map((band, index) => <Box key={`${custom}-${band}`} spacing={12}><Label className="settings-description" widthChars={8} xalign={0}>{band}</Label><Scale id={`speaker-custom-${band.toLowerCase()}`} expand lower={-10} upper={10} value={shown[index]} drawValue={false} sensitive={usable} onValueChanged={w => {const value = Math.round(w.get_value()); if (value !== Math.round(shown[index])) change(index, value);}} /><Label id={`speaker-custom-${band.toLowerCase()}-value`} className="settings-description" widthChars={6}>{`${Math.round(shown[index])} dB`}</Label></Box>)}
                <Label className="settings-field-title" xalign={0}>Voice Mode Smart Switch</Label>
                <Label className="settings-description" xalign={0} wrap>When enabled, Voice mode is used while an app is recording audio, for example during a call.</Label>
                <SwitchRow key={`smart-${nonce}`} id="speaker-smart-switch" stateId="speaker-smart-state" active={state.smart} sensitive={usable && effects} label={state.smart ? 'Enable' : 'Disable'} onToggled={on => void request('smart', on ? 'on' : 'off')} />
                {effects && state.smart && state.effective !== selected && <Label id="speaker-smart-active" className="settings-description" xalign={0} wrap>An app is recording, so Voice mode is in use for now.</Label>}
            </Box>
        </Box>
        {ready && state.supported && !state.filters.available && <Label id="speaker-unavailable" className="settings-description" xalign={0} wrap>{`Sound effects are not available. ${state.filters.reason}`}</Label>}
        {ready && state.supported && state.filters.available && state.warning && <Label id="speaker-warning" className="settings-description" xalign={0} wrap>{state.warning}</Label>}
        {ready && !state.supported && <Label id="speaker-unsupported" className="settings-description" xalign={0} wrap>{`Not available. ${state.reason || 'The audio server is not running.'}`}</Label>}
        {error && <Label id="speaker-error" className="settings-error-banner" xalign={0} wrap>{error}</Label>}
    </Box>;
}
