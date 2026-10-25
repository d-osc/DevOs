import type {UIExtension} from '@dev-os/core';
import {monitorUI} from '@dev-os/extensions';
import {CareShared, CareOverlay} from './index.js';

export default {id: 'org.devos.displaycare', activate(context) {
    const shared = new CareShared(context);
    const surfaces = monitorUI(context, monitor => new CareOverlay(context, monitor, shared));
    return () => {surfaces.destroy(); shared.destroy();};
}} satisfies UIExtension;
