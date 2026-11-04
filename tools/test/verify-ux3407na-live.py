#!/usr/bin/env python3
"""Read back the physical-display mitigations from both EFI images in a staged USB.

This is artifact validation, not a claim that an ASUS panel has been tested.
Usage: python3 tools/test/verify-ux3407na-live.py STAGING
"""
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def pe_sections(data):
    pe = struct.unpack_from('<I', data, 0x3c)[0]
    require(data[pe:pe+4] == b'PE\0\0', 'Not a PE image')
    require(struct.unpack_from('<H', data, pe+4)[0] == 0xaa64, 'EFI is not ARM64')
    count = struct.unpack_from('<H', data, pe+6)[0]
    optional = struct.unpack_from('<H', data, pe+20)[0]
    result = {}
    for i in range(count):
        offset = pe+24+optional+40*i
        name = data[offset:offset+8].rstrip(b'\0').decode('ascii')
        size = struct.unpack_from('<I', data, offset+8)[0]
        start = struct.unpack_from('<I', data, offset+20)[0]
        require(start+size <= len(data), 'EFI section exceeds file: '+name)
        result[name] = data[start:start+size]
    return result


def verify(stage):
    manifest = json.loads((stage/'manifest.json').read_text())
    require(manifest['board'] == 'asus-ux3407na', 'Wrong hardware profile')
    require(manifest.get('firmwareDisplayPowerPreserved') is True, 'Display power mitigation missing')
    config = (stage/'kernel.config').read_text().splitlines()
    for option in ('CONFIG_DRM_MSM=m', 'CONFIG_DRM_PANEL_SAMSUNG_ATNA33XC20=m', 'CONFIG_CLK_GLYMUR_DISPCC=m'):
        require(option in config, 'Blacklist requires a modular driver: '+option)
    image = stage/'devos-live-arm64-ux3407na.img'
    with image.open('rb') as stream:
        stream.seek(512)
        gpt = stream.read(92)
        require(gpt[:8] == b'EFI PART', 'Missing GPT')
        table = struct.unpack_from('<Q', gpt, 72)[0]*512
        stream.seek(table+32)
        esp = struct.unpack('<Q', stream.read(8))[0]*512
    result = {'board': manifest['board'], 'physicalDisplayVerified': False, 'efi': []}
    with tempfile.TemporaryDirectory(prefix='devos-native-display-') as temporary:
        for boot in ('EFI/BOOT/BOOTAA64.EFI', 'EFI/DEVOS/INSTALLED.EFI'):
            destination = Path(temporary)/Path(boot).name
            subprocess.run(['mcopy', '-i', f'{image}@@{esp}', '::/'+boot, str(destination)], check=True)
            blob = destination.read_bytes()
            sections = pe_sections(blob)
            for section, name in (('.linux', 'Image'), ('.dtb', 'board.dtb'), ('.initrd', 'initramfs.cpio.gz')):
                require(sha(sections[section]) == manifest['files'][name], 'Embedded section mismatch: '+boot+' '+section)
            words = sections['.cmdline'].rstrip(b'\0').decode().split()
            require('splash' in words, 'Animated boot flag missing: '+boot)
            for override in ('debug', 'devos.splash=0', 'systemd.show_status=1', 'systemd.show_status=true'):
                require(override not in words, 'Boot animation overridden: '+boot+' '+override)
            blocked = set()
            for word in words:
                if word.startswith('module_blacklist='):
                    blocked.update(word.split('=', 1)[1].split(','))
            require({'msm', 'panel_samsung_atna33xc20', 'dispcc_glymur'} <= blocked, 'Incomplete firmware display blacklist: '+boot)
            for word in ('clk_ignore_unused', 'pd_ignore_unused'):
                require(word in words, 'Firmware display resource preservation missing: '+word)
            root = 'devos.live.uuid='+manifest['filesystemUuid'] if 'BOOTAA64' in boot else 'devos.root=LABEL=devos-root'
            require(root in words, 'Wrong root target: '+boot)
            dtb = Path(temporary)/'embedded.dtb'
            dtb.write_bytes(sections['.dtb'])
            name = subprocess.check_output(['fdtget', '-t', 's', str(dtb), '/regulator-edp', 'regulator-name'], text=True).strip()
            require(name == 'VREG_EDP_3P3', 'Wrong panel power rail')
            subprocess.run(['fdtget', str(dtb), '/regulator-edp', 'regulator-always-on'], check=True, stdout=subprocess.DEVNULL)
            result['efi'].append({'path': boot, 'sha256': sha(blob), 'blacklist': sorted(blocked), 'panelPowerAlwaysOn': True})
    return result


if __name__ == '__main__':
    print(json.dumps(verify(Path(sys.argv[1]).resolve()), indent=2))
