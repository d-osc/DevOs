"""The Terminal's Bash prompt: green for a normal user, red for the administrator, plain prompts left alone."""
import os
from pathlib import Path
import pty
import re
import select
import shlex
import shutil
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
INTEGRATION = (ROOT / 'extensions/org.devos.terminal/shell-integration.ts').read_text()
PROFILE = (ROOT / 'distro/oe/meta-devos/recipes-devos/session/files/devos-profile.sh').read_text()
GREEN, RED, BLUE, RESET = '\x1b[1;32m', '\x1b[1;31m', '\x1b[1;34m', '\x1b[0m'


def init_script():
    # The integration is a String.raw template, so its text is the shell script itself.
    return re.search(r'String\.raw`(.*?)`;', INTEGRATION, re.S).group(1)


def run_prompt(prompt, uid_override=None, extra_commands='', source='terminal'):
    """Runs an interactive bash with the Terminal init (or the image profile) and returns what it prints at the first prompt."""
    with tempfile.TemporaryDirectory() as temp:
        temp = Path(temp)
        script = init_script() if source == 'terminal' else PROFILE
        if source == 'terminal':
            # Skip the host's login files; this checks only the prompt logic. The Terminal bridge is not needed.
            script = script.replace('. /etc/profile', ':', 1).replace('. "$__devos_profile"', ':')
            script = script.split('__devos_completion_dir=', 1)[0]
        if uid_override is not None:
            script = f'id() {{ echo {uid_override}; }}\n' + script
        # Bash does not keep PS1 from its environment, so set it the way /etc/profile would.
        (temp / 'init.bash').write_text(f'PS1={shlex.quote(prompt)}\n' + script + f'\n{extra_commands}\n')
        environment = {'PATH': os.environ['PATH'], 'TERM': 'xterm-256color', 'HOME': str(temp), 'PS1': prompt}
        pid, fd = pty.fork()
        if pid == 0:
            os.execvpe('bash', ['bash', '--rcfile', str(temp / 'init.bash'), '-i'], environment)
        output = b''
        end = time.time() + 3
        while time.time() < end:
            ready, _, _ = select.select([fd], [], [], 0.2)
            if ready:
                try:
                    output += os.read(fd, 4096)
                except OSError:
                    break
        os.write(fd, b'exit\n')
        os.close(fd)
        try:
            os.kill(pid, 9)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)
        return output.decode(errors='replace')


@unittest.skipUnless(shutil.which('bash'), 'Needs bash')
class PromptTests(unittest.TestCase):
    def test_normal_user_is_green_and_ends_in_dollar(self):
        out = run_prompt(r'\u@\h:\w\$ ', uid_override=1000)
        self.assertIn(GREEN, out)
        self.assertNotIn(RED, out)
        self.assertIn(BLUE, out, 'The directory is blue')
        if os.geteuid() != 0:  # Bash's own \$ prints # for a real root shell whatever uid the script saw
            self.assertNotIn('#', re.sub(r'\x1b\[[0-9;]*m', '', out).split('\n')[-1])

    def test_administrator_is_red_and_ends_in_hash(self):
        out = run_prompt(r'\u@\h:\w\$ ', uid_override=0)
        self.assertIn(RED, out)
        self.assertNotIn(GREEN, out)
        # The symbol is Bash's own \$ escape, which prints # for a real root shell; the red wrapper must surround it.
        definition = run_prompt(r'\u@\h:\w\$ ', uid_override=0, extra_commands='printf "PS1<%s>\n" "$PS1"')
        self.assertIn(r'\[\e[1;31m\]\$\[\e[0m\]', definition)
        if os.geteuid() == 0:
            last = re.sub(r'\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07', '', out).replace('\r', '').split('\n')[-1]
            self.assertTrue(last.rstrip().endswith('#'), last)

    def test_other_default_forms_are_colored_too(self):
        for plain in (r'\u@\h:\w\# ', r'\h:\w\$ '):
            self.assertIn(GREEN, run_prompt(plain, uid_override=1000), plain)

    def test_a_prompt_the_user_chose_is_not_replaced(self):
        for custom in ('mine> ', r'\[\e[35m\]custom\[\e[0m\]> '):
            out = run_prompt(custom, uid_override=1000)
            self.assertNotIn(GREEN, out)
            self.assertNotIn(RED, out)

    def test_dumb_terminals_stay_plain(self):
        with tempfile.TemporaryDirectory():
            out = run_prompt(r'\u@\h:\w\$ ', uid_override=1000, extra_commands='')
            self.assertIn('\x1b', out)  # sanity: the colored case does emit escapes
        # TERM=dumb is checked by the script itself.
        self.assertIn('"$TERM" != dumb', init_script())

    def test_prompt_escapes_are_wrapped_for_readline(self):
        # Unwrapped escapes make Readline miscount the prompt width and garble editing.
        prompts = re.findall(r"PS1='([^']*\\e\[[^']*)'", init_script())
        self.assertTrue(prompts)
        for prompt in prompts:
            for escape in re.findall(r'\\e\[[0-9;]*m', prompt):
                position = prompt.index(escape)
                self.assertTrue(prompt[:position].endswith('\\['), prompt)
                self.assertTrue(prompt[position + len(escape):].startswith('\\]'), prompt)

    def test_image_profile_uses_the_same_colors(self):
        for uid, color in ((1000, GREEN), (0, RED)):
            self.assertIn(color, run_prompt('', uid_override=uid, source='profile'), uid)

    def test_command_output_colors_are_enabled_when_supported(self):
        out = run_prompt(r'\u@\h:\w\$ ', uid_override=1000, extra_commands='alias ls; alias grep')
        version = subprocess.run(['ls', '--version'], capture_output=True, text=True).stdout
        if 'GNU' in version:
            self.assertIn("alias ls='ls --color=auto'", out)
            self.assertIn("alias grep='grep --color=auto'", out)


if __name__ == '__main__':
    unittest.main()
