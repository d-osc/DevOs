# Camera and Microphone

Open **Dev OS Camera** or **Dev OS Microphone** from Applications, or run
`dev-os-shell camera` / `dev-os-shell microphone`.

Camera provides a native GTK live preview, device selection and JPEG photos in
`~/Pictures/Camera`. It supports raw and MJPEG video through GStreamer decodebin.
Microphone provides device selection, a live input meter and WAV recording in
`~/Music/Recordings`. Stop & save finalizes the WAV header; closing a recording
window waits for saving. Neither app starts capturing on launch. Stop, device
errors and window closure release capture resources. Refresh devices after
connecting new hardware. Device errors remain visible in the window.

The driver path is Camera → GStreamer V4L2 provider/source → Linux video4linux2
→ UVC driver → USB camera. MIPI cameras use the libcamera GStreamer provider
→ libcamera pipeline/SoftISP → media-controller, CAMSS/CSI and sensor drivers.
The image includes `libcamera-gst` and enables the recipe's `gst` option so
Gst.DeviceMonitor can enumerate these cameras. Microphone uses the GStreamer audio device provider
→ PulseAudio protocol → PipeWire/WirePlumber → ALSA kernel driver. The image
enables UVC, USB audio, HDA and virtio sound; it installs the GTK, JPEG, V4L2,
PulseAudio, level and WAV GStreamer plugins. There is no replacement kernel
driver or root capture process. Device permissions follow the active Linux
session. Vendor-only cameras still need their own kernel driver/firmware.

Existing WSL installations: run `sh tools/setup/bootstrap-media.sh`. WSL must
expose a camera device to Linux (for example USB passthrough) before Camera can
find it; adding a GUI does not expose the Windows camera automatically. QEMU
likewise needs an attached capture device. The updated image needs rebuilding
to include the new apps and drivers.

Validation: `npm run build`, then
`GDK_BACKEND=x11 DEV_OS_ROOT="$PWD" gjs -m dist/media-live-test.js` on Linux.
The test uses explicit GStreamer video/audio test sources, validates a JPEG
and a finalized WAV, checks live levels and missing-device errors, opens both
native windows and writes screenshots under `build/live-usb`. Production UI
never substitutes a test source for missing hardware. Physical capture must
also be checked on the target machine with its actual devices.

UX3407NA built-in microphone diagnosis (2026-10-23): captured hardware logs
report `Failed to get the verb HiFi`. The existing four-speaker board DTB
does not match the pinned ASUS UCM configuration's two-speaker controls and
DMIC0/DMIC1 capture route. Board preparation now composes the audio override
with the EC correction, so preparing one no longer drops the other. USB staging
requires matching audio provenance and rejects old board bundles. The UCM
router also recognizes the ASUS sound-card long name, retaining upstream DMI
selection for other Glymur machines. Microphone excludes speaker monitor sources.

These are source corrections; no image or USB was rebuilt for this change.
Actual built-in microphone signal and WAV recording require verification on
the ASUS after a future authorized build. Non-building checks:
`npm run typecheck`, `node tests/microphone-sources.test.mjs`,
`python3 tests/board-audio.test.py` and `python3 tests/live-usb.test.py`.

Native USB boot `3367a468-2b86-4069-a398-2b182a7b8f84` subsequently showed
that the ALSA card exists and ADSP boots, while both Settings and Microphone
have no input. Its short name is `GLYMUR-ASUS-Zenbook-A14-UX3407N`, but its
long name is `ASUSTeKCOMPUTERINC.-ZenbookA14UX3407NA-1.0-UX3407NA`.
The local UCM router incorrectly matched the DT model against `${CardLongName}`.
It now uses `${CardName}`, with a regression check using these actual identities.
This fixes that selection condition; native signal/capture validation is still
required. Diagnostic collection now includes ALSA capture PCMs, Pulse cards,
profiles, input sources and UCM verbs, without starting a recording or changing
audio profiles. No image or USB update is implied by the source fix.

