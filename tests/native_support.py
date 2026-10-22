"""Compile fixture copies of DevLang services; production has no test switches."""
import json
import os
from pathlib import Path
import re
import shutil
import tempfile

from devlang_support import ROOT, run_source


class NativeFixture:
    def __enter__(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='devos-native-test-')
        self.root = Path(self.temporary.name)
        shutil.copytree(ROOT / 'native', self.root / 'native')
        shutil.copytree(ROOT / 'lib', self.root / 'lib')
        return self

    def __exit__(self, *unused):
        self.temporary.cleanup()

    def replace(self, module, name, definition):
        file = self.root / 'native' / (module + '.dev')
        source = file.read_text(encoding='utf8')
        pattern = re.compile(r'^fn ' + re.escape(name) + r'\([^\n]*[\s\S]*?(?=^(?:fn |struct |extern )|\Z)', re.M)
        source, count = pattern.subn(lambda _: definition + '\n', source)
        assert count == 1, (module, name, count)
        file.write_text(source, encoding='utf8')

    def invoke(self, expression):
        source = ''.join(f'use {json.dumps(str(self.root / "native" / (name + ".dev")))} as {alias}\n'
                         for name, alias in [('devos_accounts_system', 'accounts'), ('devos_app_store', 'store'), ('privileged', 'secure')])
        source += 'use "std/json"\nuse "std/result"\nuse "std/fs"\n'
        source += f'use {json.dumps(str(self.root / "lib/accounts.dev"))} as identity\n'
        source += 'fn box(value: bool): json.Value { return json.get({v: value}, "v") }\n'
        source += f'let outcome = result.attempt(fn(): json.Value {{ {expression} }})\n'
        source += 'if result.isErr(outcome) { print(json.stringify({error: result.message(outcome)})) } else { print(json.stringify(json.set(json.object(), "value", result.unwrap(outcome)))) }\n'
        value = json.loads(run_source(source))
        if 'error' in value and os.environ.get('DEVOS_TEST_DEBUG'):
            print(value)
        return value

    def stub(self, module, name, signature, value):
        self.replace(module, name, f'fn {name}{signature} {{ return json.parse({json.dumps(json.dumps(value))}) }}')

    def log_commands(self, module):
        file = self.root / 'commands.jsonl'
        if module == 'devos_accounts_system':
            body = f'fn run(argv: Vec<str>, input: str) {{ fs.appendFileSync({json.dumps(str(file))}, json.stringify({{argv: argv, input: input}}) + "\\n") }}'
        else:
            body = f'fn run(arguments: Vec<str>): str {{ fs.appendFileSync({json.dumps(str(file))}, json.stringify(arguments) + "\\n"); return "" }}'
        self.replace(module, 'run', body)
        return file
