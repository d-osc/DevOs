import hashlib
import re
import gzip
import os
import shutil
import json
from pathlib import Path
import stat
import struct
import subprocess
import tempfile
import unittest
import sys
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parent))
from usb_support import usb, fake_tool   # the DevLang staging library (distro/usb/*.dev), driven through tests/fixtures/usb-driver.dev

# Stand-in for debugfs: `stat PATH` answers "Inode: 1" for the paths in $FAKE_PRESENT (or always when $FAKE_ALWAYS is set), `dump SRC "TARGET"` copies
# $FAKE_DUMP_FILE to TARGET, `cat /etc/os-release` prints $FAKE_ETC, `cat /usr/lib/os-release` $FAKE_USRLIB, and anything else (-w -f script) succeeds quietly. Calls are appended to $FAKE_LOG.
FAKE_DEBUGFS = r'''[ -n "$FAKE_LOG" ] && echo "$*" >> "$FAKE_LOG"
case "$2" in
    stat\ *)
        [ -n "$FAKE_ALWAYS" ] && echo "Inode: 12"
        for p in $FAKE_PRESENT; do [ "stat $p" = "$2" ] && echo "Inode: 1"; done ;;
    dump\ *) t=${2##* \"}; t=${t%\"}; cp "$FAKE_DUMP_FILE" "$t" ;;
    "cat /etc/os-release") printf '%s' "$FAKE_ETC" ;;
    "cat /usr/lib/os-release") printf '%s' "$FAKE_USRLIB" ;;
esac
exit 0
'''

