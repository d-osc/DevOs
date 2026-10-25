// Loaded only by the processes that use WebKit2; the full core no longer pulls it in.
import GLib from 'gi://GLib?version=2.0';

function isWSL(): boolean {
    if (GLib.getenv('WSL_DISTRO_NAME') || GLib.getenv('WSL_INTEROP')) return true;
    try {return /microsoft/i.test(new TextDecoder().decode(GLib.file_get_contents('/proc/sys/kernel/osrelease')[1]));}
    catch {return false;}
}

export const webKitSoftwareRendering = isWSL() || GLib.getenv('WLR_RENDERER') === 'pixman'
    || ['1', 'true'].includes((GLib.getenv('LIBGL_ALWAYS_SOFTWARE') || '').toLowerCase());
if (webKitSoftwareRendering) {
    // Configure before creating any WebView or starting WebKit child processes.
    // WSLg and the Live image's pixman session use software rendering. Avoid
    // running WebKit's GPU compositor through a software GL driver on those sessions.
    for (const name of ['LIBGL_ALWAYS_SOFTWARE', 'WEBKIT_DISABLE_COMPOSITING_MODE', 'WEBKIT_DISABLE_DMABUF_RENDERER', 'WEBKIT_SKIA_ENABLE_CPU_RENDERING'])
        GLib.setenv(name, '1', true);
}
export {default as WebKit2} from 'gi://WebKit2?version=4.1';
