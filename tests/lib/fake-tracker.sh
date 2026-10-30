#!/bin/sh
# A stand-in for dev-os-window-tracker: prints two desktops and two windows, then logs every command it is sent to $DEVOS_TRACKER_LOG.
cat <<'JSON'
{"type":"connecting"}
{"type":"snap-capability","supported":true,"canResize":true}
{"type":"desktop-begin","canCreate":true,"canRemove":true}
{"type":"desktop","id":1,"name":"Workspace 1","active":true}
{"type":"desktop","id":2,"name":"Mail","active":false}
{"type":"desktop-done"}
{"type":"window","id":11,"title":"Dev OS Terminal","appId":"org.devos.App.terminal.s1","active":true,"minimized":false,"desktop":1}
{"type":"window","id":12,"title":"Notes","appId":"org.example.notes","active":false,"minimized":true,"desktop":1}
{"type":"window","id":13,"title":"Inbox","appId":"org.example.mail","active":false,"minimized":false,"desktop":2}
{"type":"geometry","id":11,"geometry":{"x":0,"y":0,"width":500,"height":600,"output":"o1","area":{"x":0,"y":0,"width":1000,"height":800},"region":"","minWidth":200,"minHeight":100}}
{"type":"geometry","id":12,"geometry":{"x":0,"y":0,"width":500,"height":600,"output":"o1","area":{"x":0,"y":0,"width":1000,"height":800},"region":"","minWidth":200,"minHeight":100}}
JSON
# Like the real tracker, every command is answered by an event line (the window sends its next command only after a line arrives).
while read -r line; do printf '%s\n' "$line" >> "$DEVOS_TRACKER_LOG"; printf '{"type":"ack"}\n'; done
