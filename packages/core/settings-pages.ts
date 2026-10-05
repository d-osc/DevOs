import {Listeners} from './listeners.js';
import type {ComponentType} from 'react';

// The base stores contributions; extensions own their React page and its services.
export class SettingsPages {
    private pages = new Map<string, ComponentType>();
    private listeners = new Listeners();
    get(id: string) { return this.pages.get(id); }
    register(id: string, page: ComponentType) {
        if (this.pages.has(id)) throw new Error(`Duplicate settings page ${id}`);
        this.pages.set(id, page); this.changed();
        return () => { this.pages.delete(id); this.changed(); };
    }
    subscribe(listener: () => void) { return this.listeners.subscribe(listener); }
    private changed() { this.listeners.emit(); }
}
