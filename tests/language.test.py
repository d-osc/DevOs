#!/usr/bin/env python3
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from devlang_support import D

ROOT = Path(__file__).resolve().parents[1]
helper = ROOT / 'bin/dev-os-language'
with tempfile.TemporaryDirectory(prefix='devos-language-') as temporary:
    base = Path(temporary)
    runtime = base / 'runtime'
    runtime.mkdir()
    env = os.environ | {'XDG_CONFIG_HOME': str(base / 'config'), 'XDG_RUNTIME_DIR': str(runtime)}
    env.pop('LABWC_PID', None)
    env.pop('DEV_OS_COMPOSITOR_CONFIG', None)
    def request(action, value=None, expected=0):
        result = subprocess.run([D, str(helper), '--', action], input=json.dumps(value) if value else None, capture_output=True, text=True, env=env)
        assert result.returncode == expected, result.stderr
        return json.loads(result.stdout or result.stderr)
    original = (ROOT / 'config/labwc/rc.xml').read_bytes()
    assert request('get')['settings'] == {'layouts': ['us', 'th'], 'shortcut': 'alt-shift'}
    directory = Path(subprocess.check_output([D, str(helper), '--', 'prepare', '--base', str(ROOT / 'config/labwc')], env=env, text=True).strip())
    assert 'XKB_DEFAULT_LAYOUT=us,th' in (directory / 'environment').read_text()
    assert 'grp:alt_shift_toggle' in (directory / 'environment').read_text()
    assert ET.parse(directory / 'rc.xml').find("keyboard/keybind[@key='W-space']") is not None
    for invalid in ({'layouts': [], 'shortcut': 'alt-shift'}, {'layouts': ['us', 'us'], 'shortcut': 'alt-shift'}, {'layouts': ['us\nBAD=1'], 'shortcut': 'alt-shift'}, {'layouts': ['us'], 'shortcut': 'invalid'}):
        assert request('save', invalid, 1)['ok'] is False
    value = {'layouts': ['th', 'us'], 'shortcut': 'super-space'}
    assert request('save', value)['applied'] is False
    assert request('get')['settings'] == value
    # Use a private signal receiver to verify only the owning session gets reloaded.
    marker = base / 'signal'
    receiver = subprocess.Popen([sys.executable, '-c', 'import signal,time,pathlib,sys; signal.signal(signal.SIGHUP, lambda *_: pathlib.Path(sys.argv[1]).write_text("reload")); print("ready", flush=True); time.sleep(30)', str(marker)], stdout=subprocess.PIPE, text=True)
    try:
        assert receiver.stdout.readline().strip() == 'ready'
        env |= {'DEV_OS_COMPOSITOR_CONFIG': str(directory), 'LABWC_PID': str(receiver.pid), 'XKB_DEFAULT_OPTIONS': 'compose:ralt,grp:ctrl_shift_toggle'}
        assert request('save', value)['applied']
        for _ in range(30):
            if marker.exists(): break
            time.sleep(.02)
        assert marker.exists()
        assert ET.parse(directory / 'rc.xml').find("keyboard/keybind[@key='W-space']") is None
        assert 'XKB_DEFAULT_OPTIONS=compose:ralt,grp:win_space_toggle' in (directory / 'environment').read_text()
        assert request('save', {'layouts': ['us'], 'shortcut': 'alt-shift'})['applied']
        assert ET.parse(directory / 'rc.xml').find("keyboard/keybind[@key='W-space']") is not None
        assert 'grp:alt_shift_toggle' in (directory / 'environment').read_text() and 'grp:win_space_toggle' not in (directory / 'environment').read_text()
        assert 'XKB_DEFAULT_VARIANT=basic' in (directory / 'environment').read_text()
    finally:
        receiver.terminate(); receiver.wait(timeout=3)
    assert (ROOT / 'config/labwc/rc.xml').read_bytes() == original
    # A corrupt file is preserved and must not block session startup.
    preferences = base / 'config/dev-os/language.json'
    preferences.write_text('{broken')
    result = subprocess.run([D, str(helper), '--', 'prepare', '--base', str(ROOT / 'config/labwc')], env=env, capture_output=True, text=True)
    assert result.returncode == 0 and preferences.read_text() == '{broken'
    assert request('get')['warning'] and preferences.read_text() == '{broken'
print('PASS: language defaults, persistence, validation, shortcut conflicts, session reload and corrupt-file recovery')
