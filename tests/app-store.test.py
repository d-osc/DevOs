import json
import unittest
from native_support import NativeFixture

MODULE = 'devos_app_store'
DATA = {'schemaVersion': 1, 'source': {'name': 'DevOs', 'url': 'https://repo.example/devos'}, 'apps': [{'id': 'org.devos.Example', 'name': 'Example', 'package': 'devos-example'}]}

class StoreTests(unittest.TestCase):
    def setUp(self):
        self.fixture = NativeFixture().__enter__()
        self.addCleanup(self.fixture.__exit__)

    def call(self, code):
        return self.fixture.invoke(code)

    def configure(self, data=DATA):
        self.fixture.replace('privileged', 'root', 'fn root(): bool { return true }')
        self.fixture.stub(MODULE, 'catalog', '(): json.Value', data)
        self.fixture.replace(MODULE, 'connected', 'fn connected(data: json.Value): bool { return true }')
        self.fixture.stub(MODULE, 'state', '(): json.Value', {})

    def test_unconfigured_store_has_no_fake_apps(self):
        self.fixture.replace(MODULE, 'catalogPath', f'fn catalogPath(): str {{ return {json.dumps(str(self.fixture.root / "missing"))} }}')
        self.assertEqual(self.call('return store.catalog()')['value']['apps'], [])
        self.assertFalse(self.call('return box(store.connected(store.catalog()))')['value'])

    def test_native_guard_rejects_wsl_before_execution(self):
        self.fixture.replace(MODULE, 'native', 'fn native(): bool { return false }')
        self.assertIn('DevOs image', self.call('return json.parse(json.stringify(store.run(Vec<str>("install", "devos-example"))))')['error'])

    def test_root_required(self):
        self.fixture.replace('privileged', 'root', 'fn root(): bool { return false }')
        self.assertIn('Administrator', self.call('return store.administer({action: "install"})')['error'])

    def test_catalog_allowlist_and_update_order(self):
        self.configure()
        commands = self.fixture.log_commands(MODULE)
        self.assertIn('trusted', self.call('return store.administer({action: "install", id: "--all"})')['error'])
        self.assertFalse(commands.exists())
        self.assertEqual(self.call('return store.administer({action: "install", id: "org.devos.Example"})'), {'value': {}})
        self.assertEqual([json.loads(line) for line in commands.read_text().splitlines()], [['update'], ['install', 'devos-example']])

    def test_core_and_nonremovable_protection(self):
        for package, removable, message in [('devos-shell', True, 'Core'), ('kernel-image', True, 'Core'), ('devos-example', False, 'cannot be removed')]:
            self.configure({**DATA, 'apps': [{'id': 'core', 'name': 'Core', 'package': package, 'removable': removable}]})
            commands = self.fixture.log_commands(MODULE)
            self.assertIn(message, self.call('return store.administer({action: "remove", id: "core"})')['error'])
            self.assertFalse(commands.exists())

    def test_signed_https_source_required(self):
        conf = self.fixture.root / 'feed.conf'
        conf.write_text('option check_signature 1\nsrc/gz devos-app-store https://repo.example/devos\n')
        self.fixture.replace(MODULE, 'confPath', f'fn confPath(): str {{ return {json.dumps(str(conf))} }}')
        self.fixture.replace('privileged', 'trusted', 'fn trusted(file: str): str { return fs.readFileSync(file, "utf8") }')
        expression = f'return box(store.connected(json.parse({json.dumps(json.dumps(DATA))})))'
        self.assertTrue(self.call(expression)['value'])
        for value in ['option check_signature 0\nsrc/gz devos-app-store https://repo.example/devos\n', 'option check_signature 1\noption check_signature 0\nsrc/gz devos-app-store https://repo.example/devos\n', 'option check_signature 1\nsrc/gz devos-app-store https://attacker.example\n']:
            conf.write_text(value)
            self.assertIn('signature', self.call(expression)['error'])
        for address in ['http://repo.example', 'https:///missing', 'https://u:p@repo.example', 'https://repo.example?q=1', 'https://repo.example/#x', 'https://repo.example/\n']:
            data = {**DATA, 'source': {'url': address}}
            self.assertIn('error', self.call(f'return box(store.connected(json.parse({json.dumps(json.dumps(data))})))'))

    def test_native_versions_and_package_names(self):
        self.assertEqual(self.call('return store.packageRows("devos-example - 1.2-r0 - description\\n--all - 1\\n")')['value'], {'devos-example': '1.2-r0'})

    def test_catalog_rejects_duplicate_ids_and_unsafe_packages(self):
        file = self.fixture.root / 'catalog.json'
        self.fixture.replace(MODULE, 'catalogPath', f'fn catalogPath(): str {{ return {json.dumps(str(file))} }}')
        self.fixture.replace('privileged', 'trusted', 'fn trusted(file: str): str { return fs.readFileSync(file, "utf8") }')
        for apps in [DATA['apps'] * 2, [{'id': 'bad', 'name': 'Bad', 'package': '--force'}]]:
            file.write_text(json.dumps({**DATA, 'apps': apps}))
            self.assertIn('Invalid', self.call('return store.catalog()')['error'])

if __name__ == '__main__':
    unittest.main()
