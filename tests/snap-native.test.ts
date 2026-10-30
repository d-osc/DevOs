import {Gtk, GLib, Gdk, type UIContext} from '@dev-os/core';
import {SnapSashes} from '../src/system/org.devos.launcher/snap-sashes.js';
import {Windows, snapLayouts} from '@dev-os/services/windows';
Gtk.init(null);
const windows = [1,2,3,4].map(id => new Gtk.Window({title: `Snap native ${id}`, default_width: 320, default_height: 240}));
const destroyed = new Set<Gtk.Window>();
windows.forEach(window => {window.connect('destroy', () => {destroyed.add(window);}); window.add(new Gtk.Label({label: window.title ?? ''})); window.show_all();});
const tracker = new Windows();
const app = new Gtk.Application({application_id: 'org.devos.SnapNativeTest'}); app.register(null);
const display = Gdk.Display.get_default()!;
const sashes = new SnapSashes({application: app, display, windows: tracker, monitors: () => Array.from({length: display.get_n_monitors()}, (_, index) => display.get_monitor(index)!)} as unknown as UIContext);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function until(check: () => boolean, message: string) {for(let i=0;i<100;i++){if(check())return;await wait();}throw new Error(message);}
async function test() {
 await until(() => tracker.canSnap && tracker.state.filter(window => window.title.startsWith('Snap native')).length === 4, 'Snap protocol or fixture unavailable');
 const ids = windows.map(window => tracker.state.find(item => item.title === window.title)!.id);
 for(const layout of snapLayouts) {
  tracker.arrange(layout.id, ids.slice(0, layout.regions.length));
  await until(() => tracker.snapGroups.some(group => group.layout === layout.id), 'Group missing');
  await wait(); await wait(); await wait();
  const sizes = windows.slice(0,layout.regions.length).map(window => window.get_size());
  if(layout.id === 'halves' && Math.abs(sizes[0][0]-sizes[1][0]) > 3) throw new Error('Unequal halves');
  if(layout.id === 'thirds' && Math.max(...sizes.map(size => size[0]))-Math.min(...sizes.map(size => size[0])) > 30) throw new Error('Unequal thirds');
  if(layout.id === 'quarters' && sizes.some(size => size[1] >= 500)) throw new Error('Quarters height incorrect');
  if(sizes.some(size => size[0] <= 100 || size[1] <= 100)) throw new Error('Invalid snap size');
  if(layout.id === 'wide-left' && sizes[0][0] <= sizes[1][0]*1.5) throw new Error('Wide-left geometry incorrect');
  if(layout.id === 'wide-right' && sizes[1][0] <= sizes[0][0]*1.5) throw new Error('Wide-right geometry incorrect');
  print(`PASS: native ${layout.id} geometry ${JSON.stringify(sizes)}`);
 }
 await until(() => tracker.canResizeSnap && ids.every(id => !!tracker.state.find(window => window.id === id)?.geometry), 'Sash geometry protocol missing');
 const group = tracker.snapGroups[0];
 tracker.resizeSnapGroup(group.id, 'x', 0, 6200);
 tracker.resizeSnapGroup(group.id, 'y', 0, 5700);
 await until(() => windows[0].get_size()[0] > windows[1].get_size()[0] * 1.4 && windows[0].get_size()[1] > windows[2].get_size()[1] * 1.2, 'Paired resize did not change both axes');
 await until(() => {const a = tracker.state.find(window => window.id === ids[0])?.geometry, b = tracker.state.find(window => window.id === ids[1])?.geometry; return !!a && !!b && a.width > b.width * 1.4 && b.x - a.x - a.width >= 2 && b.x - a.x - a.width <= 6;}, 'Geometry snapshots did not settle at the shared divider');
 const left = tracker.state.find(window => window.id === ids[0])!.geometry!;
 const right = tracker.state.find(window => window.id === ids[1])!.geometry!;
 const gap = right.x - left.x - left.width;
 if(gap < 2 || gap > 6 || left.x - left.area.x > 5) throw new Error(`Incorrect compact snap gap ${gap}`);
 await until(() => sashes.window.get_visible(), 'Three-dot sash overlay missing');
 const hold = GLib.getenv('DEV_OS_SASH_HOLD');
 if(hold) {
  print('SASH_FIXTURE_READY');
  for(let i=0;i<1200 && !GLib.file_test(hold, GLib.FileTest.EXISTS);i++) await wait();
  if(!GLib.file_test(hold, GLib.FileTest.EXISTS)) throw new Error('Sash pointer check timed out');
  const changed = tracker.snapGroups.find(item => item.id === group.id)!;
  if(changed.cuts?.[0] === 6200 || changed.row === 5700) throw new Error('Pointer drag did not update both dividers');
  if(!tracker.state.find(window => window.id === ids[0])?.active) throw new Error('Sash surface intercepted clicks outside grips');
  print(`PASS: real pointer drag ${JSON.stringify({cuts:changed.cuts,row:changed.row})}`);
 }
 windows[0].maximize();
 await until(() => tracker.state.find(window => window.id === ids[0])?.maximized === true && !sashes.window.get_visible(), 'Sash stayed visible while a group member was maximized');
 windows[0].unmaximize();
 await until(() => {const a=tracker.state.find(window => window.id === ids[0]), b=tracker.state.find(window => window.id === ids[1]); return a?.maximized === false && !!a.geometry && !!b?.geometry && a.geometry.width > b.geometry.width * 1.4 && b.geometry.x-a.geometry.x-a.geometry.width >= 2 && b.geometry.x-a.geometry.x-a.geometry.width <= 6 && sashes.window.get_visible();}, 'Unmaximize did not restore shared proportions');
 print('PASS: maximize hides sash; unmaximize restores group geometry');
 print('PASS: paired horizontal/vertical resize, compact gaps and sash surface'); windows.forEach(window => window.iconify());
 await until(() => ids.every(id => tracker.state.find(window => window.id === id)?.minimized), 'Minimize failed');
 tracker.restoreSnapGroup(group.id);
 await until(() => ids.every(id => tracker.state.find(window => window.id === id)?.minimized === false), 'Group restore failed');
 await until(() => windows[0].get_size()[0] > windows[1].get_size()[0] * 1.4, 'Restore forgot sash proportions');
 tracker.close(ids[0]);
 await until(() => !tracker.snapGroups.some(item => item.members.some(member => member.id === ids[0])), 'Closed member retained');
 print('PASS: native snap group restore and closed-window cleanup');
}
const loop = new GLib.MainLoop(null,false); let failure: unknown;
void test().catch(error => {failure=error;}).finally(() => loop.quit()); loop.run(); sashes.destroy(); tracker.destroy(); windows.filter(window => !destroyed.has(window)).forEach(window => window.destroy()); if(failure) throw failure;

