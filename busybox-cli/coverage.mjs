// Dispatch coverage is distinct from option/behavior compatibility.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(fs.readFileSync(path.join(directory, 'applets.json'), 'utf8'));
const source = fs.readFileSync(path.join(directory, 'main.dev'), 'utf8');
const dispatch = [...source.matchAll(/if sys\.same\(name, "([^"]+)"\) \{ return (\w+)\.(\w+)\(args\) \}/g)];
const imports = new Map([...source.matchAll(/use "([^"\n]+)" as (\w+)/g)].map(m => [m[2], m[1]]));
const registered = new Set();
for (const [, name, alias, fn] of dispatch) {
  const module = imports.get(alias);
  if (!module) throw new Error(`Missing import for ${name}: ${alias}`);
  const implementation = fs.readFileSync(path.resolve(directory, module), 'utf8');
  if (!new RegExp(`\\bfn ${fn}\\(`).test(implementation)) throw new Error(`Missing function for ${name}: ${fn}`);
  if (registered.has(name)) throw new Error(`Duplicate dispatch: ${name}`);
  registered.add(name);
}
if (new Set(spec.applets).size !== spec.applets.length || spec.applets.length !== 297) throw new Error('Invalid reference applet inventory');
const implemented = spec.applets.filter(name => registered.has(name)).sort();
const missing = spec.applets.filter(name => !registered.has(name)).sort();
console.log(`${implemented.length}/${spec.applets.length} applets registered; ${missing.length} missing. Option/behavior parity is not established.`);
if (missing.length) console.log(`Missing: ${missing.join(' ')}`);
if (process.argv.includes('--write')) {
  const readmePath = path.join(directory, 'README.md');
  let readme = fs.readFileSync(readmePath, 'utf8');
  readme = readme.replace(/\*\*\d+ are implemented \(\d+%\); \d+ are not\.\*\*/, `**${implemented.length} are implemented (${Math.round(implemented.length * 100 / spec.applets.length)}%); ${missing.length} are not.**`);
  readme = readme.replace(/(### Registered applets)\r?\n[^]*?(?=### Not implemented)/, `$1\n\n${implemented.join(' ')}\n\n`);
  readme = readme.replace(/(### Not implemented)\r?\n[^]*$/, `$1\n\n${missing.length ? missing.join(' ') : 'None.'}\n`);
  fs.writeFileSync(readmePath, readme);
}
if (process.argv.includes('--require-complete') && missing.length) process.exitCode = 1;