## UX3407NA camera investigation (2026-10-23)

The user reports no camera in the list. Windows enumerates Qualcomm Spectra
MIPI/ISP devices, not a USB UVC camera. Its installed front-sensor extension
contains OV02C10 module/tuning data. This identifies the software family, but
does not prove the board's exact GPIO, regulator or CSI wiring.

The inspected upstream UX3407NA DTS has no enabled camera sensor graph.
The A16 DTS in the same tree has camera nodes, but its wiring must not be
assumed identical: a sensor driver and a GStreamer plugin cannot create a
missing board graph. No speculative A16 GPIO/power configuration was enabled.

Source changes add the missing libcamera GStreamer runtime to the image and
camera evidence to `tools/live/collect-native-readiness.sh`: `cam -l`, provider
availability, device permissions, bound drivers, DT status and media graphs.
It does not capture photos or change driver state. From a native Live boot:

```sh
sh tools/live/collect-native-readiness.sh /tmp/devos-camera-report
```

Hardware enablement remains incomplete pending the target's camera report and
verified UX3407NA sensor/CCI/CSI/regulator wiring. WSL subsequently became
available. Inspection of the pinned source confirms that the Glymur CAMSS
match, SoC camera nodes and PM8010 support are absent, despite OV02C10, CCI,
CAMSS and camera clock drivers being enabled in the kernel configuration.
The upstream CAMSS driver-match patch was saved under
`native/kernel/ux3407na-camera/` and dry-run checked without fuzz. It is only
one dependency and is not advertised as a working camera fix.
The following work prepared all 11 CAMSS/CCI/MCLK and PM8010 dependency patches
with source and patch hashes, plus a source preparation helper. Applying the
complete stack to temporary copies passed without fuzz. Board sensor/power/CSI
wiring remains unresolved; the stack does not yet make the A14 camera usable.
No image was built and no USB was written. Existing Live USB media are unchanged.

