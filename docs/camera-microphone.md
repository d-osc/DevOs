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
