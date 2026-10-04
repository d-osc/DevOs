import GLib from 'gi://GLib';
import System from 'system';
import {requestSessionVersion} from '../src/session-version.js';

const loop = new GLib.MainLoop(null, false); let failed: unknown;
void requestSessionVersion(ARGV[0]).catch(error => { failed = error; }).finally(() => loop.quit());
loop.run();
if (failed) { printerr(String(failed)); System.exit(1); }
print('PASS: version switch preflight and private session request');
