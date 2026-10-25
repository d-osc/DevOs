"""Python view of the DevLang Live USB staging library, for the host tests.

`usb.<function>(...)` runs the real library (distro/usb/usbimage.dev) through tests/fixtures/usb-driver.dev. Tools such as debugfs and
BusyBox can be replaced by fakes: pass `tools=<directory>` and the directory is put first on PATH.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
D = os.environ.get('DEVLANG_BIN') or shutil.which('d') or str(Path.home() / '.local/bin/d')
DRIVER = ROOT / 'tests/fixtures/usb-driver.dev'


class Usb:
    HERE = ROOT / 'distro/usb'
    PROFILES = ROOT / 'profiles'
    BOARD_PROFILE = 'asus/ux3407na'
    WIFI_BOARD = 'ath12k/QCC2072/hw1.0/board.bin'
    REQUIRED_APPLETS = {'mount', 'modprobe', 'switch_root', 'sh', 'find', 'findfs', 'seq', 'cat', 'mkdir', 'sleep', 'cp', 'chmod', 'ln', 'readlink', 'dmesg',
                        'timeout', 'kill', 'umount', 'sync', 'mv', 'tail', 'echo', 'true', 'false', 'test', '['}

    @staticmethod
    def digest(path):
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()

    def call(self, name, *args, tools=None, env=None):
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as handle:
            json.dump({'fn': name, 'args': [str(a) for a in args]}, handle)
        merged = os.environ | (env or {}) | {'DRIVER_CALL_FILE': handle.name}
        if tools:
            merged['PATH'] = f"{tools}{os.pathsep}{merged['PATH']}"
        try:
            done = subprocess.run([D, str(DRIVER), '--'], capture_output=True, text=True, env=merged, timeout=300)
        finally:
            os.unlink(handle.name)
        if done.returncode != 0:
            raise RuntimeError(done.stdout + done.stderr)
        line = done.stdout.strip().splitlines()[-1]
        answer = json.loads(line)
        if 'error' in answer:
            raise ValueError(answer['error'])
        return answer['result']

    def firmware_bundle(self, path, **kw): return self.call('firmwareBundle', path, **kw)
    def check(self, path, **kw): return self.call('check', path, **kw)
    def kernel_bundle(self, path, **kw): return self.call('kernelBundle', path, **kw)
    def profile_kernel_args(self, profile='', **kw): return self.call('profileKernelArgs', profile, **kw)
    def profile_early_firmware(self, **kw): return self.call('profileEarlyFirmware', **kw)
    def pe_sections(self, path, **kw): return {item['name']: (item['offset'], item['size']) for item in self.call('peSections', path, **kw)}
    def install_modules(self, rootfs, modules, output, target='', **kw): return self.call('installModules', rootfs, modules, output, target or '', **kw)
    def install_boot_tools(self, tree, busybox, **kw): return self.call('installBootTools', tree, busybox, **kw)
    def stage_bluetooth_firmware(self, rootfs, tree, **kw): return self.call('stageBluetoothFirmware', rootfs, tree, **kw)
    def stage_camera_modules(self, rootfs, bundle, output, **kw): return self.call('stageCameraModules', rootfs, bundle, output, **kw)
    def cpio(self, tree, output, **kw): return self.call('cpio', tree, output, **kw)
    def build(self, output, **kw): return self.call('build', output, **kw)
    def identity(self, rootfs, **kw): return self.call('identity', rootfs, **kw)
    def shrink_rootfs(self, path, **kw): return self.call('shrinkRootfs', path, **kw)
    def check_shrunk(self, path, **kw): return self.call('checkShrunk', path, **kw)
    def shrink_margin(self, **kw): return self.call('shrinkMargin', **kw)
    def splash_args(self, **kw): return self.call('splashArgs', **kw)
    def install_splash(self, tree, **kw): return self.call('installSplash', tree, **kw)
    def check_camera_source(self, tree, **kw): return self.call('checkCameraSource', tree, **kw)
    def append_audio(self, board, **kw): return self.call('appendAudio', board, **kw)
    def preserve_ec(self, tree, record, **kw): return self.call('preserveEc', tree, json.dumps(record), **kw)
    def write_proof(self, bundle, original, camera=False, **kw): return self.call('writeProof', bundle, original, '1' if camera else '0', **kw)
    def validate_proof(self, bundle, record, filename='board-fixes.json', **kw): return self.call('validateProof', bundle, json.dumps(record), filename, **kw)


usb = Usb()


def fake_tool(directory, name, script):
    """Write an executable sh script `name` into `directory` (a stand-in for debugfs, busybox, ...)."""
    path = Path(directory) / name
    path.write_text('#!/bin/sh\n' + script)
    path.chmod(0o755)
    return path
