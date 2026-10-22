# Interactive Bash in DevOs Terminal. User startup files can override this.
case $- in
    *i*) if [ -n "${BASH_VERSION:-}" ]; then PS1='\u@\h:\w\$ '; fi ;;
esac
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) PATH="$HOME/.local/bin:$PATH" ;; esac
export PATH
