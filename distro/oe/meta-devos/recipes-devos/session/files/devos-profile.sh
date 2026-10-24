# Interactive Bash in DevOs Terminal. User startup files can override this.
case $- in
    *i*) if [ -n "${BASH_VERSION:-}" ]; then
        # Green user@host for a normal user ($); red for the administrator (root, #) so admin mode is obvious.
        if [ -n "${TERM:-}" ] && [ "$TERM" != dumb ]; then
            if [ "$(id -u)" = 0 ]; then PS1='\[\e[1;31m\]\u@\h\[\e[0m\]:\[\e[1;34m\]\w\[\e[1;31m\]\$\[\e[0m\] '
            else PS1='\[\e[1;32m\]\u@\h\[\e[0m\]:\[\e[1;34m\]\w\[\e[0m\]\$ '; fi
        else PS1='\u@\h:\w\$ '; fi
        if [ -z "${LS_COLORS:-}" ] && command -v dircolors >/dev/null 2>&1; then eval "$(dircolors -b)"; fi
        for __devos_tool in ls grep egrep fgrep diff; do
            if ! alias "$__devos_tool" >/dev/null 2>&1 && "$__devos_tool" --color=auto --version >/dev/null 2>&1; then alias "$__devos_tool=$__devos_tool --color=auto"; fi
        done
        unset __devos_tool
    fi ;;
esac
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) PATH="$HOME/.local/bin:$PATH" ;; esac
export PATH
