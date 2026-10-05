export class Listeners {
    private callbacks = new Set<() => void>();
    subscribe(callback: () => void): () => void {
        this.callbacks.add(callback);
        return () => { this.callbacks.delete(callback); };
    }
    emit(onError?: (error: unknown) => void): void {
        for (const callback of this.callbacks) {
            try { callback(); }
            catch (error) { if (onError) onError(error); else throw error; }
        }
    }
    clear(): void { this.callbacks.clear(); }
}
