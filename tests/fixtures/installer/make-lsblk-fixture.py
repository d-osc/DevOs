"""Regenerates lsblk-mixed.txt: `lsblk -bP` output for a laptop with an internal NVMe disk, the Live USB and assorted unsafe disks."""
from pathlib import Path

GIB = 1024 ** 3
KEYS = ['NAME', 'PATH', 'TYPE', 'SIZE', 'MODEL', 'TRAN', 'RM', 'RO', 'MOUNTPOINTS', 'PKNAME', 'FSTYPE', 'LABEL']
ROWS = [
    ('nvme0n1', '/dev/nvme0n1', 'disk', 512 * GIB, 'WDC PC SN740', 'nvme', 0, 0, '', '', '', ''),
    ('nvme0n1p1', '/dev/nvme0n1p1', 'part', 512 * 1024 ** 2, '', '', 0, 0, '', 'nvme0n1', 'vfat', 'SYSTEM'),
    ('nvme0n1p2', '/dev/nvme0n1p2', 'part', 500 * GIB, '', '', 0, 0, '', 'nvme0n1', 'ntfs', 'Windows'),
    ('sdb', '/dev/sdb', 'disk', 32 * GIB, 'USB DISK 3.0', 'usb', 1, 0, '', '', '', ''),
    ('sdb1', '/dev/sdb1', 'part', 256 * 1024 ** 2, '', '', 1, 0, '/run/devos-liveesp.x', 'sdb', 'vfat', 'DEVOS_EFI'),
    ('sdb2', '/dev/sdb2', 'part', 4 * GIB, '', '', 1, 0, '/run/live/lower', 'sdb', 'ext4', ''),
    ('sdc', '/dev/sdc', 'disk', 4 * GIB, 'Tiny stick', 'usb', 1, 0, '', '', '', ''),
    ('sdd', '/dev/sdd', 'disk', 64 * GIB, 'Write protected', 'usb', 1, 1, '', '', '', ''),
    ('sde', '/dev/sde', 'disk', 256 * GIB, 'External SSD', 'usb', 0, 0, '', '', '', ''),
    ('sde1', '/dev/sde1', 'part', 256 * GIB - 1048576, '', '', 0, 0, '/mnt/data', 'sde', 'ext4', 'data'),
    ('zram0', '/dev/zram0', 'disk', 8 * GIB, '', '', 0, 0, '[SWAP]', '', 'swap', ''),
    ('sr0', '/dev/sr0', 'rom', 1 * GIB, 'DVD', 'sata', 1, 0, '', '', '', ''),
    ('loop0', '/dev/loop0', 'loop', 2 * GIB, '', '', 0, 0, '', '', '', ''),
    ('vda', '/dev/vda', 'disk', 20 * GIB, '', 'virtio', 0, 0, '', '', '', ''),
]
text = '\n'.join(' '.join(f'{key}="{value}"' for key, value in zip(KEYS, row)) for row in ROWS) + '\n'
Path(__file__).with_name('lsblk-mixed.txt').write_text(text, newline='\n')
