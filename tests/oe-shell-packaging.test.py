"""Run the actual OE install function with an isolated payload and destination."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RECIPE = ROOT / 'distro/oe/meta-devos/recipes-devos/shell/devos-shell_0.3.6.bb'


class ShellPackagingTests(unittest.TestCase):
    def test_desktop_helper_path_and_relative_imports_are_installed(self):
        recipe = RECIPE.read_text()
        body = recipe.split('do_install() {\n', 1)[1].split('\n}', 1)[0]
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, build, dest = (root / name for name in ('source', 'build', 'dest'))
            for directory in ('bin', 'lib', 'dist', 'data/polkit-1/actions', 'config', 'extensions', 'native'):
                (source / directory).mkdir(parents=True, exist_ok=True)
            build.mkdir()
            files = {
                'bin/dev-os-system': (ROOT / 'bin/dev-os-system').read_text(),
                'bin/host-only.ps1': 'must not ship',
                'lib/desktop.dev': (ROOT / 'lib/desktop.dev').read_text(),
                'native/service.dev': '# fixture',
                'config/app-store.json': '{}',
                'data/polkit-1/actions/org.devos.accounts.policy': '<policyconfig/>',
                'data/polkit-1/actions/org.devos.appstore.policy': '<policyconfig/>',
                'data/polkit-1/actions/org.devos.radio.policy': '<policyconfig/>',
                'data/polkit-1/actions/org.devos.battery.policy': '<policyconfig/>',
                'data/polkit-1/actions/org.devos.fan.policy': '<policyconfig/>',
                'data/polkit-1/actions/org.devos.connectivity.policy': '<policyconfig/>',
                'data/polkit-1/actions/org.devos.keyboard.policy': '<policyconfig/>',
                'bin/dev-os-network-settings': (ROOT/'bin/dev-os-network-settings').read_text(),
                'lib/network-settings-worker.dev': (ROOT/'lib/network-settings-worker.dev').read_text(),
                'lib/network-settings.dev': (ROOT/'lib/network-settings.dev').read_text(),
                'native/radio-system.dev': (ROOT/'native/radio-system.dev').read_text(),
            }
            for name in ('devos-account-admin', 'devos-pam-auth', 'devos-account-askpass', 'devos-app-store-admin', 'devos-radio-admin', 'devos-battery-care', 'devos-fan-profile', 'devos-keyboard', 'devos-connectivity'):
                files['native/' + name] = '#!/bin/sh\nexit 0\n'
            for name, content in files.items():
                (source / name).write_text(content)
            (build / 'dev-os-window-tracker').write_text('fixture')
            variables = {'D': str(dest), 'S': str(source), 'B': str(build),
                         'bindir': '/usr/bin', 'datadir': '/usr/share', 'prefix': '/usr',
                         'libexecdir': '/usr/libexec', 'localstatedir': '/var', 'sysconfdir': '/etc'}
            for key, value in variables.items():
                body = body.replace('${' + key + '}', value)
            subprocess.run(['sh', '-eu', '-c', body], check=True)
            desktop = dest / 'usr/share/dev-os/bin/dev-os-system'
            self.assertEqual(desktop.read_bytes(), (source / 'bin/dev-os-system').read_bytes())
            self.assertTrue(desktop.stat().st_mode & 0o111)
            self.assertEqual(desktop.read_bytes(), (dest / 'usr/bin/dev-os-system').read_bytes())
            self.assertTrue((desktop.parent / '../lib/desktop.dev').is_file())
            self.assertFalse((desktop.parent / 'host-only.ps1').exists())
            self.assertTrue((dest/'usr/libexec/devos-radio-admin').stat().st_mode & 0o111)
            self.assertTrue((dest/'usr/libexec/devos-battery-care').stat().st_mode & 0o111)
            self.assertTrue((dest/'usr/libexec/devos-fan-profile').stat().st_mode & 0o111)
            self.assertTrue((dest/'usr/libexec/devos-connectivity').stat().st_mode & 0o111)
            self.assertTrue((dest/'usr/share/polkit-1/actions/org.devos.connectivity.policy').exists())
            self.assertTrue((dest/'usr/libexec/devos-keyboard').stat().st_mode & 0o111)
            self.assertTrue((dest/'usr/share/polkit-1/actions/org.devos.keyboard.policy').exists())
            self.assertTrue((dest/'usr/share/polkit-1/actions/org.devos.fan.policy').exists())
            self.assertTrue((dest/'usr/share/polkit-1/actions/org.devos.battery.policy').exists())
            self.assertTrue((dest/'usr/share/dev-os/native/radio-system.dev').exists())
            self.assertTrue((dest/'usr/share/dev-os/bin/dev-os-network-settings').exists())
            self.assertTrue((dest/'usr/share/dev-os/lib/network-settings-worker.dev').exists())


if __name__ == '__main__':
    unittest.main()
