// usage: node .tmp-reg.mjs MODULE ALIAS applet1 applet2 ...   registers applets run_<name> of busybox-cli/applets/MODULE.dev in main.dev
import {readFileSync, writeFileSync} from 'node:fs';
const [, , module, alias, ...names] = process.argv;
let m = readFileSync('busybox-cli/main.dev', 'utf8');
if (names.length && !m.includes(`as ${alias}\n`)) m = m.replace(/(use "\.\/applets\/[a-z0-9_]+\.dev" as [a-z0-9_]+\n)(?!use "\.\/applets)/, `$1use "./applets/${module}.dev" as ${alias}\n`);
const lines = names.map(n => `    if sys.same(name, "${n}") { return ${alias}.run_${n.replace(/[^a-z0-9]/g, '_')}(args) }`).join('\n');
if (names.length) m = m.replace('    sys.warn(name, "applet not found")', lines + '\n    sys.warn(name, "applet not found")');
const current = [...m.matchAll(/sys\.same\(name, "([^"]+)"\)/g)].map(x => x[1]).filter(x => x !== 'busybox');
const all = [...new Set(current)].sort();
const body = 'Vec<str>(' + all.map(x => '"' + x + '"').join(', ') + ')';
const marker = 'fn applet_names(): Vec<str> {\n    return ';
const at = m.indexOf(marker);
const end = m.indexOf('\n', at + marker.length);
m = m.slice(0, at + marker.length) + body + m.slice(end);
writeFileSync('busybox-cli/main.dev', m);
console.log(all.length, 'applets registered');
