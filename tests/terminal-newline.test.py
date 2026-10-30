"""Run Terminal's actual Readline bindings in a private Bash PTY."""
import os
from pathlib import Path
import pty
import re
import select
import signal
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


class TerminalNewlineTests(unittest.TestCase):
    def test_shift_enter_edits_without_executing_in_emacs_and_vi(self):
        source = (ROOT / 'src/apps/org.devos.terminal/shell-integration.ts').read_text()
        script = re.search(r'String.raw`(.*?)`;', source, re.S).group(1)
        script = script.replace('. /etc/profile', ':').replace('. "$__devos_profile"', ':')
        for mode in ('emacs', 'vi'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory(prefix='devos-newline-') as directory:
                base = Path(directory)
                (base / 'init').write_text(script + f'\nset -o {mode}\n')
                child, fd = pty.fork()
                if child == 0:
                    os.chdir(directory)
                    env = dict(os.environ, HOME=directory, HISTFILE='/dev/null', TERM='xterm-256color',
                               DEV_OS_TERMINAL_COMPLETION_DIR=directory)
                    os.execvpe('bash', ['bash', '--rcfile', str(base / 'init'), '-i'], env)
                output = bytearray()
                def wait_for(predicate):
                    deadline = time.monotonic() + 4
                    while time.monotonic() < deadline:
                        if select.select([fd], [], [], .05)[0]:
                            output.extend(os.read(fd, 65536))
                        if predicate():
                            return
                    self.fail('Timed out waiting for Bash PTY')
                try:
                    wait_for(lambda: (base / 'state').exists())
                    os.write(fd, "printf 'ไทย' > result".encode())
                    os.write(fd, b'\x1b[13;2u')
                    os.write(fd, b'printf second >> result')
                    # Drain output to ensure Readline consumed the whole input.
                    wait_for(lambda: b'second' in output)
                    self.assertFalse((base / 'result').exists(), 'Shift+Enter executed a line')
                    os.write(fd, b'\r')
                    wait_for(lambda: (base / 'result').exists() and (base / 'result').read_text() == 'ไทยsecond')
                    self.assertNotIn(b'invalid keymap', output)
                    os.write(fd, b'sleep 30\r')
                    wait_for(lambda: (base / 'state').read_bytes().startswith(b'busy\0'))
                    os.write(fd, b'\x03')
                    wait_for(lambda: (base / 'state').read_bytes().startswith(b'ready\0'))
                    os.write(fd, b'printf alive > interrupted\r')
                    wait_for(lambda: (base / 'interrupted').exists() and (base / 'interrupted').read_text() == 'alive')
                finally:
                    os.kill(child, signal.SIGKILL)
                    os.waitpid(child, 0)
                    os.close(fd)


if __name__ == '__main__':
    unittest.main()
