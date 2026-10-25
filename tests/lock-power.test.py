"""The lock screen's Sleep/Restart/Shutdown buttons: patch wiring and behavior that must not regress."""
from pathlib import Path
import unittest

SWAYLOCK = Path(__file__).resolve().parents[1] / 'distro/oe/meta-devos/recipes-support/swaylock'

class LockPowerTests(unittest.TestCase):
    def setUp(self):
        self.patch = (SWAYLOCK / 'files/0003-devos-lock-power.patch').read_text()

    def test_recipe_and_bootstrap_apply_patch(self):
        self.assertIn('file://0003-devos-lock-power.patch', (SWAYLOCK / 'swaylock_%.bbappend').read_text())
        bootstrap = (SWAYLOCK.parents[3] / 'tools/setup/bootstrap-lock-clock.sh').read_text() if (SWAYLOCK.parents[3] / 'tools/setup/bootstrap-lock-clock.sh').exists() else (Path(__file__).resolve().parents[1] / 'tools/setup/bootstrap-lock-clock.sh').read_text()
        self.assertIn('0003-devos-lock-power.patch', bootstrap)

    def test_actions_go_through_logind_without_prompting(self):
        for token in ('"suspend", "reboot", "poweroff"', '--no-ask-password', 'devos_power_click'):
            self.assertIn(token, self.patch)

    def test_destructive_actions_need_two_clicks_and_sleep_does_not(self):
        self.assertIn('index == 0 || state->devos_power_armed == index + 1', self.patch)

    def test_cover_click_only_wakes_the_screen(self):
        self.assertIn('if (devos_dismiss_cover(seat->state)) return;', self.patch)

    def test_buttons_are_not_drawn_on_the_black_cover(self):
        self.assertIn('if (!state->devos_cover) devos_power_render(cairo, surface);', self.patch)

if __name__ == '__main__':
    unittest.main()
