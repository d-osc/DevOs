import {React, Gtk, Gio, GLib, Soup, Image, useEffect, useRef} from '@dev-os/core';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';

const downloads = new Map<number, Promise<GLib.Bytes>>();
function download(id: number): Promise<GLib.Bytes> {
    const existing = downloads.get(id); if (existing) return existing;
    const result = new Promise<GLib.Bytes>((resolve, reject) => {
        const session = new Soup.Session({timeout: 12});
        const message = Soup.Message.new('GET', `https://avatars.githubusercontent.com/u/${id}?s=128&v=4`)!;
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (_source, response) => {
            try {const bytes = session.send_and_read_finish(response); if (message.status_code !== 200 || bytes.get_size() > 2 * 1024 * 1024) throw new Error('Avatar unavailable'); resolve(bytes);}
            catch (error) {reject(error);}
        });
    });
    downloads.set(id, result); void result.catch(() => downloads.delete(id));
    return result;
}

export function AccountAvatar({githubId, size = 40}: {githubId?: number; size?: number}) {
    const ref = useRef<Gtk.Image | null>(null);
    useEffect(() => {
        const widget = ref.current; if (!widget) return;
        widget.set_from_icon_name('avatar-default-symbolic', Gtk.IconSize.DIALOG); widget.set_pixel_size(size);
        if (!githubId || !Number.isSafeInteger(githubId) || githubId <= 0) return;
        let alive = true;
        const path = `${GLib.get_user_cache_dir()}/dev-os/avatars/${githubId}.image`;
        const display = (bytes: GLib.Bytes) => {
            const stream = Gio.MemoryInputStream.new_from_bytes(bytes);
            try {const pixbuf = GdkPixbuf.Pixbuf.new_from_stream_at_scale(stream, size, size, true, null); if (alive && pixbuf) widget.set_from_pixbuf(pixbuf);}
            finally {stream.close(null);}
        };
        try {display(new GLib.Bytes(GLib.file_get_contents(path)[1]));} catch { /* Use the default avatar until the download finishes. */ }
        void download(githubId).then(bytes => {
            if (!alive) return;
            display(bytes);
            try {const file = Gio.File.new_for_path(path); GLib.mkdir_with_parents(file.get_parent()!.get_path()!, 0o700); file.replace_contents(bytes.get_data()!, null, false, Gio.FileCreateFlags.PRIVATE, null);} catch { /* A read-only cache must not prevent displaying the avatar. */ }
        }).catch(() => { /* Cached/default avatar remains usable offline. */ });
        return () => {alive = false;};
    }, [githubId, size]);
    return <Image ref={ref} className="account-avatar" iconName="avatar-default-symbolic" pixelSize={size} widthRequest={size} heightRequest={size} />;
}
