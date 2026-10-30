#!/bin/sh
# A stand-in for dev-os-window-tracker: prints two desktops and two windows, then logs every command it is sent to $DEVOS_TRACKER_LOG.
cat <<'JSON'
{"type":"connecting"}
{"type":"desktop-begin","canCreate":true,"canRemove":true}
{"type":"desktop","id":1,"name":"Workspace 1","active":true}
{"type":"desktop","id":2,"name":"Mail","active":false}
{"type":"desktop-done"}
{"type":"window","id":11,"title":"Dev OS Terminal","appId":"org.devos.App.terminal.s1","active":true,"minimized":false,"desktop":1}
{"type":"window","id":12,"title":"Notes","appId":"org.example.notes","active":false,"minimized":true,"desktop":1}
{"type":"window","id":13,"title":"Inbox","appId":"org.example.mail","active":false,"minimized":false,"desktop":2}
JSON
while read -r line; do printf '%s\n' "$line" >> "$DEVOS_TRACKER_LOG"; done
