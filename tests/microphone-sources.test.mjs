// Node's type stripping executes this pure helper without a bundle/image build.
import assert from 'node:assert/strict';
import {isMicrophoneSource} from '../extensions/org.devos.camera/sources.ts';
assert.equal(isMicrophoneSource({deviceClass: 'monitor'}), false);
assert.equal(isMicrophoneSource({deviceName: 'alsa_output.platform-sound.stereo.monitor'}), false);
assert.equal(isMicrophoneSource({nodeName: 'alsa_output.usb-headset.monitor'}), false);
assert.equal(isMicrophoneSource({deviceClass: 'sound', deviceName: 'alsa_input.platform-sound.HiFi__Mic__source'}), true);
assert.equal(isMicrophoneSource({deviceName: 'alsa_input.usb-microphone.analog-stereo'}), true);
assert.equal(isMicrophoneSource({deviceName: 'my.monitor.microphone'}), true);
assert.equal(isMicrophoneSource({}), true, 'Unknown metadata must not hide real hardware');
console.log('PASS: microphone inputs retained; speaker monitors excluded');
