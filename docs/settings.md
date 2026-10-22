# Settings app preferences

Settings → Settings provides a navigation preview and three preferences:

- Compact navigation reduces sidebar row padding after Apply.
- Continue where you left off reopens the last visited page during the current
  desktop session. Explicit Network, Wi-Fi and Bluetooth commands still open
  their requested page. Restarting the desktop resets the remembered page.
- Close with Esc controls whether Escape hides the Settings window. The window
  close button remains available.

Apply persists `org.devos.settings` preferences and updates behavior immediately.
Reset discards unapplied choices. Defaults preserve the previous behavior:
normal navigation density, reopen Desktop, and Escape enabled. Other extension
preferences and the Desktop configuration remain independent.

Validation: `npm run build` and `gjs -m dist/settings-preferences-test.js` in a
GTK-capable Linux session. Tests cover preview isolation, Apply/Reset, the real
sidebar density and search, page tracking and explicit navigation priority.
