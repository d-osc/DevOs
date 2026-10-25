import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / 'native/devos-connectivity'
FRONT = ROOT / 'bin/dev-os-connectivity'

TC = '''#!/bin/sh
# Fake tc: remembers which interfaces carry our root qdisc and logs every call.
d="$FAKE_DIR"; echo "$*" >> "$d/tc.log"
case "$1 $2" in
    "qdisc show") [ -f "$d/ours.$4" ] && echo "qdisc prio 7a10: root refcnt 2 bands 2" || echo "qdisc noqueue 0: root refcnt 2"; exit 0 ;;
    "qdisc add") [ "$5" = root ] && : > "$d/ours.$4"; exit 0 ;;
    "qdisc del") rm -f "$d/ours.$4"; exit 0 ;;
    "filter add") [ -f "$d/fail-filter" ] && exit 2; exit 0 ;;
esac
exit 0
'''
NMCLI = '''#!/bin/sh
# Fake nmcli driven by fixture files; every call is logged. `rescan` starts a new scan generation.
d="$FAKE_DIR"; echo "$*" >> "$d/nm.log"
gen=$(cat "$d/gen" 2>/dev/null || echo 0)
case "$*" in
    "-t -f DEVICE,TYPE,STATE device") cat "$d/devices" ;;
    *"wifi list"*) f="$d/list.$gen"; [ -f "$f" ] || f="$d/list.0"; cat "$f" ;;
    *"wifi rescan"*) echo $((gen + 1)) > "$d/gen"; [ -f "$d/rescan-bytes" ] && echo $(( $(cat "$d/sys/class/net/wlan0/statistics/rx_bytes") + $(cat "$d/rescan-bytes") )) > "$d/sys/class/net/wlan0/statistics/rx_bytes" ;;
    *"wifi connect"*) [ -f "$d/connect-fails" ] && exit 4 ;;
esac
exit 0
'''
HOME = 'Home'
A1, A2, A3 = 'AA\\:BB\\:CC\\:DD\\:EE\\:01', 'AA\\:BB\\:CC\\:DD\\:EE\\:02', 'AA\\:BB\\:CC\\:DD\\:EE\\:03'


class ConnectivityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.d = Path(self.temp.name)
        for name, body in (('tc', TC), ('nmcli', NMCLI)):
            (self.d / name).write_text(body); (self.d / name).chmod(0o755)
        (self.d / 'systemctl').write_text('#!/bin/sh\necho "$*" >> "$FAKE_DIR/systemctl.log"\n'); (self.d / 'systemctl').chmod(0o755)
        self.state = self.d / 'state/connectivity.conf'
        (self.d / 'time').write_text('1000\n')

    def net(self, name, physical=True, state='up'):
        base = self.d / 'sys/class/net' / name; base.mkdir(parents=True, exist_ok=True)
        (base / 'operstate').write_text(state + '\n')
        if physical: (base / 'device').mkdir(exist_ok=True)

    def modules(self, *names):
        for n in names: (self.d / 'sys/module' / n).mkdir(parents=True, exist_ok=True)

    def kernel_ok(self): self.modules('sch_prio', 'sch_fq_codel', 'cls_flower')

    def env(self, **extra):
        return os.environ | {'FAKE_DIR': str(self.d), 'DEVOS_CONN_ROOT': str(self.d), 'DEVOS_CONN_STATE': str(self.state), 'DEVOS_CONN_RUN': str(self.d / 'run'),
            'DEVOS_CONN_ALLOW_USER': '1', 'DEVOS_CONN_TC': str(self.d / 'tc'), 'DEVOS_CONN_NMCLI': str(self.d / 'nmcli'), 'DEVOS_CONN_SYSTEMCTL': str(self.d / 'systemctl'),
            'DEVOS_CONN_KREL': 'test', 'DEVOS_CONN_FAKE_TIME': str(self.d / 'time'), 'DEVOS_CONN_SCAN_WAIT': '0', 'DEVOS_CONNECTIVITY_CORE': str(CORE)} | extra

    def core(self, *args, **extra):
        r = subprocess.run(['sh', str(CORE), *args], capture_output=True, text=True, env=self.env(**extra), timeout=30)
        return r.returncode, json.loads(r.stdout)

    def log(self, name): p = self.d / name; return p.read_text().splitlines() if p.exists() else []

    def wifi(self, *lines, devices='wlan0:wifi:connected\n', gens=1):
        (self.d / 'devices').write_text(devices)
        for gen in range(gens): (self.d / f'list.{gen}').write_text('\n'.join(lines) + '\n')
        self.net('wlan0'); stats = self.d / 'sys/class/net/wlan0/statistics'; stats.mkdir(parents=True, exist_ok=True)
        (stats / 'rx_bytes').write_text('0\n'); (stats / 'tx_bytes').write_text('0\n')

    def ap(self, ssid, bssid, signal, active=False): return f'{"yes" if active else "no"}:{ssid}:{bssid}:{signal}'

    def daemon(self, ticks, **extra):
        self.core('smartconnect', 'on')
        return subprocess.run(['sh', str(CORE), 'daemon'], capture_output=True, text=True, env=self.env(DEVOS_CONN_TICKS=str(ticks), **extra), timeout=60)

    def connects(self): return [l for l in self.log('nm.log') if 'wifi connect' in l]
    def status(self): return (self.d / 'run/smartconnect.status').read_text()

    # ---- TaskFirst ------------------------------------------------------------------------------------------------
    def test_unsupported_kernel_is_explained_and_nothing_is_changed(self):
        self.net('wlan0'); self.modules('sch_prio')  # fq_codel and flower are missing
        code, info = self.core('get')
        self.assertEqual(code, 0); self.assertFalse(info['taskfirstSupported']); self.assertIn('sch_fq_codel cls_flower', info['taskfirstReason']); self.assertEqual(info['taskfirst'], 'off')
        code, answer = self.core('taskfirst', 'games'); self.assertEqual(code, 1); self.assertIn('not supported', answer['error'])
        self.assertFalse(self.state.exists()); self.assertEqual(self.log('tc.log'), [])

    def test_missing_tc_tool_is_reported(self):
        self.kernel_ok(); code, info = self.core('get', DEVOS_CONN_TC=str(self.d / 'no-such-tc'))
        self.assertFalse(info['taskfirstSupported']); self.assertIn('tc tool', info['taskfirstReason'])

    def test_profile_installs_prio_fq_codel_and_flower_filters_on_physical_interfaces_only(self):
        self.kernel_ok(); self.net('wlan0'); self.net('tun0', physical=False); self.net('eth0', state='down'); self.net('lo', physical=False)
        code, info = self.core('taskfirst', 'games')
        self.assertEqual(code, 0); self.assertEqual((info['taskfirst'], info['taskfirstActive'], info['taskfirstInterfaces']), ('games', True, 'wlan0'))
        log = self.log('tc.log'); text = '\n'.join(log)
        self.assertIn('qdisc add dev wlan0 root handle 7a10: prio bands 2', text)
        self.assertEqual(sum('fq_codel' in l for l in log if l.startswith('qdisc add')), 2)
        self.assertIn('flower ip_proto udp dst_port 27015 classid 7a10:1', text); self.assertIn('protocol ipv6', text); self.assertIn('ip_tos 0xb8/0xfc', text)
        for other in ('tun0', 'eth0', 'lo'): self.assertFalse([l for l in log if l.startswith(('qdisc add', 'filter add')) and f'dev {other} ' in l], other)
        self.assertIn('taskfirst=games', self.state.read_text())

    def test_profiles_have_distinct_classes_and_switching_replaces_the_previous_one(self):
        self.kernel_ok(); self.net('wlan0')
        self.core('taskfirst', 'productivity'); first = '\n'.join(self.log('tc.log'))
        self.assertIn('ip_proto tcp dst_port 443', first); self.assertNotIn('dst_port 27015', first)
        (self.d / 'tc.log').unlink(); self.core('taskfirst', 'streaming'); second = '\n'.join(self.log('tc.log'))
        self.assertIn('qdisc del dev wlan0 root', second); self.assertIn('ip_proto udp dst_port 443', second); self.assertIn('ip_tos 0x88/0xfc', second)

    def test_off_removes_only_our_qdisc_and_apply_restores_the_saved_profile(self):
        self.kernel_ok(); self.net('wlan0')
        self.core('taskfirst', 'streaming'); self.assertTrue((self.d / 'ours.wlan0').exists())
        code, info = self.core('taskfirst', 'off'); self.assertEqual((info['taskfirst'], info['taskfirstActive']), ('off', False)); self.assertFalse((self.d / 'ours.wlan0').exists())
        self.core('taskfirst', 'games'); (self.d / 'ours.wlan0').unlink()  # the interface was recreated after a network change
        self.assertEqual(self.core('apply')[1], {'ok': True, 'applied': True}); self.assertTrue((self.d / 'ours.wlan0').exists())
        self.core('taskfirst', 'off'); (self.d / 'tc.log').unlink(); self.assertEqual(self.core('apply')[1], {'ok': True, 'applied': False})
        self.assertFalse([l for l in self.log('tc.log') if l.startswith(('qdisc add', 'filter add'))])

    def test_rejected_filters_roll_back_to_the_previous_setting(self):
        self.kernel_ok(); self.net('wlan0'); self.core('taskfirst', 'productivity')
        (self.d / 'fail-filter').write_text('x')
        code, answer = self.core('taskfirst', 'games'); self.assertEqual(code, 1); self.assertIn('previous setting was kept', answer['error'])
        self.assertIn('taskfirst=productivity', self.state.read_text()); self.assertFalse((self.d / 'ours.wlan0').exists())

    def test_invalid_values_and_missing_privileges_are_rejected(self):
        self.kernel_ok(); self.net('wlan0')
        for args in (('taskfirst', 'screen-extend'), ('taskfirst', ''), ('smartconnect', 'maybe'), ('bogus',)):
            code, answer = self.core(*args); self.assertEqual(code, 1); self.assertFalse(answer['ok'])
        if os.geteuid() != 0:
            code, answer = self.core('taskfirst', 'games', DEVOS_CONN_ALLOW_USER=''); self.assertEqual(code, 1); self.assertIn('administrator', answer['error'])
        self.assertFalse(self.state.exists())

    # ---- SmartConnect ---------------------------------------------------------------------------------------------
    def test_smartconnect_needs_a_wifi_adapter(self):
        self.wifi(devices='eth0:ethernet:connected\n')
        code, info = self.core('get'); self.assertFalse(info['smartconnectSupported']); self.assertIn('No Wi-Fi adapter', info['smartconnectReason'])
        code, answer = self.core('smartconnect', 'on'); self.assertEqual(code, 1); self.assertFalse(self.state.exists())

    def test_smartconnect_switch_saves_state_and_starts_the_service(self):
        self.wifi(self.ap(HOME, A1, 70, True))
        code, info = self.core('smartconnect', 'on'); self.assertEqual((info['smartconnect'], info['smartconnectSupported']), (True, True))
        self.assertIn('start devos-smartconnect.service', self.log('systemctl.log')); self.assertIn('smartconnect=1', self.state.read_text())
        self.assertFalse(self.core('smartconnect', 'off')[1]['smartconnect']); self.assertIn('stop devos-smartconnect.service', self.log('systemctl.log'))

    def test_daemon_does_nothing_while_disabled(self):
        self.wifi(self.ap(HOME, A1, 20, True), self.ap(HOME, A2, 90))
        r = subprocess.run(['sh', str(CORE), 'daemon'], capture_output=True, text=True, env=self.env(DEVOS_CONN_TICKS='3'), timeout=20)
        self.assertEqual(json.loads(r.stdout), {'ok': True, 'running': False}); self.assertEqual(self.log('nm.log'), [])

    def test_good_signal_is_never_scanned_or_left(self):
        self.wifi(self.ap(HOME, A1, 75, True), self.ap(HOME, A2, 99))
        self.daemon(6)
        self.assertFalse([l for l in self.log('nm.log') if 'wifi rescan' in l]); self.assertEqual(self.connects(), [])
        self.assertIn('good', self.status())

    def test_switches_only_after_a_clearly_better_access_point_won_several_scans(self):
        self.wifi(self.ap(HOME, A1, 40, True), self.ap(HOME, A2, 75), self.ap('Other', A3, 99), gens=12)
        self.daemon(2); self.assertEqual(self.connects(), [])  # seen twice of three
        self.assertIn('2 of 3', self.status())
        self.daemon(3, DEVOS_CONN_SCAN_EVERY='0')
        self.assertEqual(self.connects(), ['device wifi connect Home bssid AA:BB:CC:DD:EE:02 ifname wlan0'])
        self.assertIn('Switched', self.status())

    def test_small_improvements_other_networks_and_flapping_do_not_switch(self):
        self.wifi(self.ap(HOME, A1, 40, True), self.ap(HOME, A2, 55), self.ap('Other', A3, 99), gens=8)  # +15 percent is below the margin
        self.daemon(8, DEVOS_CONN_SCAN_EVERY='0'); self.assertEqual(self.connects(), [])
        # The better access point changes every scan, so it never wins several times in a row.
        for gen, bssid in enumerate([A2, A3] * 4):
            (self.d / f'list.{gen}').write_text(f'{self.ap(HOME, A1, 40, True)}\n{self.ap(HOME, bssid, 80)}\n')
        (self.d / 'gen').write_text('0\n'); self.daemon(8, DEVOS_CONN_SCAN_EVERY='0'); self.assertEqual(self.connects(), [])

    def test_a_busy_connection_holds_the_switch_back(self):
        self.wifi(self.ap(HOME, A1, 40, True), self.ap(HOME, A2, 80), gens=12)
        (self.d / 'rescan-bytes').write_text('9000000000\n')  # every scan sees a huge traffic burst: a call or download
        self.daemon(6, DEVOS_CONN_SCAN_EVERY='0'); self.assertEqual(self.connects(), []); self.assertIn('busy', self.status())

    def test_one_switch_per_minimum_interval_and_a_failed_switch_is_not_retried_at_once(self):
        self.wifi(self.ap(HOME, A1, 40, True), self.ap(HOME, A2, 80), gens=40)
        self.daemon(12, DEVOS_CONN_SCAN_EVERY='0'); self.assertEqual(len(self.connects()), 1)  # 12 ticks of 20 s: one switch inside the 300 s minimum
        (self.d / 'nm.log').unlink(); (self.d / 'gen').write_text('0\n'); (self.d / 'connect-fails').write_text('x'); (self.d / 'time').write_text('99000\n')
        self.daemon(10, DEVOS_CONN_SCAN_EVERY='0'); self.assertEqual(len(self.connects()), 1); self.assertIn('waiting', self.status())

    def test_not_connected_does_not_scan(self):
        self.wifi(self.ap(HOME, A1, 40), self.ap(HOME, A2, 80), devices='wlan0:wifi:disconnected\n')
        self.daemon(4); self.assertEqual(self.connects(), []); self.assertFalse([l for l in self.log('nm.log') if 'wifi rescan' in l])

    # ---- front end ------------------------------------------------------------------------------------------------
    def test_front_end_returns_the_new_state(self):
        self.kernel_ok(); self.wifi(self.ap(HOME, A1, 70, True))
        run = lambda *a: subprocess.run(['sh', str(FRONT), *a], capture_output=True, text=True, env=self.env(), timeout=30)
        r = run('taskfirst', 'productivity'); self.assertEqual(r.returncode, 0); self.assertEqual(json.loads(r.stdout)['taskfirst'], 'productivity')
        r = run('smartconnect', 'on'); self.assertTrue(json.loads(r.stdout)['smartconnect'])
        r = run('taskfirst', 'bogus'); self.assertEqual(r.returncode, 1); self.assertFalse(json.loads(r.stdout)['ok'])
        r = run('nope'); self.assertEqual(r.returncode, 1)


if __name__ == '__main__':
    unittest.main()
