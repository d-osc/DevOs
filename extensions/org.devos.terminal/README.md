# Terminal suggestions

While typing at a Bash prompt, Terminal offers installed commands (including
aliases/functions), recent Bash history, common subcommands and local paths.
For example, type `sys` or `git st`. The dropdown follows the terminal cursor
and flips above it when space below is limited.

- Up / Down selects a suggestion.
- Tab or a mouse click inserts it without executing anything.
- Enter runs the line as typed; it never silently substitutes a suggestion.
- Escape dismisses the list. Ctrl+Space requests it again.
- Settings → Terminal → Command suggestions enables/disables it for existing tabs.

Suggestions are local and do not contact an AI service. Bash's normal Emacs
Readline mode is supported. Other shells, Vi editing, quoted/complex shell paths
and prompts inside running programs retain their native completion behavior.
Readline reverse search suspends automatic suggestions until the next prompt
or an explicit Ctrl+Space. Standard terminal copy/paste and tab shortcuts remain.

Each Bash tab uses a private temporary directory and a Readline binding to report
the actual line, byte cursor offset, working directory, history and command names.
Completion data comes from Readline rather than being inferred from terminal output.
The rendered row is consulted only to anchor the dropdown during prompt repaint;
no `eval` is used. A second binding inserts text only
if the line and cursor still match the query. Prompt/pre-execution hooks prevent
queries while a foreground application or password prompt is active. Closing a
tab cancels pending work and removes the temporary bridge directory.

The generated Bash init file sources `/etc/profile` and the first available user
login profile, then preserves existing prompt hooks. Existing configuration files
and Bash history files are not rewritten. The terminal does not run completion
scripts or invoke suggested commands to obtain suggestions.

`tests/terminal-completion.test.ts` tests matching, cursor suffixes, a real Bash
PTY, insertion, escaped file names and foreground/password isolation.