References: [libcamera GStreamer integration](https://libcamera.org/getting-started.html),
[Qualcomm laptop kernel board source](https://github.com/linux-msm/laptops-kernel/blob/c9f622e03e7143c38d0910656354e703f3eba823/arch/arm64/boot/dts/qcom/glymur-asus-zenbook-a14-ux3407na.dts),
[wrynose libcamera recipe](https://github.com/openembedded/meta-openembedded/blob/wrynose/meta-multimedia/recipes-multimedia/libcamera/libcamera_0.6.0.bb).


## AI Noise-Canceling Microphone (2026-10-25)

Settings > Microphone has an "AI Noise-Canceling Microphone" card modelled on MyASUS: a "Choose your input device" dropdown and a
radio group, **General Noise Canceling** (360° Recording Mode, Authentic Recording) and **Conference AI Noise Canceling**
(Multi-presenter Mode). It is separate from the plain Input card above it (volume, mute); both set the default input.

What each mode really does (PipeWire + WirePlumber, no other audio stack):

| Mode | Backend |
| --- | --- |
| Authentic Recording (default) | No processing. The chosen real microphone is the default input and the filter service is stopped. |
| 360° Recording Mode | PipeWire `libpipewire-module-echo-cancel` with the WebRTC plugin (`aec/libspa-aec-webrtc`): noise suppression (high level), high-pass filter, transient suppression. It becomes a virtual source `devos-mic-clean` that is made the default input. |
| Multi-presenter Mode | The same plus the WebRTC adaptive gain control, which evens out loud (near) and quiet (far) voices. |

**Not provided:** speaker identification or separation, a trained "AI" denoiser (RNNoise is not in the OE layers used here) and
beamforming (the WebRTC library shipped, `webrtc-audio-processing-2`, has none). The UI says so; Multi-presenter Mode is described
as noise filtering plus level evening and states that it does not tell speakers apart. Echo cancellation is part of the module but
no far-end reference is routed, so it is not claimed either.

| Piece | Role |
| --- | --- |
| `bin/dev-os-microphone` | Python 3, runs as the user (no root, no polkit). `get`, `mode <authentic\|general\|conference>`, `device <node.name>`, `apply`, plus `serve` and `finish` for the service. JSON output. Lists `Audio/Source` nodes from `pw-dump` (monitors, sinks and its own `devos-mic-*` nodes are hidden), sets defaults with `wpctl set-default`. |
| `~/.config/devos/microphone.json` | State: `mode` and `device` (the PipeWire `node.name`). Corrupt or unknown values mean Authentic Recording. |
| `~/.config/devos/microphone-filter.conf` | PipeWire client config generated by `serve` (device, WebRTC switches per mode); never edit it. |
| `devos-microphone.service` (user unit, `/usr/lib/systemd/user`) | `serve` execs `pipewire -c` with that config, `ExecStartPost` runs `finish` (waits for the virtual source, sets the default input, puts the default output back if the virtual reference sink took it). Started at login by `devos-desktop`; the audio daemon is never restarted when switching. |
| Live USB | There is no unit in the Ubuntu-based Live image; the helper falls back to a transient user unit (`systemd-run --user`, `devos-microphone-session.service`) and `distro/usb/root-session` runs `dev-os-microphone apply` at login. |
| OE image | `pipewire-tools` (pw-dump), `pipewire-modules-echo-cancel`, `pipewire-spa-plugins-aec-webrtc` (+ `webrtc-audio-processing-2`) are in `IMAGE_INSTALL`; they already build with the wrynose PipeWire 1.6.8 default `webrtc-echo-cancelling`. |

If `libpipewire-module-echo-cancel.so` or `libspa-aec-webrtc.so` is missing (on Ubuntu: `libpipewire-0.3-modules`, `libspa-0.2-modules`)
the two noise modes are shown disabled with the missing package named, and a saved noise mode is ignored with a warning.

Check on the laptop: `dev-os-microphone get`, `pw-dump | grep -c devos-mic`, `wpctl status`, `systemctl --user status devos-microphone`,
`journalctl --user -u devos-microphone`, `ls /usr/lib/*/spa-0.2/aec /usr/lib/*/pipewire-0.3/libpipewire-module-echo-cancel.so`.

Validation: `python3 tests/microphone-noise.test.py` (helper against a fake `pw-dump`/`wpctl`/`systemctl`/`pipewire`: device list,
unavailable plugins, every mode, default input and output, login apply, transient-unit fallback, generated config, bad state),
`node tools/build/build.ts` then `gjs -m dist/mic-noise-ui-test.js` (card text, dropdown, radios, unavailable and no-audio states),
`distro/oe/build.sh --parse`. **Not verified on real hardware:** that the WebRTC module loads and passes audio on the UX3407NA with
the board microphone array (node names, channel count of the array source, `target.object` linking), the audible effect and CPU
cost of the modes, that WirePlumber keeps `devos-mic-clean` as default across a reboot and does not make the virtual reference sink
the default output, whether the Ubuntu Live packages ship the module and plugin, and the user unit on a booted image.

## AI Noise-Canceling Speaker and Sound Modes (2026-10-25)

Settings > System > Sound has two more MyASUS-style cards under the Output card: "AI Noise-Canceling Speaker" (switch plus
"Choose your output device"), "Volume Booster" and "Sound Modes" (Dynamic, Game, Movie, Music, Voice, Custom 1-3 and "Voice Mode Smart Switch").

What they really do (PipeWire `filter-chain` with the built-in biquad filters, `bin/dev-os-speaker`):

| Control | Backend |
| --- | --- |
| AI Noise-Canceling Speaker | A **voice-band filter**: 2x high-pass 300 Hz and 2x low-pass 3.4 kHz (24 dB/octave). It removes sounds outside the human voice range. It is not a trained model and does not remove noise inside the voice range; the card says so. |
| Dynamic | No processing at all (no filter process runs). |
| Game / Movie / Music / Voice | Equalizer curves: low shelf 100 Hz, peaking 1 kHz, high shelf 8 kHz (Game: 120 Hz / 3 kHz / 8 kHz; Voice: -4 dB at 150 Hz, +4 dB at 2 kHz). A `linear` stage adds headroom equal to the largest boost so the curves do not clip. |
| Custom 1-3 | Bass, mid, treble in -10..+10 dB per slot; all zero means no processing. |
| Volume Booster | Last stage of the chain: +9.5 dB (x3) gain into a soft saturator `g / (1 + abs(g))` built from the built-in `linear`, `abs`, `recip` and `mult` nodes, then make-up gain x1.333 so full scale stays full scale. Quiet and mid-level sounds get much louder and peaks are rounded rather than hard-clipped. It is **not** a look-ahead limiter or compressor (the built-in plugin has none), so loud music is audibly compressed; the card says so. It works together with the voice filter and the sound modes. |
| Voice Mode Smart Switch (on by default) | While an application records audio (a `Stream/Input/Audio` node that is not a level meter or a Dev OS filter) for two polls, the Voice curve is used; it returns three quiet polls later. The filter process is rebuilt for the switch, so expect a brief audio gap. |

**Not provided:** Dolby Atmos or any spatial/object audio, speaker virtualization, AI voice isolation. The UI states that Dolby Atmos
is not available and the descriptions describe the curves, not Dolby features.

| Piece | Role |
| --- | --- |
| `bin/dev-os-speaker` | Python 3, user level. `get`, `voice on\|off`, `boost on\|off`, `mode <id>`, `smart on\|off`, `device <node.name>`, `custom <slot> <bass> <mid> <treble>`, `apply`, `serve`. Imports the PipeWire plumbing (`snapshot`, `wpctl`, plugin checks) from `dev-os-microphone` in the same directory. |
| `~/.config/devos/speaker.json` | State: `mode`, `voice`, `smart`, `device`, `custom`. Corrupt values mean Dynamic with the filter off. |
| `~/.config/devos/speaker-filter.conf` | Generated PipeWire client config: a virtual sink `devos-spk-fx` whose biquad chain feeds the chosen real output (`target.object`, `node.dont-fallback`). |
| `devos-speaker.service` (user unit) | `serve` supervises one `pipewire -c` process, rebuilds it within ~3 s when the state file or the call state changes, makes `devos-spk-fx` the default output and puts the real output back when the filter is no longer needed. Started at login by `devos-desktop`; the Live USB falls back to a transient unit (`devos-speaker-session.service`) and `root-session` runs `dev-os-speaker apply`. |
| Image | `pipewire-modules-filter-chain`, `pipewire-spa-plugins-filter-graph` and `pipewire-spa-plugins-filter-graph-plugin-builtin` in `IMAGE_INSTALL` (Ubuntu: `libpipewire-0.3-modules`, `libspa-0.2-modules`). Without them the controls are disabled and the missing package is named. |

The Microphone card's reference sink and this effect sink are both `devos-*` nodes: they are hidden from the device dropdowns, and the
microphone helper restores the default output it found, so the two features do not take each other's default.

Validation: `python3 tests/speaker-effects.test.py` (fake `pw-dump`/`wpctl`/`systemctl`/`pipewire`: outputs, saved state, rejection, every
graph, headroom, smart switch, plugin check, transient-unit fallback, recipe wiring), `gjs -m dist/speaker-ui-test.js`.
**Not verified on real hardware:** that filter-chain loads and the built-in biquads sound as intended on the UX3407NA speakers, that
the virtual sink as default output keeps the speaker/UCM routing and volume controls intact (volume now applies to the virtual
sink), that the booster graph (`abs`/`recip`/`mult` port names read from the PipeWire 1.6.8 source, never run here) loads and does not distort objectionably, that a graph that fails to load is retried only every 30 s (the service logs it), glitches while the filter is rebuilt, CPU cost, and the call detection against real apps (browsers may hold idle capture
streams, which would keep Voice mode on).
