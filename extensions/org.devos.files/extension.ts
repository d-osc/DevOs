import type {UIExtension} from '../../src/extensions/runtime.js';
import {Files} from './index.js';

export default {id: 'org.devos.files', activate(context) {
    const windows = new Set<Files>();
    const closed = (files: Files) => windows.delete(files);
    const opened = (files: Files) => windows.add(files);
    context.registerCommand('files', () => {
        context.invoke('launcher.hide');
        const files = [...windows].at(-1);
        if (files) files.show(); else new Files(context, closed, {opened});
    });
    context.onReload(() => { for (const files of windows) files.update(); });
    return () => { for (const files of [...windows]) files.destroy(); };
}} satisfies UIExtension;
