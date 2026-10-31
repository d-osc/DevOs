#!/usr/bin/env python3
"""A compress(1)-compatible LZW encoder (block mode, 16 bits) for tests: lzw_compress.py < input > output.Z"""
import sys

MAXBITS = 16


def compress(data):
    out = bytearray(b"\x1f\x9d" + bytes([0x80 | MAXBITS]))
    n_bits = 9
    max_code = (1 << n_bits) - 1
    free_ent = 257
    table = {}
    group = []  # codes of the current group of up to eight

    def flush_group(full):
        nonlocal group
        if not group:
            return
        bits = 0
        count = 0
        buffer = bytearray()
        for code in group:
            bits |= code << count
            count += n_bits
            while count >= 8:
                buffer.append(bits & 0xFF)
                bits >>= 8
                count -= 8
        if count > 0:
            buffer.append(bits & 0xFF)
        if full:
            buffer.extend(b"\x00" * (n_bits - len(buffer)))
        out.extend(buffer)
        group = []

    def emit(code):
        nonlocal n_bits, max_code
        group.append(code)
        if len(group) == 8:
            flush_group(True)
        if free_ent > max_code and n_bits < MAXBITS:
            flush_group(True)
            n_bits += 1
            max_code = (1 << n_bits) - 1

    if not data:
        return bytes(out)
    entry = data[0]
    for byte in data[1:]:
        key = (entry, byte)
        if key in table:
            entry = table[key]
            continue
        emit(entry)
        entry = byte
        if free_ent < (1 << MAXBITS):
            table[key] = free_ent
            free_ent += 1
    emit(entry)
    flush_group(False)
    return bytes(out)


sys.stdout.buffer.write(compress(sys.stdin.buffer.read()))
