import {Gio, GLib} from '../../src/gtk.js';
import {ROOT} from '../../src/config.js';
import type Soup from '@girs/soup-3.0';

// Serve only the bundled editor assets on loopback. Monaco's workers need an
// HTTP origin; file:// pages cannot start the language workers reliably.
export class EditorAssets {
    private constructor(private server: Soup.Server, readonly uri: string) {}
    static async create() {
        const {default: Soup} = await import('gi://Soup?version=3.0');
        const server = new Soup.Server(), token = GLib.uuid_string_random();
        const base = Gio.File.new_for_path(`${ROOT}/dist/editor`);
        if (!base.get_child('index.html').query_exists(null)) throw new Error('Build the Monaco assets with npm run build.');
        server.add_handler(null, (_server, message, path) => {
            if (!['GET', 'HEAD'].includes(message.get_method())) { message.set_status(405, null); return; }
            const relative = path.startsWith(`/${token}/`) ? path.slice(token.length + 2) || 'index.html' : '';
            if (!relative || relative.split('/').some(part => !part || part === '.' || part === '..') || relative.includes('\\')) {
                message.set_status(404, null); return;
            }
            const file = base.resolve_relative_path(relative);
            if (!file.has_prefix(base)) { message.set_status(404, null); return; }
            try {
                const [, bytes] = file.load_contents(null);
                const type = ({html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
                    css: 'text/css; charset=utf-8', ttf: 'font/ttf'} as Record<string, string>)[relative.split('.').pop()!] ?? 'application/octet-stream';
                message.get_response_headers().append('X-Content-Type-Options', 'nosniff');
                message.get_response_headers().append('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; worker-src 'self' blob:; connect-src 'self'");
                message.set_status(200, null); message.set_response(type, Soup.MemoryUse.COPY, bytes);
            } catch { message.set_status(404, null); }
        });
        server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
        return new EditorAssets(server, `http://127.0.0.1:${server.get_uris()[0].get_port()}/${token}/`);
    }
    dispose() { this.server.disconnect(); }
}
