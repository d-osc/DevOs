"""The image ships a suspend-only, deepest-state sleep policy and installs it."""
import configparser
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SESSION = ROOT / 'distro/oe/meta-devos/recipes-devos/session'


def read(name):
    parser = configparser.ConfigParser(strict=True, interpolation=None)
    parser.optionxform = str
    parser.read_string((SESSION / 'files' / name).read_text())
    return parser


class SleepPolicyTests(unittest.TestCase):
    def test_sleep_is_suspend_to_ram_with_deep_preferred(self):
        sleep = read('devos-sleep.conf')['Sleep']
        self.assertEqual(sleep['AllowSuspend'], 'yes')
        # Anything that resumes from disk is slower to wake than suspend to RAM.
        for key in ('AllowHibernation', 'AllowSuspendThenHibernate', 'AllowHybridSleep'):
            self.assertEqual(sleep[key], 'no', key)
        self.assertEqual(sleep['SuspendState'], 'mem')
        modes = sleep['MemorySleepMode'].split()
        self.assertEqual(modes[0], 'deep', 'The lowest-power mode is tried first')
        self.assertIn('s2idle', modes, 'Fallback for hardware without deep sleep')

    def test_lid_is_handled_by_shell_and_external_sleep_waits_for_lock(self):
        login = read('devos-logind.conf')['Login']
        self.assertEqual(login['HandleLidSwitch'], 'ignore')
        self.assertEqual(login['HandleLidSwitchExternalPower'], 'ignore')
        self.assertEqual(login['HandleLidSwitchDocked'], 'ignore')
        self.assertEqual(login['HandlePowerKey'], 'suspend')
        self.assertEqual(login['HandlePowerKeyLongPress'], 'poweroff')
        self.assertGreaterEqual(int(login['InhibitDelayMaxSec']), 5)

    def test_recipe_installs_both_drop_ins(self):
        recipe = (SESSION / 'devos-session.bb').read_text()
        for name in ('devos-sleep.conf', 'devos-logind.conf'):
            self.assertIn(f'file://{name}', recipe)
        self.assertIn('sleep.conf.d/10-devos.conf', recipe)
        self.assertIn('logind.conf.d/10-devos-power.conf', recipe)


if __name__ == '__main__':
    unittest.main()
