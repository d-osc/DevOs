"""The login screen's Restart/Shutdown/Sleep must work for devos-greeter only, and Live root stays Live-only."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SESSION = ROOT / 'distro/oe/meta-devos/recipes-devos/session'

class GreeterPowerTests(unittest.TestCase):
    def test_rule_is_limited_to_the_greeter_user(self):
        rule = (SESSION / 'files/50-devos-greeter-power.rules').read_text()
        for token in ('subject.user !== "devos-greeter"', 'subject.local', 'reboot|power-off|suspend', '-multiple-sessions', 'polkit.Result.YES'):
            self.assertIn(token, rule)
        self.assertNotIn('ignore-inhibit', rule)
        self.assertNotIn('isInGroup', rule)

    def test_recipe_installs_rule(self):
        recipe = (SESSION / 'devos-session.bb').read_text()
        self.assertIn('file://50-devos-greeter-power.rules', recipe)
        self.assertIn('${UNPACKDIR}/50-devos-greeter-power.rules', recipe)

    def test_live_root_is_gated_and_installed_root_stays_locked(self):
        greeter = (ROOT / 'lib/greeter.dev').read_text()
        self.assertIn('Root sign-in is only available on the Live USB.', greeter)
        init = (ROOT / 'distro/usb/init').read_text()
        self.assertIn('root-session-enabled', init)

    def test_power_actions_are_logged_and_errors_are_shown(self):
        power = (ROOT / 'src/system/org.devos.panel/power.ts').read_text()
        for token in ("'devos-power'", 'strip_remote_error', '[!direct]', 'accepted by logind'):
            self.assertIn(token, power)
        recipe = (SESSION / 'devos-session.bb').read_text()
        for token in ('file://devos-power-log.service', 'system-sleep/devos-power-log', 'devos-power-log.service"'):
            self.assertIn(token, recipe)
        self.assertIn('-t devos-power', (ROOT / 'distro/usb/collector').read_text())
        hook = (SESSION / 'files/devos-power-log').read_text()
        self.assertIn('DEVOS-LOGS', hook)
        self.assertIn('[ -d "$esp" ] || exit 0', hook)

if __name__ == '__main__':
    unittest.main()