class LiveUsbTests(unittest.TestCase):
    def test_camera_modules_are_read_back_from_image_and_hashed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);bundle=root/'bundle';bundle.mkdir();output=root/'stage';output.mkdir();tools=root/'tools';tools.mkdir()
            fake_tool(tools,'debugfs',FAKE_DEBUGFS)
            name='modules/lib/modules/test/kernel/qcom-camss.ko'
            data=b'patched camera module';expected=hashlib.sha256(data).hexdigest()
            (bundle/'camera-fixes.json').write_text(json.dumps({'patchedModules':{name:expected}}))
            image=root/'module.ko';image.write_bytes(data);log=root/'log'
            env={'FAKE_DUMP_FILE':str(image),'FAKE_LOG':str(log)}
            self.assertEqual(usb.stage_camera_modules(root/'rootfs.ext4',bundle,output,tools=tools,env=env),['camera-fixes.json','staged-camera-qcom-camss.ko'])
            self.assertIn('/usr/lib/modules/test/kernel/qcom-camss.ko',log.read_text())
            (output/'staged-camera-qcom-camss.ko').unlink()
            image.write_bytes(b'stock module')
            with self.assertRaisesRegex(ValueError,'read-back checksum mismatch'):
                usb.stage_camera_modules(root/'rootfs.ext4',bundle,output,tools=tools,env=env)

    def test_missing_stage_gives_recovery_instead_of_traceback(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, 'Run prepare successfully first'):
                usb.check(Path(tmp)/'missing-diagnostic')
    def test_root_password_overlay_with_actual_static_busybox(self):
        busybox=Path('/var/tmp/devos-usb/busybox-build/busybox')
        if not busybox.exists(): self.skipTest('Static Live BusyBox is not built')
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp)
            (directory/'shadow').write_text('root:*:15069:0:99999:7:::\ndaemon:*:15069:0:99999:7:::\n')
            script=(usb.HERE/'init').read_text()
            script=script[script.index('root_password_hash='):script.index('unset root_password_hash')]
            script=script.replace('/newroot/etc',str(directory)).replace('/live/root-password.hash',str(usb.HERE/'root-password.hash'))
            subprocess.run([str(busybox),'sh','-c','rescue() { exit 1; };\n'+script],check=True)
            lines=(directory/'shadow').read_text().splitlines()
            self.assertEqual(lines[0],'root:'+(usb.HERE/'root-password.hash').read_text().strip()+':15069:0:99999:7:::')
            self.assertEqual(lines[1],'daemon:*:15069:0:99999:7:::')
            self.assertEqual(stat.S_IMODE((directory/'shadow').stat().st_mode),0o600)

    def test_missing_shell_bracket_applet_blocks_initramfs_packaging(self):
        with tempfile.TemporaryDirectory() as tmp:
            busybox=fake_tool(tmp,'busybox','printf "%s\\n" '+' '.join(sorted(usb.REQUIRED_APPLETS-{'['}))+'\n')
            with self.assertRaisesRegex(ValueError,'Missing live boot tools'):
                usb.install_boot_tools(Path(tmp)/'tree',busybox)

    def test_refresh_boot_tools_preserves_original_hardlinked_candidate(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);tree=root/'tree';(tree/'bin').mkdir(parents=True)
            original=root/'original';original.write_bytes(b'old-busybox')
            (tree/'bin/busybox').hardlink_to(original)
            old_init=root/'old-init';old_init.write_bytes(b'old-init')
            (tree/'init').hardlink_to(old_init)
            replacement=fake_tool(root,'new-busybox','printf "%s\\n" '+' '.join(sorted(usb.REQUIRED_APPLETS))+'\n')
            usb.install_boot_tools(tree,replacement)
            self.assertEqual(original.read_bytes(),b'old-busybox')
            self.assertEqual(old_init.read_bytes(),b'old-init')
            self.assertEqual((tree/'bin/busybox').read_bytes(),replacement.read_bytes())
            self.assertTrue((tree/'diagnostics/collector.service').is_file())
            self.assertTrue((tree/'diagnostics/audio-report').is_file())
            self.assertTrue((tree/'diagnostics/camera-report').is_file())
            self.assertTrue((tree/'diagnostics/bluetooth-report').is_file())
            self.assertTrue((tree/'diagnostics/battery-report').is_file())
            self.assertTrue((tree/'diagnostics/hotspot-report').is_file())
            self.assertTrue((tree/'diagnostics/bluetooth-recover').is_file())
            self.assertTrue((tree/'diagnostics/bluetooth-recover.service').is_file())
            self.assertTrue((tree/'live/root-session').is_file())
            self.assertTrue((tree/'live/greetd-root.toml').is_file())
            self.assertEqual((tree/'sbin/modprobe').readlink(),Path('../bin/busybox'))
            self.assertTrue((tree/'live/root-password.hash').is_file())
            self.assertTrue((tree/'live/devos-hwprofile').stat().st_mode&stat.S_IXUSR)
            self.assertTrue((tree/'live/profiles/generic/profile.conf').is_file())
            self.assertTrue((tree/'live/profiles/asus/ux3407na/match').is_file())
            self.assertFalse((tree/'live/profiles/asus/ux3407na/kernel').exists())

    @unittest.skipUnless(shutil.which('sh') and sys.platform!='win32','POSIX shell required')
    def test_audio_report_names_the_failing_layer_without_audio_hardware(self):
        script=Path(__file__).resolve().parents[1]/'distro/usb/audio-report'
        subprocess.run(['sh','-n',str(script)],check=True)
        # procfs files report size 0: a `-s` test gave a false 'no sound card' verdict on the real A14.
        self.assertNotIn('-s /proc/',script.read_text())
        with tempfile.TemporaryDirectory() as tmp:
            hw=Path(tmp)/'hw';hw.mkdir()
            (hw/'profile.conf').write_text('selected_profile=asus/ux3407na'+chr(10))
            firmware=['# audio','qcom/glymur/GLYMUR-ASUS-Zenbook-A14-UX3407NA-tplg.bin','qcom/glymur/ASUSTeK/UX3407NA/qcadsp8480.mbn','ath12k/QCC2072/hw1.0/board.bin','']
            (hw/'firmware.list').write_text(chr(10).join(firmware))
            out=Path(tmp)/'report.txt'
            subprocess.run(['sh',str(script),str(out)],check=True,env={**os.environ,'DEVOS_HW_RUN':str(hw)})
            text=out.read_text()
        self.assertIn('profile: asus/ux3407na',text)
        self.assertRegex(text,r'AUDIO-CHECK dsp-and-topology-firmware: FAIL missing: qcom/glymur/GLYMUR-ASUS-Zenbook-A14-UX3407NA-tplg\.bin qcom/glymur/ASUSTeK/UX3407NA/qcadsp8480\.mbn')
        self.assertNotIn('board.bin',text.split('=== Verdict ===')[1].split('AUDIO-CHECK adsp-boot')[0])
        self.assertIn('AUDIO-CHECK pipewire-sink: FAIL',text)
        self.assertIn('AUDIO-CHECK speaker-amplifiers-bound: FAIL',text)

    @unittest.skipUnless(shutil.which('sh') and sys.platform!='win32','POSIX shell required')
    def test_camera_report_names_the_failing_layer_without_camera_hardware(self):
        script=Path(__file__).resolve().parents[1]/'distro/usb/camera-report'
        subprocess.run(['sh','-n',str(script)],check=True)
        init=(usb.HERE/'init').read_text()
        self.assertIn('/usr/libexec/devos-camera-report',init)
        self.assertIn('devos-camera-report',(usb.HERE/'collector').read_text())
        def run(root):
            with tempfile.TemporaryDirectory() as tmp:
                out=Path(tmp)/'report.txt'
                subprocess.run(['sh',str(script),str(out)],check=True,env={**os.environ,'DEVOS_SYS_ROOT':str(root),'DEVOS_HW_RUN':str(root/'hw')})
                return out.read_text()
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            # Only the reserved-memory region the real laptop log showed: not a camera graph.
            (root/'sys/firmware/devicetree/base/reserved-memory/camera@91a00000').mkdir(parents=True)
            (root/'sys/firmware/devicetree/base/compatible').write_bytes(b'asus,zenbook-a14-ux3407na\0qcom,glymur\0')
            text=run(root)
            for layer in ('usb-uvc-device','dt-camss-node','dt-cci-node','dt-sensor-node','module-qcom_camss','dev-video','dev-media'):
                self.assertIn('CAMERA-CHECK %s: FAIL'%layer,text)
            self.assertIn('camera@91a00000',text)
            self.assertIn('CAMERA-CHECK kernel-camss-glymur-match: FAIL',text)
            self.assertIn('CAMERA-CHECK kernel-pm8010-match: FAIL',text)
            self.assertIn('CAMERA-CHECK dt-camcc-node: FAIL',text)
            # A complete graph and nodes make the device-tree and node layers pass.
            base=root/'sys/firmware/devicetree/base/soc@0'
            for node,compat in (('camss@acb7000','qcom,glymur-camss'),('cci@ac15000','qcom,glymur-cci'),('i2c-bus/camera@36','ovti,ov02c10')):
                (base/node).mkdir(parents=True);(base/node/'compatible').write_bytes(compat.encode()+b'\0')
            (root/'dev').mkdir();(root/'dev/video0').write_text('');(root/'dev/media0').write_text('')
            usbif=root/'sys/bus/usb/devices/1-1:1.0';usbif.mkdir(parents=True);(usbif/'bInterfaceClass').write_text('0e'+chr(10))
            text=run(root)
            for layer in ('usb-uvc-device','dt-camss-node','dt-cci-node','dt-sensor-node','dev-video','dev-media'):
                self.assertRegex(text,r'CAMERA-CHECK %s: ok'%layer)
            self.assertIn('CAMERA-CHECK module-qcom_camss: FAIL',text)

    # Lines copied from the physical UX3407NA boot 3367a468 (build/live-usb/microphone-native-20261023).
    CAPTURED_BT_DMESG=(
        '<6>[    2.059059] Bluetooth: HCI UART protocol QCA registered\n'
        '<6>[    3.104800] Bluetooth: hci0: setting up wcn7850\n'
        '<6>[    3.172278] Bluetooth: hci0: QCA Downloading qca/ornbtfw11.tlv\n'
        '<4>[    3.172296] bluetooth hci0: Direct firmware load for qca/ornbtfw11.tlv failed with error -2\n'
        '<3>[    3.172298] Bluetooth: hci0: QCA Failed to request file: qca/ornbtfw11.tlv (-2)\n'
        '<3>[    3.172457] Bluetooth: hci0: unexpected event for opcode 0xfc48\n')

    @unittest.skipUnless(shutil.which('sh') and sys.platform!='win32','POSIX shell required')
    def test_battery_report_names_the_failing_layer(self):
        script=Path(__file__).resolve().parents[1]/'distro/usb/battery-report'
        subprocess.run(['sh','-n',str(script)],check=True)
        init=(usb.HERE/'init').read_text()
        self.assertIn('/usr/libexec/devos-battery-report',init)
        self.assertIn('devos-battery-report',(usb.HERE/'collector').read_text())
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'root';dmesg=Path(tmp)/'dmesg';dmesg.write_text('<6>[    4.1] remoteproc remoteproc1: remote processor adsp is now up\n')
            (root/'proc').mkdir(parents=True)
            # Captured UX3407NA state: pmic_glink and qcom_battmgr loaded, SOCCP attached, but no power supply registered.
            (root/'proc/modules').write_text('pmic_glink 16384 3 pmic_glink_altmode,qcom_battmgr,ucsi_glink - Live 0x0\nqcom_battmgr 24576 0 - Live 0x0\n')
            dt=root/'sys/firmware/devicetree/base/pmic-glink';dt.mkdir(parents=True);(dt/'compatible').write_bytes(b'qcom,glymur-pmic-glink\x00qcom,pmic-glink\x00')
            rp=root/'sys/class/remoteproc/remoteproc0';rp.mkdir(parents=True);(rp/'name').write_text('soccp\n');(rp/'state').write_text('attached\n')
            (root/'sys/class/power_supply').mkdir(parents=True)
            env={**os.environ,'DEVOS_SYS_ROOT':str(root),'DEVOS_HW_RUN':str(root/'hw'),'DEVOS_DMESG_FILE':str(dmesg)}
            def report():
                out=Path(tmp)/'report.txt'
                subprocess.run(['sh',str(script),str(out)],check=True,env=env)
                return out.read_text()
            text=report()
            for line in ('module-qcom_battmgr: ok','dt-pmic-glink: ok','remoteproc: ok','rpmsg-channel: FAIL','aux-power-supply: FAIL','power-supply-class: FAIL','battery-supply: FAIL','panel-would-show: nothing'):
                self.assertIn('BATTERY-CHECK '+line,text)
            # The battery manager registers a battery whose firmware reports status and energy counters but no capacity.
            ps=root/'sys/class/power_supply'
            bat=ps/'qcom-battmgr-bat';bat.mkdir()
            for k,v in (('type','Battery'),('present','1'),('status','Charging'),('energy_now','25000000'),('energy_full','50000000')): (bat/k).write_text(v+'\n')
            ac=ps/'qcom-battmgr-ac';ac.mkdir();(ac/'type').write_text('Mains\n');(ac/'online').write_text('1\n')
            text=report()
            self.assertIn('BATTERY-CHECK battery-supply: ok',text)
            self.assertRegex(text,r'battery-capacity: ok \(capacity is \(absent\); computed 50% from energy_now/energy_full\)')
            self.assertIn('BATTERY-CHECK ac-online: yes (qcom-battmgr-ac)',text)
            self.assertIn('BATTERY-CHECK panel-would-show: 50% Charging',text)
            (bat/'energy_now').unlink();(bat/'energy_full').unlink()
            self.assertIn('battery-capacity: FAIL',report())
            self.assertIn('BATTERY-CHECK panel-would-show: Charging without percentage',report())
            (bat/'capacity').write_text('64\n')
            self.assertIn('BATTERY-CHECK panel-would-show: 64% Charging',report())

    @unittest.skipUnless(shutil.which('sh') and sys.platform!='win32','POSIX shell required')
    def test_bluetooth_report_and_recover_name_the_failing_layer(self):
        reports=Path(__file__).resolve().parents[1]/'distro/usb'
        for name in ('bluetooth-report','bluetooth-recover'):
            subprocess.run(['sh','-n',str(reports/name)],check=True)
        init=(usb.HERE/'init').read_text()
        self.assertIn('/usr/libexec/devos-bluetooth-report',init)
        self.assertIn('/usr/libexec/devos-bluetooth-recover',init)
        self.assertIn('devos-bluetooth-report',(usb.HERE/'collector').read_text())
        self.assertIn('ExecStart=/usr/libexec/devos-bluetooth-recover',(usb.HERE/'bluetooth-recover.service').read_text())
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'root';dmesg=Path(tmp)/'dmesg';dmesg.write_text(self.CAPTURED_BT_DMESG)
            (root/'sys/class/bluetooth/hci0').mkdir(parents=True)
            dt=root/'sys/firmware/devicetree/base/soc@0/geniqup/serial@a94000/bluetooth'
            dt.mkdir(parents=True);(dt/'compatible').write_bytes(b'qcom,wcn7850-bt\0')
            (root/'sys/bus/serial/devices/serial0-0').mkdir(parents=True)
            env={**os.environ,'DEVOS_SYS_ROOT':str(root),'DEVOS_HW_RUN':str(root/'hw'),'DEVOS_DMESG_FILE':str(dmesg),'DEVOS_BT_SCAN':'0'}
            def report():
                out=Path(tmp)/'report.txt'
                subprocess.run(['sh',str(reports/'bluetooth-report'),str(out)],check=True,env=env)
                return out.read_text()
            text=report()
            self.assertIn('BLUETOOTH-CHECK dt-bluetooth-node: ok',text)
            self.assertIn('BLUETOOTH-CHECK controller-present: ok',text)
            self.assertIn('BLUETOOTH-CHECK serdev-bound: FAIL',text)
            self.assertRegex(text,r'BLUETOOTH-CHECK controller-firmware: FAIL \(missing: qca/ornbtfw11\.tlv; ')
            self.assertIn('BLUETOOTH-CHECK firmware-file-ornbtfw11.tlv: FAIL',text)
            self.assertIn('BLUETOOTH-CHECK scan: SKIPPED',text)
            self.assertIn('QCA Failed to request file',text)
            # Firmware now present in the rootfs but absent at first probe: report says so, recovery rebinds once.
            (root/'lib/firmware/qca').mkdir(parents=True);(root/'lib/firmware/qca/ornbtfw11.tlv').write_bytes(b'tlv')
            self.assertRegex(report(),r'controller-firmware: FAIL \(setup asked for qca/ornbtfw11\.tlv before the file was available')
            drv=root/'sys/bus/serial/drivers/hci_uart_qca';drv.mkdir(parents=True)
            (drv/'serial0-0').symlink_to(root/'sys/bus/serial/devices/serial0-0')
            (drv/'unbind').write_text('');(drv/'bind').write_text('')
            mark=Path(tmp)/'mark'
            result=subprocess.run(['sh',str(reports/'bluetooth-recover')],check=True,capture_output=True,text=True,env={**env,'DEVOS_BT_RECOVER_MARK':str(mark)})
            self.assertIn('re-probed serial0-0',result.stdout)
            self.assertEqual((drv/'unbind').read_text().strip(),'serial0-0')
            self.assertEqual((drv/'bind').read_text().strip(),'serial0-0')
            again=subprocess.run(['sh',str(reports/'bluetooth-recover')],check=True,capture_output=True,text=True,env={**env,'DEVOS_BT_RECOVER_MARK':str(mark)})
            self.assertIn('already attempted',again.stdout)
            # A first setup that succeeded is left alone.
            dmesg.write_text('<6>[    3.1] Bluetooth: hci0: QCA Downloading qca/ornbtfw11.tlv\n')
            ok=subprocess.run(['sh',str(reports/'bluetooth-recover')],check=True,capture_output=True,text=True,env={**env,'DEVOS_BT_RECOVER_MARK':str(Path(tmp)/'mark2')})
            self.assertIn('nothing to do',ok.stdout)
            self.assertIn('controller-firmware: ok',report())

    # Lines from the 2026-10-24 boot c69b55bf: setup runs at registration and again when bluetoothd powers the adapter.
    HEALTHY_BT_DMESG=(
        '<6>[    3.445314] Bluetooth: hci0: setting up wcn7850\n'
        '<6>[    3.511387] Bluetooth: hci0: QCA Downloading qca/ornbtfw11.tlv\n'
        '<6>[    3.518000] Bluetooth: hci0: QCA FW build version: BTFW.ORNE.1.1.0-00355-PATCH-1_DEF\n'
        '<6>[    3.530000] Bluetooth: hci0: QCA setup on UART is completed\n'
        '<6>[   15.600000] Bluetooth: hci0: setting up wcn7850\n'
        '<6>[   15.700000] Bluetooth: hci0: QCA setup on UART is completed\n')

    @unittest.skipUnless(shutil.which('sh') and sys.platform!='win32','POSIX shell required')
    def test_bluetooth_recover_never_rebinds_a_healthy_controller_and_scan_is_recorded(self):
        scripts=Path(__file__).resolve().parents[1]/'distro/usb'
        with tempfile.TemporaryDirectory() as tmp:
            tmp=Path(tmp);root=tmp/'root';dmesg=tmp/'dmesg'
            drv=root/'sys/bus/serial/drivers/hci_uart_qca';drv.mkdir(parents=True)
            dev=root/'sys/bus/serial/devices/serial0-0';dev.mkdir(parents=True)
            (dev/'driver').symlink_to(drv);(drv/'serial0-0').symlink_to(dev)
            (drv/'unbind').write_text('');(drv/'bind').write_text('')
            (root/'lib/firmware/qca').mkdir(parents=True);(root/'lib/firmware/qca/ornbtfw11.tlv').write_bytes(b'x')
            env={**os.environ,'DEVOS_SYS_ROOT':str(root),'DEVOS_HW_RUN':str(root/'hw'),'DEVOS_DMESG_FILE':str(dmesg),'DEVOS_BT_RECOVER_MARK':str(tmp/'mark')}
            # A failure that a later completed setup superseded is not a reason to rebind.
            dmesg.write_text('<3>[ 1.0] Bluetooth: hci0: QCA Failed to request file: qca/ornbtfw11.tlv (-2)\n'+self.HEALTHY_BT_DMESG)
            out=subprocess.run(['sh',str(scripts/'bluetooth-recover')],check=True,capture_output=True,text=True,env=env).stdout
            self.assertIn('nothing to do',out);self.assertEqual((drv/'unbind').read_text(),'');self.assertFalse((tmp/'mark').exists())
            # Fake BlueZ client: the scan verdict counts distinct devices and keeps the evidence.
            fake=tmp/'bin';fake.mkdir()
            (fake/'bluetoothctl').write_text('#!/bin/sh\ncase "$*" in\n *"scan on"*) echo "[NEW] Device AA:BB:CC:DD:EE:01 Phone"; echo "[CHG] Device AA:BB:CC:DD:EE:01 RSSI: -60" ;;\n devices) echo "Device AA:BB:CC:DD:EE:01 Phone"; echo "Device AA:BB:CC:DD:EE:02 Buds" ;;\n show) echo "Controller 3C:EF:A5:29:59:5A (public)"; echo "Powered: yes" ;;\nesac\n')
            (fake/'bluetoothctl').chmod(0o755)
            report=tmp/'report.txt'
            run=lambda scan:subprocess.run(['sh',str(scripts/'bluetooth-report'),str(report)],check=True,env={**env,'DEVOS_EXTRA_PATH':str(fake),'DEVOS_BT_SCAN':scan,'DEVOS_BT_SCAN_SECONDS':'1'})
            run('1');text=report.read_text()
            self.assertIn('BLUETOOTH-CHECK scan: ok (2 distinct device(s) in 1s, 1 RSSI update(s))',text)
            self.assertIn('BLUETOOTH-CHECK controller-firmware: ok (setup completed 2 time(s)',text)
            self.assertIn('--- bluetoothctl scan output ---',text.split('=== Scan evidence ===')[1])
            run('0');self.assertIn('BLUETOOTH-CHECK scan: SKIPPED',report.read_text())
            # The user's own scan (Settings page) holds discovery: the collector must not scan on top of it.
            (fake/'bluetoothctl').write_text('#!/bin/sh\ncase "$*" in\n show) echo "Controller 3C:EF:A5:29:59:5A (public)"; echo "Powered: yes"; echo "Discovering: yes" ;;\n *) echo UNEXPECTED "$*" ;;\nesac\n')
            run('1');busy=report.read_text()
            self.assertIn('BLUETOOTH-CHECK scan: SKIPPED (another client is already scanning',busy)
            self.assertNotIn('UNEXPECTED scan',busy)
        collector=(usb.HERE/'collector').read_text()
        self.assertIn('bluetooth-scan-$iteration.txt',collector)

    # Lines from the 2026-10-24 boot c69b55bf on the UX3407NA: the firmware never answers the regulatory update.
    CAPTURED_WIFI_DMESG=(
        '<6>[    8.628147] ath12k_wifi7_pci 0004:01:00.0: fw_version 0x100581de fw_build_timestamp 2024-09-11 23:52 fw_build_id QC_IMAGE_VERSION_STRING=WLAN.COL.1.0.c2-00277-QCACOLSWPL_V1_TO_SILICONZ-1\n'
        '<3>[   19.000000] ath12k_wifi7_pci 0004:01:00.0: Timeout while waiting for regulatory update\n'
        '<3>[   22.000000] ath12k_wifi7_pci 0004:01:00.0: Timeout while waiting for regulatory update\n'
        '<3>[   25.000000] ath12k_wifi7_pci 0004:01:00.0: Timeout while waiting for regulatory update\n'
        '<3>[  325.000000] ath12k_wifi7_pci 0004:01:00.0: Timeout while waiting for regulatory update\n')

    @unittest.skipUnless(shutil.which('sh') and sys.platform!='win32','POSIX shell required')
    def test_hotspot_report_names_the_failing_layer_and_try_always_cleans_up(self):
        scripts=Path(__file__).resolve().parents[1]/'distro/usb'
        subprocess.run(['sh','-n',str(scripts/'hotspot-report')],check=True)
        init=(usb.HERE/'init').read_text()
        self.assertIn('/usr/libexec/devos-hotspot-report',init)
        self.assertIn('/usr/bin/devos-hotspot-report',init)
        collector=(usb.HERE/'collector').read_text()
        self.assertIn('devos-hotspot-report',collector);self.assertIn('DEVOS-LOGS/HOTSPOT-TRY',collector)
        self.assertIn('"hotspot-report"',(usb.HERE/'usbimage.dev').read_text())
        with tempfile.TemporaryDirectory() as tmp:
            tmp=Path(tmp);root=tmp/'root';dmesg=tmp/'dmesg';dmesg.write_text(self.CAPTURED_WIFI_DMESG)
            drv=root/'sys/bus/pci/drivers/ath12k_wifi7_pci';drv.mkdir(parents=True)
            net=root/'sys/class/net/wlan0';(net/'wireless').mkdir(parents=True);(net/'device').mkdir()
            (net/'device/driver').symlink_to(drv)
            (root/'sys/module/cfg80211').mkdir(parents=True);(root/'sys/module/mac80211').mkdir()
            (root/'proc').mkdir();(root/'proc/modules').write_text('ath12k 925696 1 ath12k_wifi7, Live 0x0\nnf_tables 1 0 - Live 0x0\n')
            (root/'proc/sys/net/ipv4').mkdir(parents=True);(root/'proc/sys/net/ipv4/ip_forward').write_text('0\n')
            fake=tmp/'bin';fake.mkdir();calls=tmp/'calls'
            def tool(name,body):
                (fake/name).write_text('#!/bin/sh\n'+body);(fake/name).chmod(0o755)
            phy=tmp/'phy'
            phy.write_text('Wiphy phy0\n\tSupported interface modes:\n\t\t * managed\n\t\t * monitor\n\tvalid interface combinations:\n\t\t * #{ managed } <= 2, total <= 2, #channels <= 1\n')
            tool('iw','case "$*" in\n phy) cat '+str(phy)+' ;;\n "reg get") echo global; echo "country 00: DFS-UNSET" ;;\n "dev wlan0 info") echo "type $(cat '+str(tmp/'iftype')+' 2>/dev/null || echo managed)" ;;\nesac\n')
            tool('rfkill','echo "1: phy0: Wireless LAN"; echo "\tSoft blocked: no"; echo "\tHard blocked: no"\n')
            tool('systemctl','echo active\n')
            tool('wpa_supplicant','# AP-ENABLED hostapd\n')
            tool('dnsmasq','exit 0\n');tool('nft','exit 0\n')
            tool('nmcli','echo "$*" >>'+str(calls)+'\ncase "$*" in\n *"-f DEVICE,TYPE,STATE device") echo wlan0:wifi:disconnected; echo p2p-dev-wlan0:wifi-p2p:disconnected ;;\n *WIFI-PROPERTIES.AP*) cat '+str(tmp/'ap')+' ;;\n *"connection up"*) if [ -e '+str(tmp/'upfail')+' ]; then echo "Error: Connection activation failed: Could not start the shared connection (dnsmasq)" >&2; exit 4; fi; echo "Connection successfully activated"; echo AP >'+str(tmp/'iftype')+' ;;\n *GENERAL.STATE*) echo "100 (connected)" ;;\nesac\n')
            (tmp/'ap').write_text('no\n')
            env={**os.environ,'DEVOS_SYS_ROOT':str(root),'DEVOS_DMESG_FILE':str(dmesg),'DEVOS_EXTRA_PATH':str(fake)}
            def report(*args,**extra):
                out=tmp/'report.txt'
                subprocess.run(['sh',str(scripts/'hotspot-report'),*args,str(out)],check=True,env={**env,**extra})
                return out.read_text()
            text=report()
            self.assertIn('HOTSPOT-CHECK wifi-interface: ok (wlan0 driver ath12k_wifi7_pci)',text)
            self.assertIn('HOTSPOT-CHECK driver-firmware: ok (ath12k loaded; fw_version 0x100581de fw_build_timestamp 2024-09-11 23:52)',text)
            self.assertIn('HOTSPOT-CHECK ap-mode: FAIL (wiphy supports only: managed monitor ',text)
            self.assertIn('HOTSPOT-CHECK ap-combination: FAIL',text)
            self.assertIn('HOTSPOT-CHECK regulatory-country: ok (country 00, the world domain',text)
            self.assertIn('regulatory-update: FAIL (the Wi-Fi firmware never answered the regulatory update 4 time(s)',text)
            self.assertIn('HOTSPOT-CHECK nm-ap-capability: FAIL',text)
            self.assertIn('HOTSPOT-CHECK wpa-supplicant-ap: ok',text)
            self.assertIn('HOTSPOT-CHECK ip-forward: ok (net.ipv4.ip_forward=0',text)
            self.assertIn('HOTSPOT-CHECK kernel-nft_masq: FAIL',text)
            self.assertIn('HOTSPOT-CHECK kernel-nf_tables: ok',text)
            self.assertIn('HOTSPOT-CHECK try-hotspot: SKIPPED',text)
            self.assertNotIn('connection add',calls.read_text() if calls.exists() else '')
            # An AP-capable wiphy passes the mode checks; module files in modules.dep count as installable.
            phy.write_text('Wiphy phy0\n\tSupported interface modes:\n\t\t * managed\n\t\t * AP\n\t\t * monitor\n\tvalid interface combinations:\n\t\t * #{ managed } <= 2, #{ AP, P2P-client } <= 1, total <= 2, #channels <= 1\n')
            (tmp/'ap').write_text('yes\n')
            base=root/'lib/modules'/os.uname().release;base.mkdir(parents=True);(base/'modules.dep').write_text('kernel/net/netfilter/nft_masq.ko.zst:\n')
            text=report()
            self.assertIn('HOTSPOT-CHECK ap-mode: ok (supported interface modes: managed AP monitor ',text)
            self.assertIn('HOTSPOT-CHECK ap-combination: ok',text);self.assertIn('HOTSPOT-CHECK nm-ap-capability: ok',text)
            self.assertIn('HOTSPOT-CHECK kernel-nft_masq: ok',text)
            # --try builds the same profile the shell does, reports success, and removes it again.
            text=report('--try',DEVOS_HOTSPOT_TRY_SECONDS='1')
            self.assertIn('HOTSPOT-CHECK try-hotspot: ok',text);self.assertIn('HOTSPOT-CHECK try-interface-type-ap: ok',text)
            log=calls.read_text()
            self.assertRegex(log,r'connection add type wifi ifname wlan0 con-name devos-hotspot-report-test autoconnect no ssid DevOsHotspotTest mode ap 802-11-wireless.band bg ipv4.method shared ipv6.method disabled wifi-sec.key-mgmt wpa-psk wifi-sec.psk \S{12}\n')
            self.assertEqual(log.count('connection delete devos-hotspot-report-test'),2)
            self.assertNotRegex(text,r'psk \S{12}')
            # A failed activation keeps NetworkManager's own error text and still removes the profile.
            (tmp/'upfail').write_text('');calls.write_text('')
            text=report('--try',DEVOS_HOTSPOT_TRY_SECONDS='1')
            self.assertRegex(text,r'HOTSPOT-CHECK try-hotspot: FAIL \(Error: Connection activation failed: Could not start the shared connection \(dnsmasq\)')
            self.assertIn('connection delete devos-hotspot-report-test',calls.read_text().split('connection down')[-1])

    def test_bluetooth_firmware_is_staged_into_the_initramfs(self):
        # hci0 is set up while the initramfs is still running, so the profile's qca/ firmware must be in it.
        self.assertEqual(usb.profile_early_firmware(),['qca/ornbtfw11.tlv','qca/ornnv11.bin'])
        with tempfile.TemporaryDirectory() as tmp:
            tree=Path(tmp)/'tree';tools=Path(tmp)/'tools';tools.mkdir()
            fake_tool(tools,'debugfs',FAKE_DEBUGFS)
            blob=Path(tmp)/'blob';blob.write_bytes(b'fw')
            present='/usr/lib/firmware/qca/ornbtfw11.tlv /usr/lib/firmware/qca/ornnv11.bin'
            staged=usb.stage_bluetooth_firmware(Path('rootfs.ext4'),tree,tools=tools,env={'FAKE_PRESENT':present,'FAKE_DUMP_FILE':str(blob)})
            self.assertEqual(staged,['qca/ornbtfw11.tlv','qca/ornnv11.bin'])
            self.assertEqual((tree/'lib/firmware/qca/ornbtfw11.tlv').read_bytes(),b'fw')
            with self.assertRaisesRegex(ValueError,'Bluetooth firmware qca/ornbtfw11.tlv is not in the rootfs'):
                usb.stage_bluetooth_firmware(Path('rootfs.ext4'),tree,tools=tools,env={'FAKE_PRESENT':'','FAKE_DUMP_FILE':str(blob)})

    def test_camera_candidate_is_opt_in_and_labels_every_value_with_its_source(self):
        root=Path(__file__).resolve().parents[1]
        text=(root/'profiles/asus/ux3407na/kernel/ux3407na-camera-candidate.dtsi').read_text()
        self.assertIn('UNVERIFIED',text)
        self.assertIn('qcom,pm8010-i2c',text)
        for tag in ('[ACPI]','[COMM]','[A16]','[SOC]'): self.assertIn(tag,text)
        for line in text.splitlines():
            if re.search(r'(reset-gpios|data-lanes|avdd-supply|dovdd-supply|dvdd-supply|vdda-[a-z0-9]+-supply)\s*=',line):
                self.assertRegex(line,r'\[(COMM|A16|ACPI|SOC)\]',line)
        # Not part of any default build: only the explicit flag appends it.
        flow=(root/'distro/usb/boardtools.dev').read_text()
        self.assertIn('--enable-camera-candidate',flow)
        self.assertEqual(flow.count('st.appendCameraCandidate(board)'),1)
        self.assertIn('if camera { st.appendCameraCandidate(board) }',flow)
        for name in ('usbimage.dev','usbstage.dev','hostio.dev'):
            body=(root/'distro/usb'/name).read_text()
            self.assertNotIn('appendCameraCandidate(',body.replace('fn appendCameraCandidate(',''))
        with tempfile.TemporaryDirectory() as tmp:
            tree=Path(tmp);(tree/'arch/arm64/boot/dts/qcom').mkdir(parents=True);(tree/'drivers/mfd').mkdir(parents=True)
            (tree/'arch/arm64/boot/dts/qcom/glymur.dtsi').write_text('/* stock */')
            (tree/'drivers/mfd/qcom-pm8008.c').write_text('/* stock */')
            with self.assertRaisesRegex(ValueError,'prepare-source'): usb.check_camera_source(tree)
            (tree/'arch/arm64/boot/dts/qcom/glymur.dtsi').write_text('compatible = "qcom,glymur-camss";')
            (tree/'drivers/mfd/qcom-pm8008.c').write_text('"qcom,pm8010-i2c"')
            usb.check_camera_source(tree)

    def test_camx_sensor_module_decoder_reports_identity_but_no_invented_pins(self):
        root=Path(__file__).resolve().parents[1]
        d=os.environ.get('DEVLANG_BIN') or shutil.which('d') or str(Path.home()/'.local/bin/d')
        tool=str(root/'tools/live/decode-camx-sensormodule.dev')
        blob=b'QTI Chromatix Header'+bytes(12)+b'sensorDriverData\0'+bytes(8)+b'luxvision_ov02c10\0'+struct.pack('<I',19200000)
        with tempfile.TemporaryDirectory() as tmp:
            good=Path(tmp)/'module.bin'; good.write_bytes(blob)
            done=subprocess.run([d,tool,'--',str(good)],capture_output=True,text=True,timeout=60)
            self.assertEqual(done.returncode,0,done.stdout+done.stderr)
            self.assertIn('size: %d bytes'%len(blob),done.stdout)
            self.assertIn('  0x%x: sensorDriverData'%blob.index(b'sensorDriverData'),done.stdout)
            self.assertIn('  0x%x: luxvision_ov02c10'%blob.index(b'luxvision_ov02c10'),done.stdout)
            self.assertIn('offsets: 0x%x'%(len(blob)-4),done.stdout)
            self.assertIn('NOT in this file: physical GPIO numbers',done.stdout)
            self.assertNotIn('gpio ',done.stdout.lower().replace('gpio numbers',''))
            bad=Path(tmp)/'bad.bin'; bad.write_bytes(b'not a module')
            refused=subprocess.run([d,tool,'--',str(bad)],capture_output=True,text=True,timeout=60)
            self.assertNotEqual(refused.returncode,0)
            self.assertIn('Not a CamX sensor module file',refused.stdout+refused.stderr)

    def test_hardware_profile_selects_boot_modules_and_kernel_arguments(self):
        # The X2 command line and USB bring-up order moved into asus/ux3407na unchanged.
        self.assertEqual(usb.profile_kernel_args(),'clk_ignore_unused pd_ignore_unused arm64.nopauth mem_sleep_default=s2idle')
        with tempfile.TemporaryDirectory() as tmp:
            merged=Path(tmp)/'merged'
            subprocess.run(['sh',str(usb.PROFILES/'devos-hwprofile'),'compose',usb.BOARD_PROFILE,str(merged)],check=True,capture_output=True)
            order=(merged/'early.modules').read_text().split()
            self.assertEqual(order,['qcom_rpmh_regulator','qcom_refgen_regulator','phy_qcom_m31_eusb2','phy_qcom_qmp_usb','dwc3_qcom','xhci_plat_hcd','usb_storage','uas'])
        init=(usb.HERE/'init').read_text()
        self.assertIn('/live/devos-hwprofile boot /run/devos-hw',init)
        self.assertIn('$early_modules',init)
        subprocess.run(['sh','-n',str(usb.HERE/'init')],check=True)
        with self.assertRaises(ValueError): usb.profile_kernel_args('asus/not-a-model')

    def test_efi_sections_require_arm64(self):
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/'boot.efi';data=bytearray(256)
            data[:2]=b'MZ';struct.pack_into('<I',data,60,64)
            data[64:68]=b'PE\0\0';struct.pack_into('<HH',data,68,0xaa64,1)
            data[88:96]=b'.linux\0\0';struct.pack_into('<I',data,96,16);struct.pack_into('<I',data,108,200)
            file.write_bytes(data)
            self.assertEqual(usb.pe_sections(file)['.linux'],(200,16))
            struct.pack_into('<H',data,68,0x8664);file.write_bytes(data)
            with self.assertRaisesRegex(ValueError,'not ARM64'): usb.pe_sections(file)

    def test_firmware_rejects_unlisted_windows_executable(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp);(output/'driver.dll').write_bytes(b'MZ')
            (output/'manifest.json').write_text(json.dumps({'board':'asus-ux3407na','files':{}}))
            with self.assertRaisesRegex(ValueError,'Unlisted'): usb.firmware_bundle(output)

    def calibration_bundle(self, output, contents=b'\x7fELF'+bytes(60)):
        board=output/usb.WIFI_BOARD
        board.parent.mkdir(parents=True)
        board.write_bytes(contents)
        record={'board':'asus-ux3407na','files':{usb.WIFI_BOARD:usb.digest(board)},
                'wireless':{'pci':'17cb:1112','subsystem':'105b:e14f',
                            'boardData':usb.WIFI_BOARD,'sourceInfSHA256':'a'*64}}
        (output/'manifest.json').write_text(json.dumps(record))
        return record

    def test_verified_exact_wifi_calibration_is_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp);record=self.calibration_bundle(output)
            self.assertEqual(usb.firmware_bundle(output),record)

    def test_legacy_dsp_only_bundle_cannot_silently_omit_wifi(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)
            (output/'manifest.json').write_text(json.dumps({'board':'asus-ux3407na','files':{}}))
            with self.assertRaisesRegex(ValueError,'Missing UX3407NA Wi-Fi calibration'):
                usb.firmware_bundle(output)

    def test_wrong_subsystem_or_missing_provenance_is_rejected(self):
        for field,value in (('pci','17cb:1107'),('subsystem','105b:0000'),
                            ('boardData','ath12k/another/board.bin'),('sourceInfSHA256','')):
            with self.subTest(field=field),tempfile.TemporaryDirectory() as tmp:
                output=Path(tmp);record=self.calibration_bundle(output)
                record['wireless'][field]=value
                (output/'manifest.json').write_text(json.dumps(record))
                with self.assertRaisesRegex(ValueError,'PCI/subsystem and OEM INF provenance'):
                    usb.firmware_bundle(output)

    def test_tampered_calibration_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp);self.calibration_bundle(output)
            (output/usb.WIFI_BOARD).write_bytes(b'\x7fELF'+bytes(61))
            with self.assertRaisesRegex(ValueError,'Invalid board firmware'):
                usb.firmware_bundle(output)

    def test_generic_database_cannot_replace_oem_calibration(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp);self.calibration_bundle(output,b'ATH12K-BOARD'+bytes(64))
            with self.assertRaisesRegex(ValueError,'Invalid board firmware'):
                usb.firmware_bundle(output)

    def test_staged_calibration_readback_must_match_source_bytes(self):
        # Exercise read-back validation with a fake debugfs only; no OS build, filesystem creation, mounted device, or physical USB writes.
        for matching in (True,False):
            with self.subTest(matching=matching),tempfile.TemporaryDirectory() as tmp:
                output=Path(tmp)/'out';output.mkdir();source=Path(tmp)/'firmware';tools=Path(tmp)/'tools';tools.mkdir()
                fake_tool(tools,'debugfs',FAKE_DEBUGFS)
                self.calibration_bundle(source)
                rootfs=Path(tmp)/'private-rootfs';rootfs.write_bytes(b'placeholder')
                served=Path(tmp)/'served';served.write_bytes((source/usb.WIFI_BOARD).read_bytes() if matching else b'old-board-data')
                env={'FAKE_ALWAYS':'1','FAKE_DUMP_FILE':str(served)}
                if matching:
                    usb.install_modules(rootfs,source,output,target='/usr/lib/firmware',tools=tools,env=env)
                else:
                    with self.assertRaisesRegex(ValueError,'not staged correctly'):
                        usb.install_modules(rootfs,source,output,target='/usr/lib/firmware',tools=tools,env=env)

    def test_old_bootable_staging_cannot_reexport_missing_wifi(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)
            (output/'manifest.json').write_text(json.dumps({'board':'asus-ux3407na','imageReady':True,'files':{}}))
            with self.assertRaisesRegex(ValueError,'Old UX3407NA staging lacks'):
                usb.check(output)

    def test_kernel_bundle_rejects_other_board(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)
            (output/'manifest.json').write_text(json.dumps({'board':'another-arm-board','architecture':'aarch64'}))
            with self.assertRaisesRegex(ValueError,'UX3407NA'): usb.kernel_bundle(output)

    def test_cpio_preserves_files_symlinks_and_console_without_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp=Path(tmp);tree=tmp/'tree';(tree/'dev').mkdir(parents=True)
            (tree/'hello').write_bytes(b'abc');(tree/'link').symlink_to('hello')
            usb.cpio(tree,tmp/'init.gz');data=gzip.decompress((tmp/'init.gz').read_bytes())
            offset=0;entries={}
            while True:
                self.assertEqual(data[offset:offset+6],b'070701')
                fields=[int(data[offset+6+i*8:offset+14+i*8],16) for i in range(13)]
                size,namesize=fields[6],fields[11];offset+=110
                name=data[offset:offset+namesize-1].decode();offset=(offset+namesize+3)//4*4
                content=data[offset:offset+size];offset=(offset+size+3)//4*4
                entries[name]=(fields,content)
                if name=='TRAILER!!!': break
            self.assertEqual(entries['hello'][1],b'abc')
            self.assertEqual(entries['link'][1],b'hello')
            self.assertTrue(stat.S_ISLNK(entries['link'][0][1]))
            self.assertTrue(stat.S_ISCHR(entries['dev/console'][0][1]))
            self.assertEqual(entries['dev/console'][0][9:11],[5,1])

    @unittest.skipUnless(shutil.which('mke2fs') and shutil.which('resize2fs') and shutil.which('dumpe2fs'), 'e2fsprogs required')
    def test_rootfs_is_shrunk_to_its_content_plus_the_margin(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp=Path(tmp);tree=tmp/'tree';tree.mkdir();(tree/'data').write_bytes(os.urandom(24*1024*1024))
            image=tmp/'rootfs.ext4'
            subprocess.run(['mke2fs','-q','-t','ext4','-d',str(tree),str(image),'400M'],check=True,capture_output=True)
            before=image.stat().st_size
            with self.assertRaisesRegex(ValueError,'still has'):
                usb.check_shrunk(image)
            usb.shrink_rootfs(image)
            margin=usb.shrink_margin()
            after=image.stat().st_size
            self.assertLess(after,before//2,'the unused space is given back')
            self.assertGreater(after,24*1024*1024+margin//2)
            self.assertEqual(subprocess.run(['e2fsck','-fn',str(image)],capture_output=True).returncode,0)
            usb.check_shrunk(image)
            info=subprocess.run(['dumpe2fs','-h',str(image)],capture_output=True,text=True).stdout
            geometry={line.split(':')[0]:int(line.split(':')[1]) for line in info.splitlines() if line.split(':')[0] in ('Block size','Block count','Free blocks')}
            self.assertEqual(after,geometry['Block count']*geometry['Block size'],'the file is exactly as long as the file system')
            self.assertLessEqual(geometry['Free blocks']*geometry['Block size'],margin+32*1024*1024)
            self.assertEqual(subprocess.run(['dd','if='+str(image),'bs=1','skip=1080','count=2'],capture_output=True).stdout,b'\x53\xef','ext4 magic is intact')
            self.assertEqual([f for f in re.findall(r'Filesystem features:\s+(.*)',info)[0].split() if f in ('encrypt','casefold','verity')],[],'no new features')

    def test_foreign_rootfs_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            tools=Path(tmp);fake_tool(tools,'debugfs',FAKE_DEBUGFS)
            with self.assertRaisesRegex(ValueError,'not independent DevOs'): usb.identity(Path('/tmp/rootfs'),tools=tools,env={'FAKE_ETC':'ID=ubuntu\n'})

    def test_os_release_symlink_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            tools=Path(tmp);fake_tool(tools,'debugfs',FAKE_DEBUGFS)
            self.assertEqual(usb.identity(Path('/tmp/rootfs'),tools=tools,env={'FAKE_ETC':'','FAKE_USRLIB':'ID=devos\n'}),'ID=devos\n')

    def test_pending_hardware_blocks_usb_image_creation(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)
            (output/'manifest.json').write_text(json.dumps({'files':{},'hardwareReady':False,'reason':'pending X2'}))
            with self.assertRaisesRegex(ValueError,'X2 kernel/DTB'): usb.build(output)
            self.assertFalse((output/'devos-live-arm64-ux3407na.img').exists())

    def test_checksum_failure_blocks_modified_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp);(output/'Image').write_bytes(b'changed')
            (output/'manifest.json').write_text(json.dumps({'files':{'Image':'0'*64},'reason':'pending'}))
            with self.assertRaisesRegex(ValueError,'Checksum mismatch'): usb.check(output)

if __name__=='__main__': unittest.main()
