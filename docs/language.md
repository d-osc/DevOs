# Language and keyboard input

Settings → Language manages keyboard input languages. The initial list is
English (US) and Thai (Kedmanee), switched with **Alt + Shift**.
Add or remove languages and move a language up to change the default/order.
One to four different layouts are supported: US/UK English, Thai, German,
French and Spanish. The last layout cannot be removed.

Choose Alt + Shift, Super + Space, Ctrl + Shift, or Caps Lock as the switch
shortcut. Caps Lock then switches language instead of changing letter case.
When Super + Space is selected with multiple languages, DevOs removes the
conflicting Applications binding from this session's generated compositor
configuration. Applications remains accessible from Super or the panel button.
Choosing another shortcut restores the original binding.

The panel shows the active keyboard language (EN, TH, DE, FR or ES) next to
the device/status controls. Click it to select a language or open Language
settings. The indicator reads the compositor's live keymap/group through
version 4 of the private DevOs protocol, so shortcut changes update every panel
too. It does not reorder languages or change the saved startup default.
Selecting a language changes the live keyboard group without reloading the
session. An older compositor shows an unavailable indicator with access to
Language settings until the full DevOs session is restarted.

Apply saves `~/.config/dev-os/language.json` (respecting `XDG_CONFIG_HOME`) and
reloads only this session's labwc through its `LABWC_PID`. No root access is
needed. The typing field lets you try the applied layout. The first language
is used at session startup; settings do not translate the desktop interface.
The desktop image includes XKB keyboard data and TLWG fonts for Thai.

The session prepares a private config inside `XDG_RUNTIME_DIR` and exports
`DEV_OS_COMPOSITOR_CONFIG`. Shipped compositor files are preserved. Reconfigure
uses XKB layouts, explicit basic variants and group-toggle options, and retains
the live desktop list so language changes do not remove dynamic desktops.
Preferences survive restarts; a malformed file is preserved with safe startup
defaults and can be repaired by applying choices in Language settings.

Start a new DevOs session once after upgrading to this version. Existing
sessions created without the generated-config support save changes for their
next session. On WSL or a VM, the host must forward the chosen shortcut to DevOs.

Open this page directly with `dev-os-shell language`.

Validation:

- `npm run build`
- `python3 tests/language.test.py`
- `cc tests/language-keymap.c $(pkg-config --cflags --libs xkbcommon) -o build/language-keymap-test && build/language-keymap-test`
- `gjs -m dist/language-settings-test.js`
- `gjs -m dist/panel-language-test.js` verifies the indicator, selection,
  external changes, settings action and subscription cleanup.
- `d tools/test/language-smoke.dev --` verifies private-session Apply/reload,
  shortcut conflicts and preservation of five live desktops. XKB tests verify
  all four shortcuts produce English/Thai text; physical keyboard/host shortcut
  forwarding still needs hardware validation.

The integration follows [labwc's keyboard environment configuration](https://labwc.github.io/labwc-config.5.html).

`dev-os-language` runs with DevLang `d` 0.5.5+. Session startup and Settings invoke
`d bin/dev-os-language -- ...`; preferences and generated configuration files
are replaced atomically. The `lib/` modules are included in installed and staged
runtimes. The Python integration harness executes this DevLang helper directly.
