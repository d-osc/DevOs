"""Exercise DevLang declarations in isolated source/filesystem fixtures."""
import json
from pathlib import Path
import re
import shutil
import tempfile
from devlang_support import ROOT, D, run_source
import os
import subprocess

class BridgeFixture:
    def __init__(self, relative):
        self.temporary = tempfile.TemporaryDirectory(prefix='devos-bridge-')
        self.root = Path(self.temporary.name)
        self.file = (self.root / relative).with_suffix('.dev')
        self.file.parent.mkdir(parents=True)
        self.file.write_text(re.sub(r'(?m)^return main\(\)\s*$', '', (ROOT / relative).read_text()) + '\n')
        shutil.copytree(ROOT / 'lib', self.root / 'lib')

    def close(self):
        self.temporary.cleanup()

    def replace_text(self, old, new):
        source = self.file.read_text()
        assert old in source, old
        self.file.write_text(source.replace(old, new))

    def replace(self, name, definition):
        pattern = re.compile(r'^fn ' + re.escape(name) + r'\([^\n]*[\s\S]*?(?=^(?:fn |struct |extern |use |return )|\Z)', re.M)
        source, count = pattern.subn(lambda _: definition + '\n', self.file.read_text())
        assert count == 1, (name, count)
        self.file.write_text(source)

    def invoke(self, body, env=None):
        source = f'use {json.dumps(str(self.file))} as bridge\nuse "std/json"\nuse "std/result"\nuse "std/fs"\nuse "std/strings"\n'
        source += f'let outcome = result.attempt(fn(): json.Value {{ {body} }})\n'
        source += 'if result.isErr(outcome) { print(json.stringify({error: result.message(outcome)})) } else { print(json.stringify({value: result.unwrap(outcome)})) }\n'
        output = run_source(source, env=env)
        self.output = output
        return json.loads(output.splitlines()[-1])

    def value(self, expression, env=None):
        result = self.invoke(f'return json.value({expression})', env)
        assert 'value' in result, result
        return result['value']

    def cli(self, request, env=None, args=()):
        entry = self.root / 'entry.dev'
        entry.write_text(f'use {json.dumps(str(self.file))} as bridge\nreturn bridge.main()\n')
        argv = [D, str(entry)]
        if os.getenv('DEVLANG_ENGINE'):
            argv += ['--engine', os.environ['DEVLANG_ENGINE']]
        if args: argv += ['--',*args]
        return subprocess.run(argv, input=json.dumps(request)+'\n', text=True, capture_output=True, timeout=45, env=os.environ | (env or {}))

    def log(self, name, signature, result='true'):
        file = self.root / (name + '.jsonl')
        self.replace(name, f'fn {name}{signature} {{ fs.appendFileSync({json.dumps(str(file))}, json.stringify(json.value(arguments)) + "\\n"); return {result} }}')
        return file

def literal(value):
    return 'json.parse(' + json.dumps(json.dumps(value, ensure_ascii=False), ensure_ascii=False) + ')'
