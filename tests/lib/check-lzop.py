"""Interoperate with independently built BusyBox lzop, including all levels."""
import os
from pathlib import Path
import random
import subprocess
import sys
import tempfile

binary = str(Path(sys.argv[1]).resolve())
oracle = os.environ.get("BUSYBOX_ORACLE", "/home/ondev/devos/busybox-1.38.0/busybox")
generator = random.Random(501)
inputs = [b"", b"a", b"abc", bytes(range(256)), b"a" * 300000,
          b"abc123XYZ" * 60000, generator.randbytes(300000),
          b"".join(generator.randbytes(12) * generator.randrange(1, 50) for _ in range(1200))]


def call(program, applet, data, *options, status=0):
    result = subprocess.run([program, applet, *options], input=data,
                            capture_output=True, timeout=20)
    assert result.returncode == status, (program, applet, options, result.stderr)
    return result.stdout


for data in inputs:
    encoded = call(binary, "lzop", data, "-c")
    assert call(oracle, "lzop", encoded, "-dc") == data
    assert call(binary, "lzopcat", encoded) == data
    for level in ("-1", "-3"):
        encoded = call(oracle, "lzop", data, "-c", level)
        assert call(binary, "unlzop", encoded, "-c") == data, (len(data), level)
    for options in (("-F",), ("-C",), ("-F", "-C")):
        encoded = call(binary, "lzop", data, "-c", *options)
        assert call(oracle, "lzop", encoded, "-dc") == data
data = b"compressible data\n" * 10000
import ctypes
import ctypes.util
import struct
import zlib
library = ctypes.CDLL(ctypes.util.find_library("lzo2"))
compress999 = library.lzo1x_999_compress
compress999.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_void_p,
                        ctypes.POINTER(ctypes.c_ulong), ctypes.c_void_p]
compress999.restype = ctypes.c_int
output = ctypes.create_string_buffer(len(data) + len(data) // 16 + 128)
length = ctypes.c_ulong(len(output))
work = ctypes.create_string_buffer(1024 * 1024)
assert compress999(data, len(data), output, ctypes.byref(length), work) == 0
reference = call(oracle, "lzop", b"", "-c")[:38]
high_compression = reference + struct.pack("!III", len(data), length.value, zlib.adler32(data)) + output.raw[:length.value] + bytes(4)
assert call(binary, "lzopcat", high_compression) == data
encoded = call(binary, "lzop", data, "-c")
assert len(encoded) < len(data) // 2, (len(encoded), len(data))
for length in (0, 1, 8, 12, 30, len(encoded) - 1):
    call(binary, "lzopcat", encoded[:length], status=1)
damaged = bytearray(encoded)
damaged[-5] ^= 0x80
call(binary, "lzopcat", damaged, status=1)
concatenated = call(oracle, "lzop", b"one", "-c") + call(oracle, "lzop", b"two", "-c")
assert call(binary, "lzopcat", concatenated) == b"onetwo"
with tempfile.TemporaryDirectory() as directory:
    path = Path(directory) / "sample"
    path.write_bytes(data)
    result = subprocess.run([binary, "lzop", str(path)], capture_output=True, timeout=10)
    assert result.returncode == 0 and path.exists(), result
    compressed = path.with_suffix(".lzo")
    result = subprocess.run([binary, "lzop", str(path)], capture_output=True, timeout=10)
    assert result.returncode == 1 and compressed.exists(), result
print("native LZO1X/lzop cross-implementation, checksum, corruption and file checks passed")
