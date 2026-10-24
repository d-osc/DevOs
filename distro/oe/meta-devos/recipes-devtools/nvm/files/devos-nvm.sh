# nvm for interactive Bash. Loaded on first use of nvm/node/npm/npx so shell start-up stays fast.
case $- in
    *i*) if [ -n "${BASH_VERSION:-}" ] && [ -r /usr/share/nvm/nvm.sh ]; then
        export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
        __devos_nvm_load() {
            unset -f nvm node npm npx __devos_nvm_load
            mkdir -p "$NVM_DIR" 2>/dev/null
            [ -e "$NVM_DIR/nvm-exec" ] || ln -s /usr/share/nvm/nvm-exec "$NVM_DIR/nvm-exec" 2>/dev/null
            . /usr/share/nvm/nvm.sh
            [ -r /usr/share/nvm/bash_completion ] && . /usr/share/nvm/bash_completion
        }
        nvm() { __devos_nvm_load; nvm "$@"; }
        node() { __devos_nvm_load; command node "$@"; }
        npm() { __devos_nvm_load; command npm "$@"; }
        npx() { __devos_nvm_load; command npx "$@"; }
    fi ;;
esac
