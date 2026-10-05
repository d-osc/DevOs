import {
    type UIExtension
} from '@dev-os/core';
import {monitorUI} from '@dev-os/extensions';
import {Panel} from './index.js';

export default {id: 'org.devos.panel', activate(context) {
    const surfaces = monitorUI(context, monitor => new Panel(context, monitor));
    context.onMessage(message => surfaces.values().forEach(panel => panel.showMessage(message)));
    return surfaces.destroy;
}} satisfies UIExtension;
