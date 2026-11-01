"""Cross-check native MINIX formatting/checking with independent image tools."""
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile

binary = str(Path(sys.argv[1]).resolve())
oracle = os.environ.get("BUSYBOX_ORACLE", "/home/ondev/devos/busybox-1.38.0/busybox")
system_formatter = shutil.which("mkfs.minix")
formatter = [system_formatter] if system_formatter else [oracle, "mkfs.minix"]
system_checker = shutil.which("fsck.minix")
checker = [system_checker] if system_checker else [oracle, "fsck.minix"]


def command(argv, status=0):
    result = subprocess.run(argv, capture_output=True, timeout=30)
    assert result.returncode == status, (argv, result)
    return result


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    for version in (1, 2):
        for names in (14, 30):
            image = root / f"native-{version}-{names}.img"
            with image.open("wb") as stream:
                stream.truncate(4 * 1024 * 1024)
            args = [binary, "mkfs.minix", "-n", str(names), "-i", "128"]
            if version == 2:
                args.append("-v")
            command([*args, str(image)])
            command([*checker, "-f", str(image)])
            command([binary, "fsck.minix", "-f", str(image)])
            # Flip allocation of the root data zone, then repair it natively.
            data = bytearray(image.read_bytes())
            imap, zmap, first = struct.unpack_from("<HHH", data, 1028)
            zoffset = (2 + imap) * 1024
            data[zoffset] &= ~2
            image.write_bytes(data)
            command([binary, "fsck.minix", "-f", str(image)], status=4)
            command([binary, "fsck.minix", "-a", str(image)], status=1)
            command([*checker, "-f", str(image)])
            # A second independent defect: root inode link count.
            data = bytearray(image.read_bytes())
            root_inode = (2 + imap + zmap) * 1024
            struct.pack_into("<H" if version == 2 else "<B", data,
                             root_inode + (2 if version == 2 else 13), 7)
            image.write_bytes(data)
            command([binary, "fsck.minix", "-a", str(image)], status=1)
            command([*checker, "-f", str(image)])
            # Accept a filesystem created by the independent implementation.
            independent = root / f"system-{version}-{names}.img"
            with independent.open("wb") as stream:
                stream.truncate(4 * 1024 * 1024)
            version_option = [f"-{version}"] if system_formatter else (["-v"] if version == 2 else [])
            command([*formatter, *version_option, "-n", str(names), str(independent)])
            command([binary, "fsck.minix", "-f", str(independent)])
    for count in (1, 10, 600):
        image = root / f"bad-{count}.img"
        with image.open("wb") as stream:
            stream.truncate(4 * 1024 * 1024)
        bad = root / "bad-blocks"
        bad.write_text("".join(f"{i}\n" for i in range(2000, 2000 + count)))
        reference = root / "reference-bad.img"
        reference.write_bytes(bytes(4 * 1024 * 1024))
        command([*formatter, "-i", "128", "-l", str(bad), str(reference)])
        command([binary, "fsck.minix", "-f", str(reference)])
        command([binary, "mkfs.minix", "-i", "128", "-l", str(bad), str(image)])
        command([*checker, "-f", str(image)])
        command([binary, "fsck.minix", "-f", str(image)])
    invalid = root / "invalid.img"
    invalid.write_bytes(bytes(4096))
    command([binary, "fsck.minix", str(invalid)], status=8)
    command([binary, "mkfs.minix", "-n", "99", str(invalid)], status=1)
print("MINIX V1/V2, 14/30-byte names, bitmap/link repair and bad-block inode checks passed")
