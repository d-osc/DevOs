import {
    type UIExtension
} from '@dev-os/core';
import {Launcher} from './index.js';

export default {id: 'org.devos.launcher', activate(context) {
    let launcher = new Launcher(context);
    const primary = () => context.display.get_primary_monitor() ?? context.monitors()[0];
    context.registerCommand('launcher', monitor => launcher.toggle(monitor ?? primary()));
    context.registerCommand('logout', () => { launcher.show(primary()); launcher.requestLogout(); });
    context.registerCommand('launcher.hide', () => { launcher.hide(); });
    context.onMessage(message => launcher.showMessage(message));
    context.onReload(() => { launcher.destroy(); launcher = new Launcher(context); });
    context.onMonitors(() => { launcher.hide(); });
    return () => launcher.destroy();
}} satisfies UIExtension;
