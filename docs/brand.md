# Dev OS mark

The official Dev OS icon is `data/icons/devos/devos-mark.svg`: a light rounded rectangle (centre, towards the top-left)
and a small light circle (bottom-right) on a `#242424` square. Do not change its shapes or proportions.

| File | Use |
| --- | --- |
| `data/icons/devos/devos-mark.svg` | Master. App icon, README header, anywhere a full-colour mark fits. |
| `data/icons/devos/devos-mark-currentcolor.svg` | Transparent background, shapes in `currentColor`, for docs and web pages that follow a theme. |
| `data/icons/hicolor/scalable/apps/dev-os.svg` | The master as the `dev-os` theme icon. |
| `data/icons/hicolor/scalable/apps/dev-os-symbolic.svg` | Monochrome `dev-os-symbolic` for the panel and other recoloured UI. |
| `data/icons/hicolor/<16…512>x<…>/apps/dev-os.png` | Raster sizes: 16, 24, 32, 48, 64, 128, 256, 512. |

Regenerate everything but the master with `node tools/maintenance/build-devos-icon.mjs` (no external renderer needed).

Where the shell shows it: the panel menu button and launcher header (`dev-os-symbolic`), the login and OS-login
greeters, the installer sidebar and the About page (`dev-os`), and the boot splash, which draws the same two shapes
in C inside the loading ring in a dim grey so the OLED stays dark. Wallpapers deliberately carry no logo.
`tests/devos-icon.test.ts` checks the master and where it is used.
