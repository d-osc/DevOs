# Terminal settings

Settings → Terminal includes a sample output preview (colors follow the Dark/Light
theme, see `docs/theme.md`), font presets and a custom font family/size (6–48), scrollback history
(100–100,000 lines), clickable application hyperlinks, audible bell, following
new output and following typing. Font availability depends on installed fonts;
Pango substitutes a fallback for unavailable families.

Apply saves `org.devos.terminal` preferences. Every existing Terminal window
subscribes to preference changes and updates its VTE widgets without replacing
the terminal, PTY or shell. New tabs use the same preferences, including after
moving tabs between windows. Reset restores the last applied choices. Invalid
font sizes disable Apply. The preview contains sample text and runs no commands.

Defaults preserve Monospace 11, 10,000 scrollback lines, dark colors, clickable
links, no audible bell, scrolling on typing and no forced scrolling on output.
New tabs use a login Bash when the account shell is `/bin/sh`, with the standard
`username@hostname:directory` prompt. Root uses `#`; normal accounts use `$`.
Custom account shells are preserved, and user startup files can override the
prompt. Live images use hostname `devos` and include Git, GitHub CLI and DevLang (no Node.js, nvm, Rust or Python toolchains) plus the local
DevOsPM v0.6.2 CLI as `devospm` and `dev`. Package-manager payloads are built from the
sibling DevOsPM project with its locked dependencies and carry source/binary
checksums. Live home/profile changes remain in the RAM overlay.

Validation: `npm run build`, `gjs -m dist/terminal-settings-test.js` and
`gjs -m dist/extensions-test.js` in a GTK/VTE-capable Linux session. The Terminal
test checks preview isolation, Apply/Reset, invalid fonts and actual VTE font,
background, scrollback, link, bell and scrolling properties.
