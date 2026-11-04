"""Check the actual interactive Bash prompt at home and after changing folders."""
import os
from pathlib import Path
import pwd
import re
import socket
import subprocess
import tempfile
import unittest

PROFILE = Path(__file__).resolve().parents[1] / 'distro/oe/meta-devos/recipes-devos/session/files/devos-profile.sh'


class TerminalPromptTests(unittest.TestCase):
    def test_desktop_launcher_starts_in_home_even_when_called_from_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            home = base/'home'; home.mkdir()
            helper = base/'dev-os-shell'
            helper.write_text('#!/bin/sh\ntest "$1" = terminal || exit 1\npwd\n')
            helper.chmod(0o755)
            wrapper = Path(__file__).resolve().parents[1]/'bin/dev-os-terminal'
            result = subprocess.run(['sh', str(wrapper)], cwd='/',
                                    env=os.environ | {'HOME': str(home), 'PATH': str(base)+':'+os.environ['PATH']},
                                    capture_output=True, text=True, check=True)
            self.assertEqual(result.stdout.strip(), str(home))

    def test_prompt_uses_current_identity_hostname_and_directory(self):
        identity = pwd.getpwuid(os.getuid()).pw_name + '@' + socket.gethostname().split('.')[0]
        suffix = '#' if os.geteuid() == 0 else '$'
        body = '. "$1"; HOME="$2"; cd "$HOME"; printf "%s\\n" "${PS1@P}"; mkdir Docs; cd Docs; printf "%s\\n" "${PS1@P}"'
        for term in ('dumb', 'xterm-256color'):
            with self.subTest(term=term), tempfile.TemporaryDirectory() as home:
                done = subprocess.run(['bash', '--noprofile', '--norc', '-ic', body, 'prompt-test', str(PROFILE), home],
                                      env=os.environ | {'TERM': term}, capture_output=True, text=True, check=True)
                plain = re.sub(r'\x1b\[[0-9;]*m', '', done.stdout).replace('\x01', '').replace('\x02', '')
                self.assertEqual(plain.splitlines(), [identity + ':~' + suffix + ' ', identity + ':~/Docs' + suffix + ' '])


if __name__ == '__main__':
    unittest.main()
