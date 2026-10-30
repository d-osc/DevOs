import {useEffect, useState} from '@dev-os/core';
import {appService} from '@dev-os/runtime/app-service';

/** Views send input/selection intent and render the service's prepared result. */
export function useDataView<T>(kind: string, input: unknown, initial: T, dependencies: unknown[]): T {
    const [view, setView] = useState(initial);
    useEffect(() => {
        let alive = true;
        void appService().request('project', [kind, input]).then(value => {if (alive) setView(value);}, error => {
            if (alive) printerr(`Dev OS ${kind} data view: ${String(error)}`);
        });
        return () => {alive = false;};
    }, dependencies);
    return view;
}
