import {
    Gio, GLib, type UIExtension
} from '@dev-os/core';
import {UserSwitcher} from './switch-user.js';
import {Settings} from './index.js';
import {AppProcesses} from '../../../packages/shell/app-processes.js';

export default {id: 'org.devos.settings', activate(context) {
    const native = new AppProcesses(message => printerr(message));
    let settings: Settings | undefined;
    const switcher = new UserSwitcher(context);
    const switchAction = new Gio.SimpleAction({name: 'devos-switch-user', parameter_type: new GLib.VariantType('s')});
    switchAction.connect('activate', (_action, parameter) => switcher.show(parameter?.get_string()[0] || undefined));
    context.application.add_action(switchAction);
    context.registerCommand('session.switch-user', (_monitor, username) => switcher.show(username));
    context.registerCommand('settings', () => {
        context.invoke('launcher.hide');
        if (settings) settings.show(); else settings = new Settings(context, username => switcher.show(username));
    });
    context.registerCommand('settings.wifi', () => {
        context.invoke('launcher.hide');
        if (!settings) settings = new Settings(context, username => switcher.show(username));
        settings.show('wifi');
    });
    context.registerCommand('settings.network', () => {
        context.invoke('launcher.hide');
        if (!settings) settings = new Settings(context, username => switcher.show(username));
        settings.show('network');
    });
    context.registerCommand('settings.bluetooth', () => {
        context.invoke('launcher.hide');
        if (!settings) settings = new Settings(context, username => switcher.show(username));
        settings.show('bluetooth');
    });
    context.registerCommand('settings.background', () => {
        context.invoke('launcher.hide');
        native.launch('settings', 'settings.background');
    });
    context.registerCommand('settings.panel', () => {
        context.invoke('launcher.hide');
        native.launch('settings', 'settings.panel');
    });
    context.registerCommand('settings.language', () => {
        context.invoke('launcher.hide');
        if (!settings) settings = new Settings(context, username => switcher.show(username));
        settings.show('language');
    });
    context.registerCommand('settings.time', () => {
        context.invoke('launcher.hide');
        if (!settings) settings = new Settings(context, username => switcher.show(username));
        settings.show('time');
    });
    for (const page of ['vpn', 'hotspot', 'airplane', 'proxy', 'advanced', 'mouse', 'keyboard', 'bluetooth-add', 'printers', 'touchpad', 'accounts', 'system', 'display', 'sound', 'power', 'storage', 'about']) context.registerCommand(`settings.${page}`, () => {
        context.invoke('launcher.hide');
        if (!settings) settings = new Settings(context, username => switcher.show(username));
        settings.show(page);
    });
    // settings.panel is registered above (it opens the native panel settings), so only the clock page is left here.
    for (const page of ['clock']) context.registerCommand(`settings.${page}`, () => {
        context.invoke('launcher.hide');
        if (!settings) settings = new Settings(context, username => switcher.show(username));
        settings.show(`org.devos.${page}`);
    });
    return () => {native.destroy(); context.application.remove_action('devos-switch-user'); switcher.destroy(); settings?.destroy();};
}} satisfies UIExtension;
