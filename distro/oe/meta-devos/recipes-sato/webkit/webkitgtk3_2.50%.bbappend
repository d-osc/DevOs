# WebKit 2.50's handwritten LLInt entry points do not contain BTI landing
# instructions. GCC's translation-unit note nevertheless marks JavaScriptCore
# as BTI-compatible, so a BTI-capable ARM64 CPU kills its first indirect call.
# Correct that capability declaration for this library only; retain PAC/GCS
# and the BTI markings of WebKit and every other system library.
do_install[postfuncs] += "devos_fix_jsc_bti"

python devos_fix_jsc_bti() {
    import pathlib
    import struct

    if d.getVar('TARGET_ARCH') != 'aarch64':
        return

    for library in pathlib.Path(d.getVar('D') + d.getVar('libdir')).glob('libjavascriptcoregtk-*.so.*'):
        if library.is_symlink():
            continue
        data = bytearray(library.read_bytes())
        if data[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', data, 18)[0] != 183:
            bb.fatal('Expected a little-endian ARM64 JavaScriptCore ELF: ' + str(library))
        phoff = struct.unpack_from('<Q', data, 32)[0]
        phsize, count = struct.unpack_from('<HH', data, 54)
        changed = False
        for i in range(count):
            ph = phoff + i * phsize
            if struct.unpack_from('<I', data, ph)[0] != 4:
                continue
            offset = struct.unpack_from('<Q', data, ph + 8)[0]
            end = offset + struct.unpack_from('<Q', data, ph + 32)[0]
            while offset + 12 <= end:
                namesz, descsz, kind = struct.unpack_from('<III', data, offset)
                name = bytes(data[offset + 12:offset + 12 + namesz])
                desc = offset + 12 + ((namesz + 3) & ~3)
                if name == b'GNU\0' and kind == 5:
                    prop = desc
                    while prop + 8 <= desc + descsz:
                        tag, length = struct.unpack_from('<II', data, prop)
                        if tag == 0xc0000000 and length == 4:
                            flags = struct.unpack_from('<I', data, prop + 8)[0]
                            struct.pack_into('<I', data, prop + 8, flags & ~1)
                            changed = changed or bool(flags & 1)
                        prop += 8 + ((length + 7) & ~7)
                offset = desc + ((descsz + 3) & ~3)
        if changed:
            library.write_bytes(data)
            bb.note('Removed unsupported LLInt BTI capability from ' + library.name)
}
