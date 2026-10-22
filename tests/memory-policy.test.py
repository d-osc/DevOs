import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import unittest
from types import SimpleNamespace
from bridge_support import BridgeFixture, literal
from devlang_support import ROOT, D
GIB = 1024 ** 3
memory = SimpleNamespace(CGROUP=Path('/sys/fs/cgroup'), MIB=1048576, UNIT=re.compile(r'devos-app-[a-f0-9]{24}-[a-f0-9]{32}\.service'))

class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.bridge=BridgeFixture('bin/dev-os-memory'); self.addCleanup(self.bridge.close)

    def test_five_protected_six_standby_seven_cold(self):
        self.assertEqual([self.bridge.value(f'bridge.planLow({rank}, {8*GIB})') for rank in range(1,9)], [512*memory.MIB]*5+[256*memory.MIB,0,0])
        self.assertFalse(self.bridge.value(f'bridge.planReclaim(6,{8*GIB},{GIB},{GIB})'))
        self.assertTrue(self.bridge.value(f'bridge.planReclaim(7,{8*GIB},{GIB},{GIB})'))

    def test_no_forced_swap_with_free_ram_or_no_swap(self):
        for rank, available, swap in [(7,4*GIB,GIB),(7,GIB,0),(0,GIB,GIB)]:
            self.assertFalse(self.bridge.value(f'bridge.planReclaim({rank},{8*GIB},{available},{swap})'))

    def test_standby_warm_only_with_headroom(self):
        for rank, available, expected in [(6,4*GIB,True),(6,GIB,False),(7,4*GIB,False)]:
            self.assertEqual(self.bridge.value(f'bridge.planWarm({rank},{8*GIB},{available})'),expected)

    def test_existing_zram_never_reformatted(self):
        file=self.bridge.root/'swaps'; file.write_text('Filename Type Size Used Priority\n/dev/zram0 partition 100 0 100\n')
        self.bridge.replace_text('/proc/swaps',str(file))
        self.bridge.replace('capture','fn capture(command: str): str { return "" }')
        self.assertEqual(self.bridge.value('bridge.setupSwap()'),0)

    def test_systemd_entries_include_devlang_argument_separator(self):
        import shlex
        for name, argument in [('devos-zram','--setup-swap'),('devos-memory','--daemon')]:
            file=ROOT/'distro/oe/meta-devos/recipes-devos/session/files'/f'{name}.service'
            command=next(line.split('=',1)[1] for line in file.read_text().splitlines() if line.startswith('ExecStart='))
            self.assertEqual(shlex.split(command),['/usr/bin/d','/usr/bin/dev-os-memory','--',argument])
        file=self.bridge.root/'swaps'; file.write_text('Filename Type Size Used Priority\n/dev/zram0 partition 100 0 100\n')
        self.bridge.replace_text('/proc/swaps',str(file))
        result=self.bridge.cli({},args=('--setup-swap',))
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('existing zram swap preserved',result.stdout)

    def test_zram_setup_formats_commands_without_touching_host_devices(self):
        swaps=self.bridge.root/'swaps'; swaps.write_text('Filename Type Size Used Priority\n')
        self.bridge.replace_text('/proc/swaps',str(swaps))
        for name in ('swappiness','page-cluster'):
            self.bridge.replace_text('/proc/sys/vm/'+name,str(self.bridge.root/name))
        self.bridge.replace('memoryInfo',f'fn memoryInfo(): json.Value {{ return {{MemTotal: {8*GIB}}} }}')
        log=self.bridge.root/'shell.log'; capture=self.bridge.root/'capture.log'
        self.bridge.replace('capture',f'fn capture(command: str): str {{ fs.writeFileSync({json.dumps(str(capture))},command); return "/dev/zram-fixture" }}')
        file=self.bridge.root/'lib/posix.dev'
        source=file.read_text()
        source=re.sub(r'^fn shell\([^\n]*[\s\S]*?(?=^fn )',lambda _:f'fn shell(command: str): i32 {{ fs.appendFileSync({json.dumps(str(log))},command+"\\n"); return 0 }}\n',source,count=1,flags=re.M)
        file.write_text('use "std/fs"\n'+source)
        self.assertEqual(self.bridge.value('bridge.setupSwap()'),0)
        self.assertEqual(capture.read_text(),'zramctl --find --size 4294967296 --algorithm lz4')
        self.assertEqual(log.read_text().splitlines(),['modprobe zram','mkswap /dev/zram-fixture','swapon --priority 100 /dev/zram-fixture'])
        self.assertEqual((self.bridge.root/'swappiness').read_text(),'80')

    def test_missing_rankings_builds_numeric_uid_path(self):
        self.assertEqual(self.bridge.value('bridge.rankings(123456789)'),{})

    def test_rankings_use_epoch_time_and_validate_owner(self):
        file=self.bridge.root/'rankings.json'; file.write_text('["Example.desktop", "Other.desktop"]')
        self.bridge.replace_text('"/run/user/${uid}/devos-memory-policy.json"',json.dumps(str(file)))
        ranks=self.bridge.value(f'bridge.rankings({os.getuid()})')
        self.assertEqual(ranks[hashlib.sha256(b'example.desktop').hexdigest()[:24]],1)
        os.utime(file,(1,1)); self.assertEqual(self.bridge.value(f'bridge.rankings({os.getuid()})'),{})

    def test_warming_uses_bounded_owned_processes(self):
        group=self.bridge.root/'group'; group.mkdir(); (group/'cgroup.procs').write_text(str(os.getpid())+'\n')
        advised=self.bridge.value(f'bridge.warm({json.dumps(str(group))}, {os.getuid()}, 8192)')
        self.assertGreaterEqual(advised,0); self.assertLessEqual(advised,8192)

    def test_bounded_cold_reclaim_and_rank_transition(self):
        base=self.bridge.root/'cgroup'; parent=base/f'user.slice/user-{os.getuid()}.slice/user@{os.getuid()}.service/app.slice'; parent.mkdir(parents=True)
        ranks={}; groups={}
        for rank in range(1,10):
            key=hashlib.sha256(str(rank).encode()).hexdigest()[:24]
            group=parent/f'devos-app-{key}-{"a"*32}.service'; group.mkdir()
            (group/'memory.low').write_text('0'); (group/'memory.reclaim').write_text('')
            groups[rank]=group; ranks[key]=rank
        self.bridge.replace_text('/sys/fs/cgroup/user.slice',str(base/'user.slice'))
        self.bridge.replace('rankings',f'fn rankings(uid: i64): json.Value {{ return {literal(ranks)} }}')
        def info(available):
            self.bridge.replace('memoryInfo',f'fn memoryInfo(): json.Value {{ return {literal({"MemTotal":8*GIB,"MemAvailable":available,"SwapFree":GIB})} }}')
        info(GIB)
        log=self.bridge.root/'warm.log'
        self.bridge.replace('warm',f'fn warm(group: str, uid: i64, budget: i64): i64 {{ fs.appendFileSync({json.dumps(str(log))}, group+"\\n"); return budget }}')
        self.bridge.value('bridge.cycle({})')
        self.assertTrue((groups[9]/'memory.reclaim').read_text()); self.assertTrue((groups[8]/'memory.reclaim').read_text())
        self.assertFalse((groups[7]/'memory.reclaim').read_text()); self.assertFalse((groups[5]/'memory.reclaim').read_text()); self.assertFalse(log.exists())
        info(4*GIB)
        self.bridge.invoke('let warmed=bridge.cycle({}); return bridge.cycle(warmed)')
        self.assertEqual(log.read_text().splitlines(),[str(groups[6])])

    @unittest.skipUnless(os.getenv('DEVOS_MEMORY_INTEGRATION') == '1', 'Opt-in real user cgroup test')
    def test_system_scope_disables_swap_and_preserves_session_bus(self):
        with tempfile.TemporaryDirectory(prefix='devos-system-memory-test-') as tmp:
            base = Path(tmp)
            output, stop = base / 'result.json', base / 'stop'
            script = base / "system's.py"
            script.write_text(f'import json,os,time\nfrom pathlib import Path\nPath({str(output)!r}).write_text(json.dumps(dict(cgroup=Path("/proc/self/cgroup").read_text(),bus=os.environ.get("DBUS_SESSION_BUS_ADDRESS"))))\nwhile not Path({str(stop)!r}).exists(): time.sleep(.05)\n')
            env = dict(os.environ, DBUS_SESSION_BUS_ADDRESS='unix:path=/tmp/devos-test-session-bus')
            process = subprocess.Popen([D, str(ROOT / 'bin/dev-os-system-run'), '--', 'python3', str(script)], env=env)
            try:
                for _ in range(100):
                    if output.exists():
                        break
                    time.sleep(.05)
                data = json.loads(output.read_text())
                self.assertEqual(data['bus'], env['DBUS_SESSION_BUS_ADDRESS'])
                self.assertIn('/devos-system-', data['cgroup'])
                group = memory.CGROUP / data['cgroup'].strip().split('::', 1)[1].lstrip('/')
                self.assertEqual((group / 'memory.swap.max').read_text().strip(), '0')
                self.assertEqual((group / 'memory.low').read_text().strip(), str(256 * memory.MIB))
            finally:
                stop.touch()
                process.wait(timeout=10)
            self.assertEqual(process.returncode, 0)

    @unittest.skipUnless(os.getenv('DEVOS_MEMORY_INTEGRATION') == '1', 'Opt-in real user cgroup test')
    def test_real_desktop_launch_keeps_children_in_app_cgroup(self):
        with tempfile.TemporaryDirectory(prefix='devos-memory-test-') as tmp:
            base = Path(tmp)
            output = base / 'result.json'
            script = base / 'app.py'
            script.write_text(f'import json,os,time\nfrom pathlib import Path\nPath({str(output)!r}).write_text(json.dumps(dict(pid=os.getpid(),cgroup=Path("/proc/self/cgroup").read_text())))\ntime.sleep(30)\n')
            desktop = base / 'test.desktop'
            desktop.write_text(f'[Desktop Entry]\nType=Application\nName=DevOs Memory Test\nExec=/usr/bin/python3 {script}\n')
            subprocess.run([D, str(ROOT / 'bin/dev-os-app-launch'), '--', 'devos-memory-test.desktop', str(desktop)], check=True, timeout=20)
            for _ in range(50):
                if output.exists():
                    break
                time.sleep(.1)
            data = json.loads(output.read_text())
            unit = data['cgroup'].strip().split('/')[-1]
            try:
                key = hashlib.sha256(b'devos-memory-test.desktop').hexdigest()[:24]
                self.assertTrue(unit.startswith(f'devos-app-{key}-'), data)
                self.assertTrue(memory.UNIT.fullmatch(unit))
                self.assertTrue(Path(f'/proc/{data["pid"]}').exists())
                expected_parent = f'/user.slice/user-{os.getuid()}.slice/user@{os.getuid()}.service/app.slice/'
                self.assertIn(expected_parent, data['cgroup'])
                env = dict(os.environ, DBUS_SESSION_BUS_ADDRESS=f'unix:path=/run/user/{os.getuid()}/bus')
                subprocess.run(['systemctl', '--user', 'set-property', unit, 'MemoryLow=16M'], env=env, check=True, timeout=10)
                group_path = memory.CGROUP / data['cgroup'].strip().split('::', 1)[1].lstrip('/')
                self.assertEqual((group_path / 'memory.low').read_text().strip(), str(16 * memory.MIB))
            finally:
                env = dict(os.environ, DBUS_SESSION_BUS_ADDRESS=f'unix:path=/run/user/{os.getuid()}/bus')
                subprocess.run(['systemctl', '--user', 'stop', unit], env=env, check=True, timeout=10)


if __name__ == '__main__':
    unittest.main()
