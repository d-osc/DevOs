import fs from 'node:fs';
const sp = process.argv[2];
const spec = Object.keys(JSON.parse(fs.readFileSync(sp + '/applets.json', 'utf8'))).sort();
const m = fs.readFileSync('busybox-cli/main.dev', 'utf8');
const have = new Set([...m.matchAll(/sys\.same\(name, "([^"]+)"\)/g)].map(x => x[1]));
const done = spec.filter(x => have.has(x)), todo = spec.filter(x => !have.has(x));
const md = '# busybox-cli\n\nA native multi-call `busybox` written in DevLang (no C, no BusyBox source). Build with `sh busybox-cli/build.sh` (output `build/busybox-cli/busybox`); run `busybox APPLET ARGS` or through a link named after the applet.\n\n## Coverage against BusyBox.html\n\nBusyBox.html lists ' + spec.length + ' applets. **' + done.length + ' are implemented (' + Math.round(done.length * 100 / spec.length) + '%); ' + todo.length + ' are not.** This is not a complete replacement: full parity is not claimed.\n\nTests (`tests/busybox-cli.test.dev`) compare most applets with the system tools (stdout and exit status); BusyBox-only behaviour is checked by pattern. Known approximations: no sub-second timestamps, the POSIX regex engine is a backtracking matcher (first match, not longest, for alternation), `printf` has no floating point, `ls` prints one entry per line, `awk` has no `printf %c` for values above 255 and uses `|`/`getline` through temporary files, `ps`/`free`/`uptime` formats are approximations.\n\n### Implemented\n\n' + done.join(' ') + '\n\n### Not implemented\n\n' + todo.join(' ') + '\n';
fs.writeFileSync('busybox-cli/README.md', md);
console.log(done.length, '/', spec.length);
