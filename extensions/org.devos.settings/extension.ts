import {
    Gio, GLib, type UIExtension
} from '@dev-os/core';
import {UserSwitcher} from './switch-user.js';
import {Settings} from './index.js';

export default {id: 'org.devos.settings', activate(context) {
    let settings: Settings | undefined;
    const switcher = new UserSwitcher(context);
    const switchAction = new Gio.SimpleAction({name: 'devos-switch-user', parameter_type: new GLib.VariantType('s')});
    switchAction.connect('activate', (_action, parameter) => switcher.show(parameter?.get_string()[0] || undefined));
    context.application.add_action(switchAction);
    context.registerCommand('session.switch-user', () => switcher.show());
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
        if (!settings) settings = new Settings(context, username => switcher.show(username));
        settings.show('org.devos.background');
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
    for (const page of ['accounts', 'system', 'display', 'sound', 'power', 'storage', 'about']) context.registerCommand(`settings.${page}`, () => {
        context.invoke('launcher.hide');
        if (!settings) settings = new Settings(context, username => switcher.show(username));
        settings.show(page);
    });
    for (const page of ['panel', 'clock']) context.registerCommand(`settings.${page}`, () => {
        context.invoke('launcher.hide');
        if (!settings) settings = new Settings(context, username => switcher.show(username));
        settings.show(`org.devos.${page}`);
    });
    return () => {context.application.remove_action('devos-switch-user'); switcher.destroy(); settings?.destroy();};
}} satisfies UIExtension;
