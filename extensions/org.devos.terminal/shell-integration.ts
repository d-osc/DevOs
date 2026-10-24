// Private, per-tab Readline bridge. Only Bash's line editor recognises these
// sequences; no screen scraping, command evaluation, or synthetic Enter.
export const QUERY_KEY = '\x1b[97~', ACCEPT_KEY = '\x1b[98~';
export const bashIntegration = String.raw`
if [ -r /etc/profile ]; then . /etc/profile; fi
for __devos_profile in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
    if [ -r "$__devos_profile" ]; then . "$__devos_profile"; break; fi
done
# Colored prompt unless a startup file chose its own: green for a normal user (ends in $), red for the
# administrator (root, ends in #) so admin mode is hard to miss. Output colors follow the terminal scheme.
case "$PS1" in
    '\u@\h:\w\$ '|'\u@\h:\w\# '|'\h:\w\$ '|'\h:\w\# ')
        if [ -n "$TERM" ] && [ "$TERM" != dumb ]; then
            if [ "$(id -u)" = 0 ]; then PS1='\[\e[1;31m\]\u@\h\[\e[0m\]:\[\e[1;34m\]\w\[\e[1;31m\]\$\[\e[0m\] '
            else PS1='\[\e[1;32m\]\u@\h\[\e[0m\]:\[\e[1;34m\]\w\[\e[0m\]\$ '; fi
        fi ;;
esac
if [ -z "$LS_COLORS" ] && command -v dircolors >/dev/null 2>&1; then eval "$(dircolors -b)"; fi
for __devos_tool in ls grep egrep fgrep diff; do
    if ! alias "$__devos_tool" >/dev/null 2>&1 && "$__devos_tool" --color=auto --version >/dev/null 2>&1; then alias "$__devos_tool=$__devos_tool --color=auto"; fi
done
unset __devos_tool
__devos_completion_dir=$DEV_OS_TERMINAL_COMPLETION_DIR
unset DEV_OS_TERMINAL_COMPLETION_DIR
# Readline erases the line before running a bound command and repaints it
# afterwards, so everything inside __devos_query must be instant. Scanning PATH
# there (compgen -A command) made typing flicker; refresh the list here instead,
# in the background, when PATH changes or the list is a minute old.
__devos_refresh_commands() {
    local signature=$PATH
    if [[ "$signature" = "$__devos_commands_signature" && $((SECONDS - __devos_commands_time)) -lt 60 ]]; then return; fi
    __devos_commands_signature=$signature __devos_commands_time=$SECONDS
    ( ( compgen -A command | LC_ALL=C sort -u > "$__devos_completion_dir/commands.next" &&
        command mv -f "$__devos_completion_dir/commands.next" "$__devos_completion_dir/commands" ) 2>/dev/null & )
}
__devos_ready() {
    local result=$?
    local editing=off
    __devos_refresh_commands
    if [[ -o emacs ]]; then editing=emacs; fi
    printf 'ready\0%s\0%s\0' "$PWD" "$editing" > "$__devos_completion_dir/state.next"
    command mv -f "$__devos_completion_dir/state.next" "$__devos_completion_dir/state"
    return "$result"
}
__devos_busy() {
    printf 'busy\0' > "$__devos_completion_dir/state.next"
    command mv -f "$__devos_completion_dir/state.next" "$__devos_completion_dir/state"
}
__devos_query() {
    {
        printf 'input\0%s\0%s\0%s\0' "$READLINE_LINE" "$READLINE_POINT" "$PWD"
        history 100
        printf '\0'
    } > "$__devos_completion_dir/state.next"
    command mv -f "$__devos_completion_dir/state.next" "$__devos_completion_dir/state"
}
__devos_accept() {
    local expected point replacement newpoint
    {
        IFS= read -r -d '' expected
        IFS= read -r -d '' point
        IFS= read -r -d '' replacement
        IFS= read -r -d '' newpoint
    } < "$__devos_completion_dir/accept"
    if [[ "$READLINE_LINE" = "$expected" && "$READLINE_POINT" = "$point" && "$newpoint" =~ ^[0-9]+$ ]]; then
        READLINE_LINE=$replacement
        READLINE_POINT=$newpoint
    fi
}
bind -m emacs-standard -x '"\e[97~": __devos_query'
bind -m emacs-standard -x '"\e[98~": __devos_accept'
PROMPT_COMMAND+=(__devos_ready)
PS0='$(__devos_busy)'"$PS0"
`;
