#!/bin/sh
printf 'loginctl %s\n' "$*" >> "$SWITCH_LOG"
case "$1" in
 list-sessions)
  echo 'c0 1000 ondev seat0 tty1'
  if [ "$SCENARIO" = full ]; then for vt in 2 3 4 5 6 7 8 9 10 11 12; do echo "v$vt 1001 bob seat0 tty$vt"; done
  else echo 'c1 1001 alice seat0 tty2'; fi ;;
 show-session)
  name=ondev; class=user; seat=seat0; vt=1
  if [ "$2" = c1 ]; then name=alice; vt=2; case "$SCENARIO" in greeter) name=devos-greeter; class=greeter;; other-seat) seat=seat1;; new) name=bob;; esac; fi
  case "$2" in v*) name=bob; vt=${2#v};; esac
  printf 'Name=%s\nSeat=%s\nClass=%s\nType=wayland\nVTNr=%s\nRemote=no\n' "$name" "$seat" "$class" "$vt" ;;
 activate) exit 0;;
 *) exit 1;;
esac
