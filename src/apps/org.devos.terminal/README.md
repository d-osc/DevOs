# Terminal

Native DevLang + VTE with Chrome-style tabs in the window title bar. Every tab owns a separate PTY, shell, environment, scrollback and working directory. `+` opens a fresh shell in the active shell's actual working directory, without copying its shell variables. Switching or dragging tabs keeps the running shells alive.

A new window starts with one tab in the requested folder (home by default).
The default shell is login Bash, so it loads the system prompt and user startup
files. The prompt follows `username@hostname:directory$ ` for ordinary users and
`root@hostname:directory# ` for root, with `~` at home.

Use the close button or middle mouse button to close a tab. A shell exiting closes only its own tab; the last shell exit closes the window. Copy/paste shortcuts and the themed ANSI palette remain available.

Validation: `d tests/terminal-native.test.dev` and `d tests/native-tabs.test.dev` (real independent PTYs under isolated Xvfb).


Drag a tab outside its window to move it into a separate window. Drag it onto another tab strip from the same app instance to merge it back. The live editor buffer (including unsaved changes and undo), browser view/history, terminal shell/PTY, or Files navigation state moves with the tab. Moving the final tab closes only the empty source window; other windows continue running.
