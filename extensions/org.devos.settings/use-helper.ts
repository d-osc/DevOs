import {GLib, useEffect, useRef, useState} from '@dev-os/core';
export interface HelperControls<State, Action extends string> {request(action: Action, ...args: string[]): Promise<State>; destroy(): void;}
/**
 * State of a card backed by a helper (see HelperClient): loads on mount, polls every `pollSeconds`, and runs one request at a time.
 * `nonce` changes after a failed request so switches and radios remount in the state the helper really has.
 */
export function useHelper<State, Action extends string>(controls: HelperControls<State, Action> | undefined, create: () => HelperControls<State, Action>, initial: State, pollSeconds: number) {
    const [backend] = useState(() => controls ?? create());
    const [state, setState] = useState<State>(initial), [ready, setReady] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState(''), [nonce, setNonce] = useState(0);
    const alive = useRef(true), working = useRef(false);
    const request = async (action: Action, ...args: string[]) => {
        if (working.current) return; working.current = true;
        setBusy(true); setError('');
        try {const next = await backend.request(action, ...args); if (alive.current) {setState(next); setReady(true);}}
        catch (reason) {if (alive.current) {setError(reason instanceof Error ? reason.message : String(reason)); setNonce(value => value + 1); setReady(true);}}
        finally {working.current = false; if (alive.current) setBusy(false);}
    };
    useEffect(() => {
        alive.current = true; void request('get' as Action);
        const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, pollSeconds, () => {if (alive.current && !working.current) void request('get' as Action); return GLib.SOURCE_CONTINUE;});
        return () => {alive.current = false; GLib.source_remove(timer); backend.destroy();};
    }, [backend]);
    return {state, ready, busy, error, nonce, request};
}
