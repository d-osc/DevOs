import assert from 'node:assert/strict';
import {isSystemApp, rankExternalApps} from '../packages/services/memory-policy.ts';

const external = Array.from({length: 8}, (_, index) => `external-${index + 1}.desktop`);
const system = ['dev-os-editor.desktop', 'dev-os-terminal.desktop', 'dev-os-app-store.desktop',
    'dev-os-files.desktop', 'org.devos.settings.desktop', 'dev-os-task-manager.desktop', 'dev-os-disk-manager.desktop'];
assert.ok(system.every(isSystemApp));
assert.equal(isSystemApp('google-chrome.desktop'), false);
assert.equal(isSystemApp('com.microsoft.VSCode.desktop'), false);
assert.equal(isSystemApp('dev-os-third-party.desktop'), false);
assert.deepEqual(rankExternalApps([], [...system, ...external], system[0]), external);
assert.deepEqual(rankExternalApps(external, [...system, ...external], external[7]), [external[7], ...external.slice(0, 7)]);
assert.deepEqual(rankExternalApps([...system, ...external], [...external, ...system], system[1]), external);
assert.deepEqual(rankExternalApps(external, external.slice(1), external[5]), [external[5], ...external.slice(1).filter(id => id !== external[5])]);
assert.deepEqual(rankExternalApps([], ['GOOGLE-CHROME.desktop', 'google-chrome.desktop'], 'GOOGLE-CHROME.desktop'), ['google-chrome.desktop']);
console.log('PASS: system tools excluded; external MRU order, closing and duplicate windows');
