import type {UIExtension} from '../../src/extensions/runtime.js';
import {Settings} from './index.js';

export default {id: 'org.devos.settings', activate(context) {
    let settings: Settings | undefined;
    context.registerCommand('settings', () => {
        context.invoke('launcher.hide');
        if (settings) settings.show(); else settings = new Settings(context);
    });
    return () => settings?.destroy();
}} satisfies UIExtension;
