import json
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / 'native/devos-swap'
FRONT = ROOT / 'bin/dev-os-swap'
MIB = 1048576

ZRAMCTL = r'''#!/bin/sh
# Fake zramctl: devices live in $FAKE/zram/zramN as "<bytes> <algorithm>".
D="$FAKE/zram"; mkdir -p "$D"
case " $* " in
    *" --find "*)
        size=; algo=lzo
        while [ $# -gt 0 ]; do case "$1" in --size) size=$2; shift ;; --algorithm) algo=$2; shift ;; esac; shift; done
        [ "$FAKE_NO_ZSTD" = 1 ] && [ "$algo" = zstd ] && exit 1
        [ "$FAKE_ZRAM_FAIL" = 1 ] && exit 1
        n=0; while [ -e "$D/zram$n" ]; do n=$((n + 1)); done
        echo "$size $algo" > "$D/zram$n"; mkdir -p "$FAKE/sys/block/zram$n"; : > "$FAKE/sys/block/zram$n/mem_limit"
        echo "/dev/zram$n" ;;
    *" --reset "*) for a in "$@"; do last=$a; done; name=${last#/dev/}; rm -f "$D/$name" ;;
    *)
        cols=; while [ $# -gt 0 ]; do [ "$1" = -o ] && cols=$2; shift; done
        for f in "$D"/zram*; do
            [ -e "$f" ] || continue; name=/dev/${f##*/}; set -- $(cat "$f")
            case "$cols" in
                NAME,DISKSIZE) echo "$name $1" ;;
                NAME,ALGORITHM) echo "$name $2" ;;
                NAME,DATA,COMPR,TOTAL,ALGORITHM) echo "$name 3000000 1000000 1200000 $2" ;;
            esac
        done ;;
esac
'''
SWAPON = r'''#!/bin/sh
prio=; while [ $# -gt 1 ]; do [ "$1" = --priority ] && prio=$2; shift; done
dev=$1
case "$dev" in /dev/zram*) kib=$(( $(cut -d' ' -f1 "$FAKE/zram/${dev#/dev/}") / 1024 )) ;; *) kib=$(( $(stat -c %s "$dev") / 1024 )) ;; esac
echo "$dev partition $kib ${FAKE_USED_KIB:-0} $prio" >> "$FAKE/proc/swaps"
echo "swapon $prio $dev" >> "$FAKE/log"
'''
SWAPOFF = r'''#!/bin/sh
[ "$FAKE_SWAPOFF_FAIL" = 1 ] && exit 1
grep -v "^$1 " "$FAKE/proc/swaps" > "$FAKE/proc/swaps.new"; mv "$FAKE/proc/swaps.new" "$FAKE/proc/swaps"
echo "swapoff $1" >> "$FAKE/log"
'''
FALLOCATE = r'''#!/bin/sh
[ "$FAKE_FALLOCATE_FAIL" = 1 ] && exit 1
n=${2%M}; dd if=/dev/zero of="$3" bs=1048576 count=0 seek="$n" 2>/dev/null
echo "fallocate $2 $3" >> "$FAKE/log"
'''
MKSWAP = '#!/bin/sh\n[ "$FAKE_MKSWAP_FAIL" = 1 ] && exit 1\necho "mkswap $1" >> "$FAKE/log"\n'
MODPROBE = '#!/bin/sh\necho "modprobe $*" >> "$FAKE/log"\n'


class SwapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'; self.bin.mkdir()
        for name, body in (('zramctl', ZRAMCTL), ('swapon', SWAPON), ('swapoff', SWAPOFF), ('fallocate', FALLOCATE), ('mkswap', MKSWAP), ('modprobe', MODPROBE)):
            path = self.bin / name; path.write_text(body, newline='\n'); path.chmod(0o755)
        self.proc = self.root / 'proc'; (self.proc / 'sys/vm').mkdir(parents=True)
        self.put_mem(8 * 1024)
        (self.proc / 'swaps').write_text('Filename\tType\tSize\tUsed\tPriority\n')
        (self.proc / 'cmdline').write_text('quiet\n'); (self.proc / 'mounts').write_text('/dev/sda2 / ext4 rw 0 0\n')
        (self.proc / 'sys/vm/swappiness').write_text('60\n'); (self.proc / 'sys/vm/page-cluster').write_text('3\n')
        self.conf = self.root / 'etc/swap.conf'
        self.file = self.root / 'var/swap/devos.swap'

    def put_mem(self, mib):
        (self.proc / 'meminfo').write_text(f'MemTotal:       {mib * 1024} kB\nMemFree:        1 kB\n')

    def env(self, **extra):
        e = os.environ | {'FAKE': str(self.root), 'DEVOS_SWAP_PROC': str(self.proc), 'DEVOS_SWAP_SYS': str(self.root / 'sys'), 'DEVOS_SWAP_CONF': str(self.conf),
            'DEVOS_SWAP_FILE': str(self.file), 'DEVOS_SWAP_ALLOW_USER': '1', 'DEVOS_SWAP_LIVE': '0', 'DEVOS_SWAP_FSTYPE': 'ext4', 'DEVOS_SWAP_FREE_MIB': '100000',
            'DEVOS_SWAP_FSTOTAL_MIB': '200000', 'DEVOS_SWAP_CORE': str(CORE), 'DEVOS_SWAP_ZRAMCTL': str(self.bin / 'zramctl'), 'DEVOS_SWAP_MKSWAP': str(self.bin / 'mkswap'),
            'DEVOS_SWAP_SWAPON': str(self.bin / 'swapon'), 'DEVOS_SWAP_SWAPOFF': str(self.bin / 'swapoff'), 'DEVOS_SWAP_FALLOCATE': str(self.bin / 'fallocate'),
            'DEVOS_SWAP_MODPROBE': str(self.bin / 'modprobe'), 'DEVOS_SWAP_LOCK': str(self.root / 'swap.lock'), 'DEVOS_SWAP_LOCK_WAIT': '2'}
        return e | extra

    def core(self, *args, **extra):
        r = subprocess.run(['sh', str(CORE), *args], capture_output=True, text=True, env=self.env(**extra), timeout=30)
        return r.returncode, json.loads(r.stdout)

    def log(self): p = self.root / 'log'; return p.read_text().splitlines() if p.exists() else []
    def swaps(self): return (self.proc / 'swaps').read_text().splitlines()[1:]
    def devices(self): d = self.root / 'zram'; return sorted(p.name for p in d.glob('zram*')) if d.exists() else []
    def saved(self): return self.conf.read_text() if self.conf.exists() else None
    def read(self, rel): return (self.proc / rel).read_text().strip()

    def test_default_is_zram_as_large_as_ram_with_zstd(self):
        code, info = self.core('get')
        self.assertEqual((code, info['type'], info['percent'], info['sizeMiB'], info['algorithm'], info['swappiness'], info['configured']), (0, 'zram', 100, 8192, 'zstd', 100, False))
        self.assertEqual((info['minMiB'], info['maxMiB'], info['memTotalMiB']), (256, 16384, 8192))
        self.assertEqual(self.core('apply')[1], {'ok': True, 'applied': True})
        self.assertEqual(self.devices(), ['zram0'])
        self.assertEqual((self.root / 'zram/zram0').read_text().split(), [str(8192 * MIB), 'zstd'])
        self.assertEqual(self.swaps(), [f'/dev/zram0 partition {8192 * 1024} 0 100'])
        self.assertEqual((self.read('sys/vm/swappiness'), self.read('sys/vm/page-cluster')), ('100', '0'))
        self.assertEqual((self.root / 'sys/block/zram0/mem_limit').read_text().strip(), str(8192 * MIB * 60 // 100), 'compressed pages are capped at 60% of RAM')
        self.assertIsNone(self.saved(), 'booting never writes the configuration')
        info = self.core('get')[1]
        self.assertEqual((info['active']['type'], info['active']['algorithm'], info['active']['dataBytes'], info['active']['compressedBytes'], info['active']['memoryBytes']), ('zram', 'zstd', 3000000, 1000000, 1200000))

    def test_boot_keeps_a_matching_device_and_replaces_a_wrong_one(self):
        self.core('apply'); before = self.log()
        self.core('apply')
        self.assertEqual(self.log(), before, 'nothing is rebuilt when the device already matches')
        self.put_mem(4096); self.core('apply')
        self.assertEqual(self.swaps(), [f'/dev/zram1 partition {4096 * 1024} 0 100'])
        self.assertEqual(self.devices(), ['zram1'])

    def test_set_resizes_builds_new_before_removing_old_and_saves(self):
        self.core('apply')
        code, info = self.core('set', 'percent=50', 'swappiness=150')
        self.assertEqual((code, info['ok'], info['sizeMiB'], info['swappiness']), (0, True, 4096, 150))
        self.assertEqual(self.devices(), ['zram1'])
        log = self.log(); self.assertLess(log.index('swapon 100 /dev/zram1'), log.index('swapoff /dev/zram0'))
        self.assertEqual(self.saved(), 'type=zram\npercent=50\nalgorithm=zstd\nswappiness=150\n')
        self.assertEqual(self.read('sys/vm/swappiness'), '150')
        code, info = self.core('set', 'mib=3000', 'algorithm=lz4')
        self.assertEqual((info['sizeMiB'], info['percent'], info['algorithm'], info['active']['algorithm']), (3000, None, 'lz4', 'lz4'))
        self.assertEqual(self.saved(), 'type=zram\nmib=3000\nalgorithm=lz4\nswappiness=150\n')
        for preset, expected in ((25, 2048), (100, 8192), (150, 12288), (200, 16384)):
            self.assertEqual(self.core('set', f'percent={preset}')[1]['sizeMiB'], expected)

    def test_swappiness_only_change_keeps_the_device(self):
        self.core('apply'); before = self.log()
        self.core('set', 'swappiness=40')
        self.assertEqual(self.log(), before); self.assertEqual(self.read('sys/vm/swappiness'), '40')

    def test_validation_rejects_every_bad_value_and_saves_nothing(self):
        self.core('apply')
        for bad in (['mib=255'], ['mib=16385'], ['mib=abc'], ['mib=-5'], ['percent=0'], ['percent=201'], ['percent=x'], ['algorithm=lzo'], ['algorithm=zstd;reboot'], ['swappiness=0'],
                    ['swappiness=201'], ['swappiness=1e2'], ['type=nfs'], ['size=5'], ['mib=']):
            code, info = self.core('set', *bad)
            self.assertEqual((code, info['ok']), (1, False), bad)
        self.assertIsNone(self.saved()); self.assertEqual(self.devices(), ['zram0'])
        self.assertEqual(self.core('set', 'mib=256')[0], 0); self.assertEqual(self.core('set', 'mib=16384')[0], 0)

    def test_zstd_falls_back_to_lz4_when_the_kernel_lacks_it(self):
        code, info = self.core('apply', FAKE_NO_ZSTD='1')
        self.assertEqual(code, 0); self.assertEqual((self.root / 'zram/zram0').read_text().split()[1], 'lz4')
        self.assertEqual(self.core('get')[1]['active']['algorithm'], 'lz4')

    def test_zram_failure_is_reported_and_keeps_the_old_swap(self):
        self.core('apply')
        code, info = self.core('set', 'percent=50', FAKE_ZRAM_FAIL='1')
        self.assertEqual((code, info['ok']), (1, False)); self.assertIn('could not be created', info['error'])
        self.assertEqual(self.devices(), ['zram0']); self.assertIsNone(self.saved())

    def test_a_swapoff_that_fails_rolls_back_the_new_device(self):
        self.core('apply')
        code, info = self.core('set', 'percent=50', FAKE_SWAPOFF_FAIL='1')
        self.assertEqual((code, info['ok']), (1, False)); self.assertIn('Not enough free memory', info['error'])
        self.assertIsNone(self.saved())

    def test_off_removes_swap(self):
        self.core('apply'); code, info = self.core('set', 'type=off')
        self.assertEqual((code, info['active']['type']), (0, 'none')); self.assertEqual(self.swaps(), []); self.assertEqual(self.devices(), [])
        self.assertIn('type=off', self.saved()); self.assertEqual(self.read('sys/vm/page-cluster'), '3')
        self.core('apply'); self.assertEqual(self.devices(), [], 'off stays off after a reboot')

    def test_live_session_refuses_disk_swap(self):
        info = self.core('get', DEVOS_SWAP_LIVE='1')[1]
        self.assertEqual((info['live'], info['fileAllowed'], info['maxFileMiB']), (True, False, 0)); self.assertIn('Live', info['fileReason'])
        code, info = self.core('set', 'type=file', 'percent=50', DEVOS_SWAP_LIVE='1')
        self.assertEqual((code, info['ok']), (1, False)); self.assertIn('Live', info['error']); self.assertFalse(self.file.exists())
        (self.proc / 'cmdline').write_text('quiet devos.live.uuid=abc\n')
        self.assertTrue(self.core('get', DEVOS_SWAP_LIVE='')[1]['live'])
        (self.proc / 'cmdline').write_text('quiet devos.live.uuid=abc devos.root=LABEL=x\n')
        self.assertFalse(self.core('get', DEVOS_SWAP_LIVE='')[1]['live'])
        (self.proc / 'mounts').write_text('overlay / overlay rw 0 0\n')
        self.assertTrue(self.core('get', DEVOS_SWAP_LIVE='')[1]['live'])

    def test_swap_file_is_private_fits_the_disk_and_replaces_zram(self):
        self.core('apply')
        code, info = self.core('set', 'type=file', 'mib=2048')
        self.assertEqual((code, info['active']['type'], info['active']['sizeBytes']), (0, 'file', 2048 * MIB))
        self.assertEqual(stat.S_IMODE(self.file.stat().st_mode) & 0o077, 0, 'no group or other access'); self.assertEqual(self.file.stat().st_size, 2048 * MIB)
        self.assertEqual(self.devices(), []); self.assertEqual(self.swaps(), [f'{self.file} partition {2048 * 1024} 0 10'])
        log = self.log(); self.assertLess(log.index(f'swapon 10 {self.file}'), log.index('swapoff /dev/zram0'))
        self.assertEqual((self.read('sys/vm/page-cluster')), '3')
        self.assertIn('type=file\nmib=2048', self.saved())
        # resize keeps one file; off deletes it
        code, info = self.core('set', 'mib=1024'); self.assertEqual((code, self.file.stat().st_size), (0, 1024 * MIB)); self.assertEqual(len(self.swaps()), 1)
        self.core('set', 'type=off'); self.assertFalse(self.file.exists()); self.assertEqual(self.swaps(), [])

    def test_swap_file_limits_and_unsuitable_file_systems(self):
        info = self.core('get', DEVOS_SWAP_FREE_MIB='6100', DEVOS_SWAP_FSTOTAL_MIB='20000')[1]
        self.assertEqual(info['maxFileMiB'], 4052, 'free space minus max(2 GiB, 10%) reserve')
        info = self.core('get', DEVOS_SWAP_FREE_MIB='1000')[1]; self.assertEqual(info['maxFileMiB'], 0)
        code, info = self.core('set', 'type=file', 'mib=5000', DEVOS_SWAP_FREE_MIB='6100', DEVOS_SWAP_FSTOTAL_MIB='20000')
        self.assertEqual((code, info['ok']), (1, False)); self.assertIn('not enough free disk space', info['error']); self.assertFalse(self.file.exists())
        self.assertEqual(self.core('set', 'type=file', 'mib=4000', DEVOS_SWAP_FREE_MIB='6100', DEVOS_SWAP_FSTOTAL_MIB='20000')[0], 0)
        for fs in ('btrfs', 'zfs', 'tmpfs', 'overlay', 'f2fs', 'ntfs'):
            code, info = self.core('set', 'type=file', 'mib=1024', DEVOS_SWAP_FSTYPE=fs)
            self.assertEqual((code, info['ok']), (1, False), fs); self.assertFalse(self.core('get', DEVOS_SWAP_FSTYPE=fs)[1]['fileAllowed'])
        for fs in ('ext4', 'ext2/ext3', 'xfs'): self.assertTrue(self.core('get', DEVOS_SWAP_FSTYPE=fs)[1]['fileAllowed'])

    def test_swap_file_failures_leave_nothing_behind(self):
        self.core('apply')
        for extra in ({'FAKE_FALLOCATE_FAIL': '1'}, {'FAKE_MKSWAP_FAIL': '1'}):
            code, info = self.core('set', 'type=file', 'mib=1024', **extra)
            self.assertEqual((code, info['ok']), (1, False)); self.assertFalse(self.file.exists()); self.assertFalse(Path(str(self.file) + '.new').exists())
            self.assertEqual(self.devices(), ['zram0']); self.assertIsNone(self.saved())

    def test_boot_falls_back_to_zram_when_the_saved_swap_file_is_not_usable(self):
        self.conf.parent.mkdir(parents=True); self.conf.write_text('type=file\nmib=1024\nalgorithm=zstd\nswappiness=100\n')
        code, info = self.core('apply', DEVOS_SWAP_LIVE='1')
        self.assertEqual(code, 0); self.assertEqual(self.devices(), ['zram0']); self.assertFalse(self.file.exists())
        self.core('apply')
        self.assertEqual(self.core('get')[1]['active']['type'], 'file', 'with a usable disk the saved file swap is rebuilt')

    def test_garbage_config_values_are_ignored(self):
        self.conf.parent.mkdir(parents=True); self.conf.write_text('type=zram\nmib=99999999\nalgorithm=bogus;rm\nswappiness=9000\n')
        self.core('apply'); self.assertEqual((self.root / 'zram/zram0').read_text().split(), [str(8192 * MIB), 'zstd'])
        self.assertEqual(self.read('sys/vm/swappiness'), '100')

    def test_other_swap_is_reported_and_left_alone(self):
        (self.proc / 'swaps').write_text('Filename\tType\tSize\tUsed\tPriority\n/dev/nvme0n1p3 partition 1000 0 -2\n')
        self.assertEqual(self.core('get')[1]['active']['type'], 'other')
        self.core('apply'); self.assertEqual(len(self.swaps()), 2); self.assertNotIn('swapoff /dev/nvme0n1p3', self.log())

    def test_changes_are_serialized_and_a_dead_lock_is_taken_over(self):
        lock = self.root / 'swap.lock'; lock.mkdir(); (lock / 'pid').write_text(str(os.getpid()) + '\n')
        code, info = self.core('set', 'percent=50')
        self.assertEqual((code, info['ok']), (1, False)); self.assertIn('in progress', info['error']); self.assertTrue(lock.exists(), 'the other holder keeps its lock')
        (lock / 'pid').write_text('999999\n')
        code, info = self.core('set', 'percent=50')
        self.assertEqual(code, 0); self.assertFalse(lock.exists(), 'the lock is released when the helper ends')
        self.assertEqual(self.core('set', 'percent=9999')[0], 1); self.assertFalse(lock.exists(), 'also after a failure')

    def test_front_end_reads_and_sets(self):
        r = subprocess.run(['sh', str(FRONT), 'get'], capture_output=True, text=True, env=self.env(), timeout=30)
        self.assertEqual(json.loads(r.stdout)['type'], 'zram')
        r = subprocess.run(['sh', str(FRONT), 'set', 'percent=25'], capture_output=True, text=True, env=self.env(), timeout=30)
        self.assertEqual((r.returncode, json.loads(r.stdout)['sizeMiB']), (0, 2048))
        r = subprocess.run(['sh', str(FRONT), 'set', 'percent=999'], capture_output=True, text=True, env=self.env(), timeout=30)
        self.assertEqual(r.returncode, 1); self.assertFalse(json.loads(r.stdout)['ok'])
        r = subprocess.run(['sh', str(FRONT), 'format'], capture_output=True, text=True, env=self.env(), timeout=30)
        self.assertEqual(r.returncode, 1)

    @unittest.skipIf(hasattr(os, 'geteuid') and os.geteuid() == 0, 'running as root')
    def test_changes_need_root(self):
        code, info = self.core('set', 'percent=50', DEVOS_SWAP_ALLOW_USER='')
        self.assertEqual((code, info['ok']), (1, False)); self.assertIn('administrator', info['error'])
        self.assertEqual(self.core('get', DEVOS_SWAP_ALLOW_USER='')[0], 0)

    def test_session_files_and_policy_are_wired(self):
        files = ROOT / 'distro/oe/meta-devos/recipes-devos/session/files'
        service = (files / 'devos-zram.service').read_text()
        self.assertIn('ExecStart=/usr/libexec/devos-swap apply', service); self.assertIn('ConditionPathExists=/usr/libexec/devos-swap', service)
        policy = (ROOT / 'data/polkit-1/actions/org.devos.swap.policy').read_text()
        self.assertIn('org.devos.swap', policy); self.assertIn('/usr/libexec/devos-swap', policy)
        sysctl = (files / '90-devos-memory.conf').read_text()
        for line in ('vm.swappiness = 100', 'vm.page-cluster = 0', 'vm.vfs_cache_pressure = 50', 'vm.watermark_boost_factor = 0'): self.assertIn(line, sysctl)


if __name__ == '__main__':
    unittest.main()
