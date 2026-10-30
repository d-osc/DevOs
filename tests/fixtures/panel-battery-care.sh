#!/bin/sh
set -eu
printf '%s %s\n' "$1" "${2-}" >> "$PANEL_CARE_CALLS"
if [ -f "$PANEL_CARE_BAD" ]; then echo '{"ok":true,"supported":"bad"}'; exit 0; fi
case "$1" in
    get) ;;
    full)
        if [ -f "$PANEL_CARE_DENIED" ]; then echo '{"ok":false,"error":"Battery permission denied by fixture"}'; exit 1; fi
        printf '%s' "$2" > "$PANEL_CARE_STATE"
        if [ "$2" = off ] && [ "${PANEL_CARE_DENY_AFTER_OFF:-0}" = 1 ]; then touch "$PANEL_CARE_DENIED"; fi
        ;;
    *) echo '{"ok":false,"error":"Invalid fixture action"}'; exit 1 ;;
esac
full=false; remaining=0
if [ "$(cat "$PANEL_CARE_STATE")" = on ]; then full=true; remaining=3661; fi
supported=true; quick=true; care=true
[ ! -f "$PANEL_CARE_UNSUPPORTED" ] || supported=false
[ ! -f "$PANEL_CARE_HIDDEN" ] || quick=false
[ ! -f "$PANEL_CARE_DISABLED" ] || care=false
printf '{"ok":true,"supported":%s,"quick":%s,"care":%s,"full":%s,"remaining":%s,"limit":80}\n' "$supported" "$quick" "$care" "$full" "$remaining"
