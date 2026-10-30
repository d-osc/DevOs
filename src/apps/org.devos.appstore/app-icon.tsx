import {Gio, GLib, React, Image} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import type {App} from './backend.js';

const icons = new Map<string, Gio.Icon>();
const escapeXml = (value: string) => value.replace(/[<>&"']/g, char => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'}[char]!));
/** File/byte icons also render before installing the app or refreshing GTK's theme cache. */
export function storeAppIcon(app: App): Gio.Icon {
    const fallback = app.registry?.iconFallback;
    const key = JSON.stringify([app.icon, app.registry?.iconBase64, fallback]);
    const cached = icons.get(key); if (cached) return cached;
    let icon: Gio.Icon | undefined;
    if (app.registry?.iconBase64) icon = Gio.BytesIcon.new(new GLib.Bytes(GLib.base64_decode(app.registry.iconBase64)));
    if (!icon && app.icon && /^[a-zA-Z0-9_-]+$/.test(app.icon)) {
        const path = `${ROOT}/data/icons/hicolor/scalable/apps/${app.icon}.svg`;
        if (GLib.file_test(path, GLib.FileTest.IS_REGULAR)) icon = Gio.FileIcon.new(Gio.File.new_for_path(path));
    }
    if (!icon && fallback) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${fallback.background}"/><text x="32" y="33" dy=".35em" text-anchor="middle" font-family="sans-serif" font-size="${fallback.text.length > 2 ? 18 : 26}" font-weight="700" fill="#fff">${escapeXml(fallback.text)}</text></svg>`;
        icon = Gio.BytesIcon.new(new GLib.Bytes(new TextEncoder().encode(svg)));
    }
    icon ??= Gio.ThemedIcon.new(app.icon || 'application-x-executable-symbolic');
    if (icons.size >= 128) icons.clear();
    icons.set(key, icon); return icon;
}
export function StoreAppIcon({app, size = 40}: {app: App; size?: number}) {
    return <Image id={`app-store-icon-${app.id}`} gicon={storeAppIcon(app)} pixelSize={size} expand/>;
}
