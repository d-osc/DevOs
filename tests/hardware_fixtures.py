"""Synthetic /sys and /proc trees for hardware identification tests.

Each fixture maps a path below the fake root to its content. Device-tree
strings are NUL terminated like the real property files.
"""
from pathlib import Path

NUL = '\0'
ASUS_BIOS = {'bios_vendor': 'American Megatrends International, LLC.', 'bios_version': 'UX3407NA.300', 'bios_date': '09/01/2026'}

def dmi(**fields):
    return {f'sys/class/dmi/id/{name}': value + '\n' for name, value in fields.items()}

def device_tree(root='sys/firmware/devicetree/base', **props):
    return {f'{root}/{name}': value + NUL for name, value in props.items()}

FIXTURES = {
    'ux3407na-dmi': {
        'arch': 'aarch64',
        'files': {
            **dmi(sys_vendor='ASUSTeK COMPUTER INC.', product_name='Zenbook A14 UX3407NA_UX3407NA', product_family='Zenbook A',
                  product_version='1.0', board_vendor='ASUSTeK COMPUTER INC.', board_name='UX3407NA', chassis_type='10', **ASUS_BIOS),
            **device_tree(model='ASUSTeK Zenbook A14 (UX3407NA)', compatible='asus,zenbook-a14-ux3407na' + NUL + 'qcom,glymur'),
            'proc/cpuinfo': 'processor\t: 0\nBogoMIPS\t: 38.40\nCPU implementer\t: 0x51\nCPU part\t: 0x001\nprocessor\t: 1\nCPU implementer\t: 0x51\n',
            'sys/class/power_supply/BAT0/type': 'Battery\n',
        },
    },
    'ux3407na-dt-only': {
        'arch': 'aarch64',
        'files': device_tree('proc/device-tree', model='ASUSTeK Zenbook A14 (UX3407NA)',
                             compatible='asus,zenbook-a14-ux3407na' + NUL + 'qcom,glymur', **{'chassis-type': 'laptop'}),
    },
    'generic-desktop': {
        'arch': 'x86_64',
        'files': {
            **dmi(sys_vendor='Contoso Systems', product_name='DT-9000', board_name='Z790 Pro', chassis_type='3',
                  bios_vendor='Contoso', bios_version='F12'),
            'proc/cpuinfo': 'processor\t: 0\nmodel name\t: Contoso Core 9 9900\nprocessor\t: 1\nmodel name\t: Contoso Core 9 9900\n',
        },
    },
    'placeholder-board': {
        'arch': 'x86_64',
        'files': dmi(sys_vendor='To Be Filled By O.E.M.', product_name='System Product Name', board_name='B550M', chassis_type='3'),
    },
    'yoga-2in1': {
        'arch': 'x86_64',
        'files': {
            **dmi(sys_vendor='LENOVO', product_name='83AB', product_family='Yoga 7 2-in-1 14AHP9', chassis_type='31'),
            'sys/class/input/input5/name': 'Lenovo Tablet Mode Switch\n',
            'proc/cpuinfo': 'processor\t: 0\nmodel name\t: AMD Ryzen 7 8840HS\n',
            'sys/class/power_supply/BAT0/type': 'Battery\n',
        },
    },
    'laptop-with-tablet-switch': {
        'arch': 'x86_64',
        'files': {
            **dmi(sys_vendor='Contoso Systems', product_name='FlipBook 13', chassis_type='10'),
            'sys/class/input/input3/name': 'Intel HID switches\n',
            'sys/class/input/input3/capabilities/sw': '2\n',
        },
    },
    'battery-only': {'arch': 'x86_64', 'files': {'sys/class/power_supply/BAT1/type': 'Battery\n'}},
    'empty': {'arch': 'x86_64', 'files': {}},
}

# Values captured from the first real UX3407NA Live boot (hardware-logs-20261024-1017):
# kernel "Machine model: ASUS Zenbook A14 (UX3407NA)", SMBIOS 3.8.0 "UX3407NA.315 07/23/2026",
# device-tree compatible "asus,zenbook-a14-ux3407na" + "qcom,glymur". chassis_type was not logged.
REAL_UX3407NA_FILES = {
    **dmi(sys_vendor='ASUSTeK COMPUTER INC.', product_name='Zenbook A14 UX3407NA', product_family='Zenbook A14',
          board_vendor='ASUSTeK COMPUTER INC.', board_name='UX3407NA', bios_vendor='American Megatrends International, LLC.',
          bios_version='UX3407NA.315', bios_date='07/23/2026'),
    **device_tree(model='ASUS Zenbook A14 (UX3407NA)', compatible='asus,zenbook-a14-ux3407na' + NUL + 'qcom,glymur'),
    'proc/cpuinfo': 'processor\t: 0\nCPU implementer\t: 0x51\nCPU part\t: 0x001\n',
}
FIXTURES['ux3407na-real'] = {'arch': 'aarch64', 'files': REAL_UX3407NA_FILES}
FIXTURES['ux3407na-real-dt-only'] = {'arch': 'aarch64', 'files': {k: v for k, v in REAL_UX3407NA_FILES.items() if 'dmi' not in k}}

def materialize(name, directory):
    """Write fixture `name` below `directory`; returns its (root, arch)."""
    root = Path(directory) / name
    root.mkdir(parents=True)
    for relative, content in FIXTURES[name]['files'].items():
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content.encode())
    return root, FIXTURES[name]['arch']
