"""Wi-Fi from Settings must not need root: the image ships a NetworkManager polkit rule."""
from pathlib import Path
import unittest

SESSION = Path(__file__).resolve().parents[1] / 'distro/oe/meta-devos/recipes-devos/session'

class NetworkPolkitTests(unittest.TestCase):
    def test_rule_allows_local_users(self):
        rule = (SESSION / 'files/48-devos-network.rules').read_text()
        self.assertIn('org.freedesktop.NetworkManager.', rule)
        for token in ('subject.local', 'subject.active', 'isInGroup("wheel")', 'isInGroup("netdev")', 'polkit.Result.YES'):
            self.assertIn(token, rule)

    def test_recipe_installs_rule_and_group(self):
        recipe = (SESSION / 'devos-session.bb').read_text()
        self.assertIn('file://48-devos-network.rules', recipe)
        self.assertIn('${UNPACKDIR}/48-devos-network.rules', recipe)
        self.assertIn('--system netdev', recipe)

if __name__ == '__main__':
    unittest.main()
