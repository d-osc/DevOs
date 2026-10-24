"""The OE desktop image ships developer toolchains next to git."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
IMAGE = ROOT / 'distro/oe/meta-devos/recipes-core/images/devos-image.bb'
PREPARE = ROOT / 'distro/oe/prepare.dev'


def image_install():
    text = IMAGE.read_text().replace('\\\n', ' ')
    match = re.search(r'^IMAGE_INSTALL\s*=\s*"([^"]*)"', text, re.M)
    return set(match.group(1).split())


class ImageToolchainTests(unittest.TestCase):
    def test_image_installs_git_and_toolchains(self):
        packages = image_install()
        for name in ('git', 'python3', 'python3-pip', 'python3-venv', 'python3-ensurepip',
                     'nodejs', 'nodejs-npm', 'rust', 'cargo'):
            self.assertIn(name, packages)

    def test_layers_providing_nodejs_are_enabled(self):
        prepare = PREPARE.read_text()
        self.assertIn('/openembedded-core/meta ', prepare)
        self.assertIn('/meta-openembedded/meta-oe ', prepare)
        self.assertIn('meta-openembedded', (ROOT / 'distro/oe/sources.lock').read_text())

    def test_console_base_is_unchanged(self):
        for path in (ROOT / 'distro/base').rglob('*'):
            if path.is_file() and path.suffix in {'.dev', '.sh', '.md', ''}:
                text = path.read_text(errors='ignore')
                self.assertNotIn('rustc', text)
                self.assertNotIn('nodejs', text)


if __name__ == '__main__':
    unittest.main()
