import {
    GLib
} from '@dev-os/core';
import System from 'system';
import {requestSessionVersion} from '@dev-os/runtime/session-version';

const loop = new GLib.MainLoop(null, false); let failed: unknown;
void requestSessionVersion(ARGV[0]).catch(error => { failed = error; }).finally(() => loop.quit());
loop.run();
if (failed) { printerr(String(failed)); System.exit(1); }
print('PASS: version switch preflight and private session request');
