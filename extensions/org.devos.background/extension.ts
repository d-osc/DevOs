import {
    type UIExtension
} from '@dev-os/core';
import {monitorUI} from '@dev-os/extensions';
import {Background} from './index.js';

export default {id: 'org.devos.background', activate(context) {
    return monitorUI(context, monitor => new Background(context, monitor, context.config())).destroy;
}} satisfies UIExtension;
