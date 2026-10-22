import json
import unittest
from native_support import NativeFixture

MODULE = 'devos_accounts_system'
ACCOUNT = {'uid': 1001, 'username': 'alice', 'home': '/home/alice'}
DATA = {'bindings': {'alice': {'uid': 1001, 'id': 123, 'login': 'old-name'}}, 'provisioned': True}

class OSAccountsTest(unittest.TestCase):
    def setUp(self):
        self.fixture = NativeFixture().__enter__()
        self.addCleanup(self.fixture.__exit__)
        self.fixture.replace('privileged', 'root', 'fn root(): bool { return true }')
        self.fixture.stub(MODULE, 'human', '(username: str): json.Value', ACCOUNT)
        self.fixture.stub(MODULE, 'registry', '(): json.Value', DATA)
        self.fixture.stub(MODULE, 'githubUser', '(token: json.Value): json.Value', {'id': 123, 'login': 'renamed'})

    def call(self, code):
        return self.fixture.invoke(code)

    def test_pam_requires_verified_identity_and_matching_uid(self):
        self.assertTrue(self.call('return box(accounts.authenticate("alice", "DEVOS_GITHUB:token"))')['value'])
        for credential in ('local-password', 'DEVOS_GUEST'):
            self.assertFalse(self.call(f'return box(accounts.authenticate("alice", {json.dumps(credential)}))')['value'])
        self.fixture.stub(MODULE, 'registry', '(): json.Value', {**DATA, 'bindings': {'alice': {'uid': 1002, 'id': 123}}})
        self.assertFalse(self.call('return box(accounts.authenticate("alice", "DEVOS_GITHUB:token"))')['value'])

    def test_wrong_github_and_nonroot_rejected(self):
        self.fixture.stub(MODULE, 'githubUser', '(token: json.Value): json.Value', {'id': 999, 'login': 'attacker'})
        self.assertFalse(self.call('return box(accounts.authenticate("alice", "DEVOS_GITHUB:token"))')['value'])
        self.fixture.replace('privileged', 'root', 'fn root(): bool { return false }')
        self.assertFalse(self.call('return box(accounts.authenticate("alice", "DEVOS_GITHUB:token"))')['value'])
        self.assertIn('Administrator', self.call('return accounts.administer({}, false)')['error'])

    def test_reserved_users_rejected_by_real_human_lookup(self):
        for username in ('root', 'devos', 'nobody', 'devos-greeter'):
            self.assertIn('personal', self.call(f'return identity.human({json.dumps(username)})')['error'])

    def test_duplicate_link_cannot_take_over_another_user(self):
        data = json.dumps(json.dumps(DATA))
        self.assertIn('another', self.call(f'return accounts.bind(json.parse({data}), "bob", json.parse("\\"token\\"")).value')['error'])
        self.assertEqual(self.call(f'return accounts.bind(json.parse({data}), "alice", json.parse("\\"token\\"")).value')['value']['id'], 123)

    def test_creation_validates_before_mutation(self):
        commands = self.fixture.log_commands(MODULE)
        for username, password in [('root', 'long-password'), ('a;touch /tmp/test', 'long-password'), ('alice', '123'), ('alice', 'line\nbreak'), ('alice', 'nul\0word')]:
            request = json.dumps(json.dumps({'username': username, 'password': password}))
            self.assertIn('error', self.call(f'return accounts.create({{bindings: {{}}}}, json.parse({request}), false).value'))
        self.assertFalse(commands.exists())

    def test_create_private_home_without_admin_or_argv_password(self):
        commands = self.fixture.log_commands(MODULE)
        self.fixture.replace(MODULE, 'existsUser', 'fn existsUser(username: str): bool { return false }')
        self.fixture.replace('privileged', 'mode', 'fn mode(file: str, value: u32) { require(value == 448, "Expected private 0700 home.") }')
        value = self.call('return accounts.create({bindings: {}}, {username: "devos-fixture-person", name: "Alice", password: "long-password"}, false).value')
        self.assertEqual(value['value']['username'], 'devos-fixture-person')
        rows = [json.loads(line) for line in commands.read_text().splitlines()]
        self.assertNotIn('--groups', rows[0]['argv'])
        self.assertEqual(rows[0]['argv'][-2:], ['--', 'devos-fixture-person'])
        self.assertNotIn('long-password', str([row['argv'] for row in rows]))
        self.assertEqual(rows[1]['input'], 'devos-fixture-person:long-password\n')

    def test_github_creation_derives_username_and_binding(self):
        self.fixture.stub(MODULE, 'githubUser', '(token: json.Value): json.Value', {'id': 987, 'login': 'devos-fixture-github'})
        self.fixture.replace(MODULE, 'existsUser', 'fn existsUser(username: str): bool { return false }')
        self.fixture.replace('privileged', 'mode', 'fn mode(file: str, value: u32) {}')
        commands = self.fixture.log_commands(MODULE)
        result = self.call('return accounts.create({bindings: {}}, {provider: "github", username: "root", token: "secret-token", password: "long-password"}, true).data')['value']
        self.assertEqual(result['bindings']['devos-fixture-github'], {'id': 987, 'login': 'devos-fixture-github', 'uid': 1001})
        self.assertNotIn('secret-token', str(result))
        self.assertIn('--groups', json.loads(commands.read_text().splitlines()[0])['argv'])

    def test_failed_password_assignment_locks_account(self):
        self.fixture.replace(MODULE, 'existsUser', 'fn existsUser(username: str): bool { return false }')
        file = self.fixture.root / 'locked'
        self.fixture.replace(MODULE, 'run', f'fn run(argv: Vec<str>, input: str) {{ if strings.equal(argv[0], "/usr/sbin/chpasswd") {{ result.raise("fixture failure") }}; if strings.equal(argv[0], "/usr/sbin/usermod") {{ fs.writeFileSync({json.dumps(str(file))}, "locked") }} }}')
        self.assertIn('fixture failure', self.call('return accounts.create({bindings: {}}, {username: "devos-fixture-person", password: "long-password"}, false).value')['error'])
        self.assertTrue(file.exists())

    def test_github_verification_failure_creates_nothing(self):
        commands = self.fixture.log_commands(MODULE)
        self.fixture.replace(MODULE, 'githubUser', 'fn githubUser(token: json.Value): json.Value { result.raise("Not verified"); return {} }')
        self.assertIn('Not verified', self.call('return accounts.create({bindings: {}}, {provider: "github", password: "local-password"}, false).value')['error'])
        self.assertFalse(commands.exists())
        self.assertEqual(self.call('return json.parse(json.stringify(accounts.githubUsername("123-User")))')['value'], 'gh-123-user')

    def test_first_setup_is_devos_only_and_one_time(self):
        release = self.fixture.root / 'os-release'
        file = self.fixture.root / 'native/devos_accounts_system.dev'
        file.write_text(file.read_text().replace('"/etc/os-release"', json.dumps(str(release))))
        self.fixture.stub(MODULE, 'users', '(): json.Value', [{'username': 'devos'}])
        release.write_text('ID=devos\n')
        self.assertTrue(self.call('return box(accounts.firstSetup({provisioned: false}))')['value'])
        self.assertFalse(self.call('return box(accounts.firstSetup({provisioned: true}))')['value'])
        release.write_text('ID=ubuntu\n')
        self.assertFalse(self.call('return box(accounts.firstSetup({provisioned: false}))')['value'])

if __name__ == '__main__':
    unittest.main()
