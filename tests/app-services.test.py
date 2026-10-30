"""Real GJS worker IPC, using private files/preferences and no destructive actions."""
import json
import os
from pathlib import Path
import select
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


class Worker:
    def __init__(self, role, directory):
        self.process = subprocess.Popen(
            ['gjs', '-m', str(ROOT / 'dist/app-service-host.js'), role],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env={**os.environ, 'DEV_OS_ROOT': str(ROOT), 'XDG_CONFIG_HOME': str(directory / 'config'),
                 'XDG_DATA_HOME': str(directory / 'data'), 'GSETTINGS_BACKEND': 'memory'},
            bufsize=0)
        self.sequence = 0
        self.buffer = b''
        self.states = {}

    def request(self, op, args=None, object=None):
        self.sequence += 1
        request_id = self.sequence
        frame = dict(id=request_id, op=op, args=args or [], object=object)
        self.process.stdin.write((json.dumps(frame, ensure_ascii=False) + '\n').encode())
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if b'\n' not in self.buffer:
                if not select.select([self.process.stdout], [], [], max(0, deadline - time.monotonic()))[0]:
                    break
                chunk = os.read(self.process.stdout.fileno(), 65536)
                if not chunk:
                    raise AssertionError(self.process.stderr.read().decode())
                self.buffer += chunk
                continue
            line, self.buffer = self.buffer.split(b'\n', 1)
            response = json.loads(line)
            if response.get('event') == 'state':
                previous = self.states.get(response['object'], {})
                change = response['value']
                if 'state' in previous and 'state' in change:
                    change['state'] = {**previous['state'], **change['state']}
                self.states[response['object']] = {**previous, **change}
            if response.get('id') == request_id and 'event' not in response:
                if 'error' in response:
                    raise RuntimeError(response['error'])
                value = response['value']
                if op == 'create':
                    self.states[value['id']] = value['snapshot']
                return value
        raise AssertionError(f'Worker timed out: {op}')

    def create(self, name, args=None, id=100):
        return self.request('create', [name, args or [], id])

    def call(self, id, method, *args):
        return self.request('call', [method, args], object=id)

    def close(self):
        if self.process.poll() is None:
            self.process.stdin.close()
            try:
                self.process.wait(timeout=6)
            except subprocess.TimeoutExpired:
                self.process.kill()
                raise AssertionError('Worker survived UI disconnect')
        self.process.stdout.close()
        stderr = self.process.stderr.read().decode()
        self.process.stderr.close()
        if self.process.returncode:
            raise AssertionError(stderr)


class AppServicesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.worker = Worker('files', self.directory)
        self.addCleanup(self.worker.close)

    def test_every_base_app_has_an_independent_headless_worker(self):
        for role in ['settings', 'files', 'terminal', 'editor', 'camera', 'microphone',
                     'taskmanager', 'browser', 'diskmanager', 'appstore', 'installer', 'screenshot']:
            worker = Worker(role, self.directory)
            try:
                identity = worker.request('ping')
                self.assertEqual(identity['role'], role)
                self.assertEqual(identity['pid'], worker.process.pid)
                self.assertNotEqual(identity['pid'], os.getpid())
                maps = Path(f'/proc/{identity["pid"]}/maps').read_text()
                self.assertNotIn('libgtk-3', maps)
                self.assertNotIn('libwebkit', maps)
            finally:
                worker.close()

    def test_files_and_search_return_processed_state(self):
        (self.directory / 'example.ts').write_text('hello')
        (self.directory / 'subfolder').mkdir()
        self.worker.create('files/model.FileBrowser', [None])
        self.assertTrue(self.worker.call(100, 'navigate', str(self.directory)))
        state = self.worker.states[100]['state']
        self.assertEqual(state['entries'][0]['name'], 'subfolder')
        self.assertTrue(state['entries'][0]['directory'])
        self.worker.call(100, 'createFolder', 'created')
        self.assertTrue((self.directory / 'created').is_dir())
        self.worker.create('files/search.FileSearch', id=101)
        self.worker.call(101, 'start', str(self.directory), {'excludedDirectories': []})
        self.worker.call(101, 'setQuery', 'example')
        # Search debounces in its own event loop.
        time.sleep(.2)
        self.worker.call(101, 'setQuery', 'example')
        self.assertEqual(self.worker.states[101]['state']['query'], 'example')

    def test_editor_large_unicode_and_conflict_protection(self):
        path = self.directory / 'ไทย.ts'
        text = 'ข้อมูล🙂 const x = 42;\n' * 12000
        path.write_text(text)
        self.worker.create('editor/document.EditorDocument')
        self.assertTrue(self.worker.call(100, 'load', str(path)))
        self.assertEqual(self.worker.states[100]['content'], text)
        edited = text + '// updated\n'
        self.worker.call(100, 'edit', edited)
        self.assertTrue(self.worker.call(100, 'save'))
        self.assertEqual(path.read_text(), edited)
        path.write_text('external change')
        self.worker.call(100, 'edit', 'must not overwrite')
        self.assertFalse(self.worker.call(100, 'save'))
        self.assertEqual(path.read_text(), 'external change')
        self.assertIn('changed on disk', self.worker.states[100]['error'])

    def test_terminal_data_and_cleanup(self):
        created = self.worker.create('terminal/data.TerminalData', [None])
        directory = Path(self.worker.call(created['id'], 'initialize'))
        self.assertTrue((directory / 'init.bash').is_file())
        self.worker.call(100, 'accept', {'line': 'gi', 'point': 2}, {'line': 'git ', 'point': 4})
        self.assertIn(b'git ', (directory / 'accept').read_bytes())
        self.worker.request('dispose', object=100)
        self.assertFalse(directory.exists())

    def test_browser_downloads_are_committed_in_service(self):
        self.worker.create('browser/data.BrowserData')
        self.assertIn('duckduckgo.com', self.worker.call(100, 'navigate', 'some search'))
        destination = self.directory / 'download.txt'
        destination.write_text('original')
        prepared = self.worker.call(100, 'prepare', str(destination))
        from urllib.parse import unquote, urlparse
        partial = Path(unquote(urlparse(prepared['uri']).path))
        partial.write_text('download')
        self.assertEqual(destination.read_text(), 'original')
        self.worker.call(100, 'commit', prepared['id'])
        self.assertEqual(destination.read_text(), 'download')
        self.assertFalse(partial.exists())

    def test_controller_errors_and_disposal(self):
        with self.assertRaisesRegex(RuntimeError, 'Invalid app controller'):
            self.worker.create('unknown')
        self.worker.create('editor/document.EditorDocument')
        with self.assertRaisesRegex(RuntimeError, 'Invalid service operation'):
            self.worker.call(100, '__proto__')
        self.worker.request('dispose', object=100)
        with self.assertRaisesRegex(RuntimeError, 'Unknown service request'):
            self.worker.call(100, 'load', '/missing')
        self.assertEqual(self.worker.request('ping')['pid'], self.worker.process.pid)


if __name__ == '__main__':
    unittest.main()
