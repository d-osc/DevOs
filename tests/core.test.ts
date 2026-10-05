import {
    Gio, GLib, Listeners, readText, readJson,
    writeJson, moveTabItem, reconcileRemovedTab, removeTree, completeTabMove
} from '@dev-os/core';

function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
const listeners = new Listeners();
let calls = 0;
const unsubscribe = listeners.subscribe(() => { calls++; });
listeners.emit(); unsubscribe(); unsubscribe(); listeners.emit();
assert(calls === 1, 'Unsubscribe is idempotent');
listeners.subscribe(() => { throw new Error('subscriber failed'); });
listeners.subscribe(() => { calls++; });
const errors: unknown[] = [];
listeners.emit(error => errors.push(error));
assert(errors.length === 1 && calls === 2, 'Error reporting does not skip later subscribers');
listeners.clear(); listeners.emit();
assert(calls === 2, 'Clear removes all subscriptions');

const source = [{id: 1}, {id: 2}, {id: 3}];
assert(moveTabItem(source, source, 2, 2) === null, 'Self drop is a no-op');
moveTabItem(source, source, 3, 1);
assert(source.map(tab => tab.id).join() === '3,1,2', 'Same-window reorder');
const target = [{id: 10}];
const moved = moveTabItem(source, target, 1, 10, tab => { tab.id = 11; });
assert(moved?.index === 1 && target.map(tab => tab.id).join() === '11,10', 'Transfer changes ID before target insertion');
let selected = 0, refreshed = 0, closed = 0;
const actions = {empty: () => { closed++; }, select: (id: number) => { selected = id; }, refresh: () => { refreshed++; }};
reconcileRemovedTab(source, 1, 1, 1, actions);
assert(selected === 2, 'Removing the active tab selects its neighbor');
reconcileRemovedTab(source, 3, 1, 1, actions);
assert(refreshed === 1, 'Removing an inactive tab preserves selection');
reconcileRemovedTab([], 1, 1, 0, actions);
assert(closed === 1, 'Empty source closes');
const transferOrder: string[] = [];
completeTabMove(moved, true, {tabs: source, active: 1, removed: 1,
    empty: () => transferOrder.push('close'), select: id => transferOrder.push(`source:${id}`),
    refresh: () => transferOrder.push('refresh')},
    {selectTab: id => transferOrder.push(`target:${id}`), show: () => transferOrder.push('show')});
assert(transferOrder.join() === 'target:11,source:2,show', 'Destination is selected before repairing source selection');

const directory = GLib.dir_make_tmp('dev-os-core-tests-XXXXXX');
const path = `${directory}/nested/settings.json`;
try {
    writeJson(path, {name: 'ภาษาไทย', enabled: true});
    assert(readJson<{name: string}>(path).name === 'ภาษาไทย', 'JSON round trip preserves Unicode');
    assert(readText(path).endsWith('\n'), 'JSON output retains its trailing newline');
    writeJson(path, {enabled: false});
    assert(readJson<{enabled: boolean}>(path).enabled === false, 'Atomic replacement updates existing files');
    const tree = `${directory}/tree`;
    GLib.mkdir_with_parents(tree, 0o700);
    Gio.File.new_for_path(`${tree}/link`).make_symbolic_link(`${directory}/nested`, null);
    removeTree(tree); removeTree(tree);
    assert(Gio.File.new_for_path(path).query_exists(null), 'Tree cleanup does not follow symlinks');
} finally {
    Gio.File.new_for_path(path).delete(null);
    Gio.File.new_for_path(`${directory}/nested`).delete(null);
    Gio.File.new_for_path(directory).delete(null);
}
print('PASS: core listeners, tab transfers and JSON helpers');
