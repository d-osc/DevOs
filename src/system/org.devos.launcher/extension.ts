import {
    React, type UIExtension
} from '@dev-os/core';
import {Launcher} from './index.js';
import {LauncherSettings} from './settings-view.js';
import {TaskView} from './task-view.js';
import {SnapPanel} from './snap-view.js';
import {SnapSashes} from './snap-sashes.js';
import {nativeLauncher, nativeLauncherEnabled} from '@dev-os/runtime/native-launcher';

export default {id: 'org.devos.launcher', activate(context) {
    context.registerSettingsPage?.('org.devos.launcher', () => React.createElement(LauncherSettings, {
        preferences: context.preferences,
        applied: () => { if (!context.reload()) throw new Error('Could not reload the launcher.'); },
    }));
    let launcher = new Launcher(context);
    let taskView = new TaskView(context);
    let snap = new SnapPanel(context);
    let sashes = new SnapSashes(context);
    const primary = () => context.display.get_primary_monitor() ?? context.monitors()[0];
    // With the native Launcher switched on (DEVOS_NATIVE_LAUNCHER=1 or ~/.config/devos/native-launcher) these commands go to its window instead.
    const report = (message: string) => console.error(`launcher: ${message}`);
    context.registerCommand('launcher', monitor => {snap.hide(); if (nativeLauncherEnabled()) nativeLauncher(['launcher'], true, report); else launcher.toggle(monitor ?? primary());});
    context.registerCommand('logout', () => { snap.hide(); if (nativeLauncherEnabled()) nativeLauncher(['launcher', 'logout'], true, report); else { launcher.show(primary()); launcher.requestLogout(); } });
    context.registerCommand('launcher.hide', () => { if (nativeLauncherEnabled()) nativeLauncher(['launcher', 'hide'], false, report); launcher.hide(); });
    context.registerCommand('snap-layouts', monitor => {launcher.hide(); taskView.hide(); snap.toggle(monitor);});
    context.registerCommand('task-view', monitor => {snap.hide(); taskView.toggle(monitor);});
    context.registerCommand('task-view-show', monitor => {snap.hide(); taskView.show(monitor);});
    context.registerCommand('task-view-hide', () => taskView.hide());
    context.registerCommand('overlays-hide', () => { if (nativeLauncherEnabled()) nativeLauncher(['launcher', 'hide'], false, report); launcher.hide(); taskView.hide(); snap.hide(); });
    context.onMessage(message => launcher.showMessage(message));
    context.onReload(() => { launcher.destroy(); launcher = new Launcher(context); taskView.destroy(); taskView = new TaskView(context); snap.destroy(); snap = new SnapPanel(context); sashes.destroy(); sashes = new SnapSashes(context); });
    context.onMonitors(() => { launcher.hide(); taskView.hide(); snap.hide(); });
    return () => {launcher.destroy(); taskView.destroy(); snap.destroy(); sashes.destroy();};
}} satisfies UIExtension;
