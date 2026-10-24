#!/usr/bin/env python3
"""Summarise a Qualcomm CamX sensor module file (com.qti.sensormodule.<sensor>.bin).

Prints what the container reliably holds (identity strings, field names, the
module/EEPROM names, a 19.2 MHz clock value) with byte offsets so a reviewer can
check each against `xxd`. It deliberately does NOT print GPIO numbers, regulators
or CSI lanes: the file stores only sensor register tables and logical power-step
types; physical pins and rails live in ACPI/the platform driver, not here.
Usage: decode-camx-sensormodule.py FILE
"""
import re
import struct
import sys

CLOCK_19_2_MHZ = 19200000


def decode(data):
    if not data.startswith(b'QTI Chromatix Header'):
        raise ValueError('Not a CamX sensor module file (missing "QTI Chromatix Header")')
    result = {'size': len(data), 'strings': {}, 'fields': [], 'clock_19_2_mhz_offsets': []}
    for match in re.finditer(rb'[A-Za-z_][A-Za-z0-9_ .:/-]{3,}', data):
        text = match.group().decode()
        result['strings'].setdefault(text, match.start())
    names = ('sensorDriverData', 'cameraModuleData', 'EEPROMDriverData', 'sensorName', 'moduleType', 'powerSetting',
             'slaveAddr', 'sensorSlaveAddress', 'sensorI2CFrequencyMode', 'laneAssign', 'isComboMode',
             'cphyDphyComboMode', 'moduleName', 'eepromName', 'flashName')
    result['fields'] = [(name, result['strings'][name]) for name in names if name in result['strings']]
    result['module_strings'] = [(text, offset) for text, offset in result['strings'].items()
                                if re.search(r'(ov|imx|hi)\d+[a-z0-9]*|eeprom|luxvision|sunny|ofilm', text, re.I)
                                and text not in names and len(text) < 40]
    for offset in range(0, len(data) - 3):
        if struct.unpack_from('<I', data, offset)[0] == CLOCK_19_2_MHZ:
            result['clock_19_2_mhz_offsets'].append(offset)
    return result


def main():
    with open(sys.argv[1], 'rb') as stream:
        info = decode(stream.read())
    print('size: %d bytes' % info['size'])
    print('field names (offset: name):')
    for name, offset in info['fields']:
        print('  0x%x: %s' % (offset, name))
    print('module / sensor identity strings:')
    for text, offset in info['module_strings']:
        print('  0x%x: %s' % (offset, text))
    print('19.2 MHz (0x%08x) u32 at offsets: %s' % (CLOCK_19_2_MHZ, ', '.join(hex(o) for o in info['clock_19_2_mhz_offsets']) or 'none'))
    print('NOT in this file: physical GPIO numbers, regulator rails, CSI lanes, CCI bus.')


if __name__ == '__main__':
    main()
