"""greetd framing/authentication tests against a private Unix socket."""
import json
from pathlib import Path
import socket
import struct
import subprocess
import tempfile
import threading
import unittest
from devlang_support import D, ROOT, run_source, use

class GreeterTests(unittest.TestCase):
    def exchange(self, replies):
        with tempfile.TemporaryDirectory(prefix='devos-greeter-') as directory:
            endpoint = str(Path(directory) / 'greetd.sock')
            server = socket.socket(socket.AF_UNIX)
            server.bind(endpoint)
            server.listen()
            server.settimeout(10)
            messages, errors = [], []
            def receive(connection, size):
                value = b''
                while len(value) < size:
                    block = connection.recv(size - len(value))
                    if not block: raise RuntimeError('Peer disconnected')
                    value += block
                return value
            def serve():
                try:
                    with server.accept()[0] as connection:
                        connection.settimeout(10)
                        for reply in replies:
                            size, = struct.unpack('=I', receive(connection, 4))
                            messages.append(json.loads(receive(connection, size)))
                            payload = json.dumps(reply).encode()
                            for fragment in (struct.pack('=I', len(payload))[:2], struct.pack('=I', len(payload))[2:], payload):
                                connection.sendall(fragment)
                except Exception as error: errors.append(error)
            worker = threading.Thread(target=serve)
            worker.start()
            source = use('greeter') + 'use "std/json"\nuse "std/result"\nlet outcome = result.attempt(fn(): json.Value { return greeter.login("alice", "private-password") })\nif result.isErr(outcome) { print("denied") } else { print(json.stringify(result.unwrap(outcome))) }'
            try: output = run_source(source, env={'GREETD_SOCK': endpoint})
            finally:
                worker.join(12)
                server.close()
            self.assertFalse(errors, errors)
            self.assertFalse(worker.is_alive())
            return output, messages
    def test_fragmented_authenticated_session(self):
        output, messages = self.exchange([{'type': 'auth_message', 'auth_message_type': 'secret'}, {'type': 'success'}, {'type': 'success'}])
        self.assertTrue(json.loads(output)['started'])
        self.assertEqual(messages[0], {'type': 'create_session', 'username': 'alice'})
        self.assertEqual(messages[1]['response'], 'private-password')
        self.assertEqual(messages[2], {'type': 'start_session', 'cmd': ['/usr/bin/devos-desktop'], 'env': ['DEV_OS_LOGIN=0']})
    def test_authentication_failure_never_starts_session(self):
        output, messages = self.exchange([{'type': 'auth_message', 'auth_message_type': 'secret'}, {'type': 'error'}])
        self.assertEqual(output.strip(), 'denied')
        self.assertFalse(any(item['type'] == 'start_session' for item in messages))
    def test_repeated_secret_prompt_requires_interactive_greeter(self):
        output, messages = self.exchange([{'type': 'auth_message', 'auth_message_type': 'secret'}, {'type': 'auth_message', 'auth_message_type': 'secret'}, {'type': 'success'}])
        self.assertEqual(output.strip(), 'denied')
        self.assertEqual(messages[-1], {'type': 'cancel_session'})
    def test_persistent_backend_and_request_limit(self):
        process = subprocess.Popen([D, str(ROOT / 'bin/dev-os-greeter-backend')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            for request in ('{"action":"cancel"}', '{"action":"poll"}', 'x' * 17000, '{"action":"cancel"}'):
                process.stdin.write(request + '\n')
                process.stdin.flush()
                response = json.loads(process.stdout.readline())
                self.assertEqual(response['ok'], 'cancel' in request)
            process.stdin.close()
            process.wait(timeout=10)
            self.assertEqual(process.returncode, 0, process.stderr.read())
        finally:
            if process.poll() is None: process.kill()
            process.stdout.close()
            process.stderr.close()
    def test_enrollment_requires_verified_github_and_live_root_is_guarded(self):
        source = use('greeter') + 'use "std/result"\nuse "std/json"\nlet state = greeter.empty()\nlet enrollment = result.attempt(fn(): greeter.Reply { return greeter.handle(state, {action: "enroll-create", provider: "github", password: "secret"}) })\nprint(result.isErr(enrollment))\nlet root = result.attempt(fn(): greeter.Reply { return greeter.handle(state, {action: "password", username: "root", password: "root"}) })\nprint(result.isErr(root))'
        self.assertEqual(run_source(source).splitlines(), ['true', 'true'])

if __name__ == '__main__': unittest.main()
