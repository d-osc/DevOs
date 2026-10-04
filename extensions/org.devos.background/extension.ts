import type {UIExtension} from '../../src/extensions/runtime.js';
import {monitorUI} from '../../src/extensions/monitor-ui.js';
import {Background} from './index.js';

export default {id: 'org.devos.background', activate(context) {
    return monitorUI(context, monitor => new Background(context, monitor, context.config())).destroy;
}} satisfies UIExtension;
