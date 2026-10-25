"""The OE desktop image ships git and gh but no VS Code, Chrome, Rust, Node.js or Python."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
IMAGE = ROOT / 'distro/oe/meta-devos/recipes-core/images/devos-image.bb'


def image_install():
    text = IMAGE.read_text().replace('\\\n', ' ')
    match = re.search(r'^IMAGE_INSTALL\s*=\s*"([^"]*)"', text, re.M)
    return set(match.group(1).split())


class ImageToolchainTests(unittest.TestCase):
    def test_image_installs_git_and_gh_but_no_language_toolchains(self):
        packages = image_install()
        for name in ('git', 'gh', 'devlang'):
            self.assertIn(name, packages)
        for name in ('rust', 'cargo', 'nvm', 'nodejs', 'nodejs-npm', 'python3', 'python3-pip', 'python3-venv',
                     'python3-ensurepip', 'python3-modules', 'python3-pygobject', 'python3-core', 'devos-vscode', 'devos-chrome'):
            self.assertNotIn(name, packages)
        self.assertFalse(any(name.startswith(('qemu', 'rust', 'llvm', 'nodejs')) for name in packages))

    def test_no_python_in_the_image(self):
        self.assertEqual({name for name in image_install() if name.startswith(('python3', 'libpython'))}, set())

    def test_optional_xfs_python_tool_is_split_from_base_package(self):
        recipe = (ROOT / 'distro/oe/meta-devos/recipes-support/nopython/xfsprogs_%.bbappend').read_text()
        self.assertIn('PACKAGES =+ "${PN}-python"', recipe)
        self.assertIn('FILES:${PN}-python = "${sbindir}/xfs_protofile', recipe)
        self.assertIn('RDEPENDS:${PN}-python = "python3-core"', recipe)
        self.assertNotIn('xfsprogs-python', image_install())

    def test_runtime_helpers_are_devlang_not_python(self):
        # bin/dev-os-* ship in the image: none may need an interpreter the image no longer has.
        for path in sorted((ROOT / 'bin').iterdir()):
            if not path.is_file() or path.suffix == '.ps1':
                continue
            head = path.read_bytes()[:80]
            self.assertNotIn(b'python', head, path.name)
        for name in ('microphone', 'speaker', 'keyboard', 'display-care', 'touchpad-gestures'):
            launcher = (ROOT / 'bin' / ('dev-os-' + name)).read_text()
            self.assertTrue(launcher.startswith('#!/bin/sh'), name)
            self.assertIn('exec "$d"', launcher, name)
            self.assertTrue((ROOT / 'lib' / (name + ('-cli' if name in ('keyboard', 'display-care', 'touchpad-gestures') else '') + '.dev')).is_file(), name)

    def test_vendor_apps_and_toolchain_recipes_are_gone(self):
        meta = ROOT / 'distro/oe/meta-devos'
        for relative in ('recipes-apps', 'recipes-devtools'):
            self.assertFalse((meta / relative).exists())
        for relative in ('bin/code', 'bin/dev-os-browser', 'data/applications/google-chrome.desktop',
                         'data/applications/com.microsoft.VSCode.desktop', 'data/applications/code.desktop'):
            self.assertFalse((ROOT / relative).exists(), relative)

    def test_image_installs_sudo_and_curl_with_ca_certificates(self):
        packages = image_install()
        for name in ('sudo', 'curl', 'ca-certificates'):
            self.assertIn(name, packages)

    def test_wheel_group_may_use_sudo(self):
        recipe = (ROOT / 'distro/oe/meta-devos/recipes-devos/session/devos-session.bb').read_text()
        rule = (ROOT / 'distro/oe/meta-devos/recipes-devos/session/files/10-devos-wheel.sudoers').read_text()
        self.assertRegex(rule, r'(?m)^%wheel\s+ALL=\(ALL:ALL\)\s+ALL$')
        self.assertIn('file://10-devos-wheel.sudoers', recipe)
        self.assertIn('install -m0440', recipe)
        self.assertIn('${sysconfdir}/sudoers.d/10-devos-wheel', recipe)

    def test_console_base_is_unchanged(self):
        for path in (ROOT / 'distro/base').rglob('*'):
            if path.is_file() and path.suffix in {'.dev', '.sh', '.md', ''}:
                text = path.read_text(errors='ignore')
                self.assertNotIn('rustc', text)
                self.assertNotIn('nodejs', text)


if __name__ == '__main__':
    unittest.main()
