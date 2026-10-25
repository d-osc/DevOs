import {
    React, GLib, type UIExtension
} from '@dev-os/core';
import {Updates} from '@dev-os/updates';
import {UpdatesView} from './view.js';

const PERIODIC_SECONDS = 3600;
export default {id: 'org.devos.updates', activate(context) {
    const values = () => context.preferences.get('org.devos.updates').state.values;
    const updater = new Updates({repository: () => String(values().repository)});
    context.registerSettingsPage?.('org.devos.updates', () => <UpdatesView updater={updater} preferences={context.preferences} useVersion={context.useInstalledVersion} />);
    // Off by default: no request leaves the computer unless the user turned this on. At most one check per day.
    const timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, PERIODIC_SECONDS, () => {
        if (values().periodicCheck === true) void updater.checkIfDue(24);
        return GLib.SOURCE_CONTINUE;
    });
    return () => { GLib.Source.remove(timer); updater.dispose(); };
}} satisfies UIExtension;
