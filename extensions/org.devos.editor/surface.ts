import {Gtk, Gdk, Gio} from '../../src/gtk.js';
import type WebKit2 from '@girs/webkit2-4.1';
import type {EditorConfig, EditorMessage} from './protocol.js';
import {EditorAssets} from './assets.js';
import {tabDetachTarget} from '../../src/window-tabs.js';

export class MonacoSurface {
    view?: WebKit2.WebView;
    ready = false;
    error = '';
    private disposed = false;
    private cancel = new Gio.Cancellable();
    private manager?: WebKit2.UserContentManager;
    private messageSignal = 0;
    private dropCleanup?: () => void;
    constructor(private host: Gtk.Box, private assets: Promise<EditorAssets>,
        private message: (message: EditorMessage) => void, private changed: () => void) { void this.start(); }
    private async start() {
        try {
            const [{default: WebKit}, assets] = await Promise.all([import('gi://WebKit2?version=4.1'), this.assets]);
            if (this.disposed) return;
            const manager = this.manager = new WebKit.UserContentManager();
            this.messageSignal = manager.connect('script-message-received::editor', (_manager, result) => {
                if (this.disposed) return;
                try {
                    const data = JSON.parse((result as WebKit2.JavascriptResult).get_js_value().to_string()) as EditorMessage;
                    if (data.type === 'ready') { this.ready = true; this.changed(); }
                    else if (data.type === 'error') { this.error = String(data.message); this.changed(); }
                    else this.message(data);
                } catch (error) { this.error = String(error); this.changed(); }
            });
            manager.register_script_message_handler('editor');
            const view = this.view = new WebKit.WebView({user_content_manager: manager, hexpand: true, vexpand: true});
            this.dropCleanup = tabDetachTarget(view, undefined, true);
            const color = new Gdk.RGBA(); color.parse('#24292e'); view.set_background_color(color);
            const settings = view.get_settings();
            settings.set_hardware_acceleration_policy(WebKit.HardwareAccelerationPolicy.NEVER);
            settings.set_enable_html5_local_storage(false); settings.set_enable_media_stream(false);
            view.connect('decide-policy', (_view, decision, type) => {
                if (type !== WebKit.PolicyDecisionType.NAVIGATION_ACTION && type !== WebKit.PolicyDecisionType.NEW_WINDOW_ACTION) return false;
                const uri = (decision as WebKit2.NavigationPolicyDecision).get_request().get_uri();
                if (uri === assets.uri || uri === `${assets.uri}index.html`) return false;
                decision.ignore(); return true;
            });
            view.connect('permission-request', (_view, request) => { request.deny(); return true; });
            view.connect('load-failed', (_view, _event, _uri, error) => { if (!this.disposed) { this.error = error.message; this.changed(); } return true; });
            view.connect('web-process-terminated', () => { if (!this.disposed) { this.error = 'The editor process stopped. Close and reopen this tab.'; this.changed(); } });
            this.host.add(view); view.show(); view.load_uri(assets.uri);
        } catch (error) { if (!this.disposed) { this.error = `Editor requires gir1.2-webkit2-4.1. ${String(error)}`; this.changed(); } }
    }
    evaluate(script: string): Promise<string> {
        if (!this.view || !this.ready || this.disposed) return Promise.reject(new Error('Editor is still loading.'));
        return new Promise((resolve, reject) => this.view!.evaluate_javascript(script, -1, null, null, this.cancel, (view, result) => {
            try { resolve(view!.evaluate_javascript_finish(result).to_string()); } catch (error) { reject(error); }
        }));
    }
    configure(config: EditorConfig) { if (this.ready) void this.evaluate(`window.devOsEditor.configure(${JSON.stringify(config)})`).catch(error => { if (!this.disposed) { this.error = String(error); this.changed(); } }); }
    focus() { this.view?.grab_focus(); if (this.ready) void this.evaluate('window.devOsEditor.focus()').catch(() => {}); }
    dispose() {
        this.disposed = true; this.cancel.cancel();
        this.dropCleanup?.(); this.dropCleanup = undefined;
        if (this.manager) { this.manager.disconnect(this.messageSignal); this.manager.unregister_script_message_handler('editor'); }
        this.view?.stop_loading(); this.view?.destroy(); this.view = undefined;
    }
}
