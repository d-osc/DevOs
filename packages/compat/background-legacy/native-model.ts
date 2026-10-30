import {GLib, wallpaperColors, onThemeChange, type UIContext, type GdkTypes} from '@dev-os/core';
import type {WallpaperConfig} from './wallpaper.js';
import {NativeModel} from '../native-model.js';

export interface BackgroundModelView {index: number; monitor: {x:number;y:number;width:number;height:number}; config: WallpaperConfig; paused: boolean; interval: number;}
export class BackgroundModel {
    private worker: NativeModel;
    private views: BackgroundModelView[] = [];
    private listeners = new Set<() => void>();
    private cleanup: (() => void)[] = [];
    private timer: number;
    private ready = false;
    private signature = '';
    private requestSignature = '';
    constructor(private context: UIContext) {
        this.worker = new NativeModel('src/system/org.devos.background/service.dev', value => {
            if (!Array.isArray(value.views)) return;
            const signature = JSON.stringify(value.views);
            if (this.ready && signature === this.signature) return;
            this.signature = signature;
            this.views = value.views;
            if (!this.ready && GLib.getenv('DEVOS_SYSTEM_TRACE')) print('DevOs background DevLang model ready');
            this.ready = true;
            for (const listener of this.listeners) listener();
        });
        this.cleanup.push(context.preferences.subscribe(() => this.refresh()), onThemeChange(() => this.refresh()));
        const windows = context.windows?.subscribe(() => this.refresh()); if (windows) this.cleanup.push(windows);
        this.timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {this.refresh(true); return GLib.SOURCE_CONTINUE;});
        this.refresh();
    }
    refresh(force = false) {
        const monitors = this.context.monitors().map(monitor => {const r = monitor.get_geometry(); return {x:r.x,y:r.y,width:r.width,height:r.height};});
        const {mode,style,fit,imagePath,useDesktopColor,color} = this.context.preferences.get('org.devos.background').state.values;
        const windows = (this.context.windows?.state ?? []).map(({minimized,maximized,fullscreen,desktop,sticky,geometry}) => ({minimized,maximized,fullscreen,desktop,sticky,geometry}));
        const desktops = (this.context.windows?.desktops ?? []).map(({id,active}) => ({id,active}));
        const snapshot = {config:{name:this.context.config().name,...wallpaperColors()},values:{mode,style,fit,imagePath,useDesktopColor,color},monitors,windows,desktops};
        const signature = JSON.stringify(snapshot);
        if (!force && signature === this.requestSignature) return;
        this.requestSignature = signature;
        this.worker.submit(snapshot);
    }
    view(monitor: GdkTypes.Monitor): BackgroundModelView | undefined {
        const r = monitor.get_geometry();
        return this.views.find(({monitor:m}) => m.x===r.x && m.y===r.y && m.width===r.width && m.height===r.height);
    }
    subscribe(listener: () => void): () => void {this.listeners.add(listener); return () => this.listeners.delete(listener);}
    destroy() {GLib.source_remove(this.timer); this.cleanup.forEach(stop => stop()); this.worker.destroy(); this.listeners.clear();}
}
