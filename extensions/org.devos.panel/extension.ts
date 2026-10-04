import type {UIExtension} from '../../src/extensions/runtime.js';
import {monitorUI} from '../../src/extensions/monitor-ui.js';
import {Panel} from './index.js';

export default {id: 'org.devos.panel', activate(context) {
    const surfaces = monitorUI(context, monitor => new Panel(context, monitor));
    context.onMessage(message => surfaces.values().forEach(panel => panel.showMessage(message)));
    return surfaces.destroy;
}} satisfies UIExtension;
