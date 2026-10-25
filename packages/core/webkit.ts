// Loaded only by the processes that use WebKit2; the full core no longer pulls it in.
import GLib from 'gi://GLib?version=2.0';

function isWSL(): boolean {
    if (GLib.getenv('WSL_DISTRO_NAME') || GLib.getenv('WSL_INTEROP')) return true;
    try {return /microsoft/i.test(new TextDecoder().decode(GLib.file_get_contents('/proc/sys/kernel/osrelease')[1]));}
    catch {return false;}
}

export const webKitSoftwareRendering = isWSL();
if (webKitSoftwareRendering) {
    // Configure before creating any WebView or starting WebKit child processes.
    // WSLg does not guarantee access to Linux DRM devices. Keep web rendering
    // on the CPU instead of repeatedly trying unsupported EGL/DMABUF paths.
    for (const name of ['LIBGL_ALWAYS_SOFTWARE', 'WEBKIT_DISABLE_COMPOSITING_MODE', 'WEBKIT_DISABLE_DMABUF_RENDERER', 'WEBKIT_SKIA_ENABLE_CPU_RENDERING'])
        GLib.setenv(name, '1', true);
}
export {default as WebKit2} from 'gi://WebKit2?version=4.1';
