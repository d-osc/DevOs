import {
    React, type UIExtension
} from '@dev-os/core';
import {Launcher} from './index.js';
import {LauncherSettings} from './settings-view.js';
import {TaskView} from './task-view.js';

export default {id: 'org.devos.launcher', activate(context) {
    context.registerSettingsPage?.('org.devos.launcher', () => React.createElement(LauncherSettings, {
        preferences: context.preferences,
        applied: () => { if (!context.reload()) throw new Error('Could not reload the launcher.'); },
    }));
    let launcher = new Launcher(context);
    let taskView = new TaskView(context);
    const primary = () => context.display.get_primary_monitor() ?? context.monitors()[0];
    context.registerCommand('launcher', monitor => launcher.toggle(monitor ?? primary()));
    context.registerCommand('logout', () => { launcher.show(primary()); launcher.requestLogout(); });
    context.registerCommand('launcher.hide', () => { launcher.hide(); });
    context.registerCommand('task-view', monitor => taskView.toggle(monitor));
    context.registerCommand('task-view-show', monitor => taskView.show(monitor));
    context.registerCommand('task-view-hide', () => taskView.hide());
    context.registerCommand('overlays-hide', () => { launcher.hide(); taskView.hide(); });
    context.onMessage(message => launcher.showMessage(message));
    context.onReload(() => { launcher.destroy(); launcher = new Launcher(context); taskView.destroy(); taskView = new TaskView(context); });
    context.onMonitors(() => { launcher.hide(); taskView.hide(); });
    return () => {launcher.destroy(); taskView.destroy();};
}} satisfies UIExtension;
