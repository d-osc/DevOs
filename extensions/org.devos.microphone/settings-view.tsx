import {React, Gtk, Box, Label, Button, Image, ScrolledWindow} from '@dev-os/core';
import {AudioSettings} from '../org.devos.settings/audio-view.js';
import type {AudioControls} from '../org.devos.settings/audio.js';

export function MicrophoneSettings({open, controls}: {open(): void; controls?: AudioControls}) {
    return <Box className="settings-content microphone-settings-page" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={6}>
            <Label className="settings-eyebrow" xalign={0}>AUDIO / VOICE &amp; RECORDING</Label>
            <Label className="heading" xalign={0}>Microphone</Label>
            <Label className="settings-description" xalign={0} wrap>A little clarity for every conversation.</Label>
        </Box>
        <ScrolledWindow expand fill minContentHeight={240} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="settings-form" orientation="vertical" spacing={22}>
                <Box className="microphone-settings-hero" spacing={20}>
                    <Box className="microphone-settings-emblem" widthRequest={76} heightRequest={76} valign="center"><Image iconName="audio-input-microphone-symbolic" pixelSize={36} expand /></Box>
                    <Box orientation="vertical" spacing={8} expand valign="center">
                        <Label className="microphone-settings-title" xalign={0}>Make yourself heard.</Label>
                        <Label className="settings-description" xalign={0} wrap>Set your input here. Open Microphone to check your voice and save a recording.</Label>
                        <Label className="microphone-settings-privacy" xalign={0} wrap>Recording starts only when you choose.</Label>
                    </Box>
                </Box>
                <AudioSettings inputOnly controls={controls} />
                <Box className="settings-card microphone-test-card" orientation="vertical" spacing={14}>
                    <Box spacing={12}><Image iconName="audio-volume-high-symbolic" pixelSize={22} /><Box orientation="vertical" spacing={5} expand><Label className="section-heading" xalign={0}>Hear how you sound</Label><Label className="settings-description" xalign={0} wrap>Watch the live input meter, then record a short sample.</Label></Box></Box>
                    <Box><Button id="microphone-settings-open" className="suggested-action" onClicked={open}><Box spacing={9}><Image iconName="media-record-symbolic" pixelSize={16} /><Label>Open Microphone</Label></Box></Button></Box>
                </Box>
                <Box className="microphone-settings-tip" spacing={12}><Image iconName="dialog-information-symbolic" pixelSize={18} valign="start" /><Label className="settings-description" xalign={0} wrap>Start with a moderate input volume. If your voice sounds distorted, lower it and try again.</Label></Box>
            </Box>
        </ScrolledWindow>
    </Box>;
}
