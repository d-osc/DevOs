# busybox-cli

A native multi-call `busybox` written in DevLang (no C, no BusyBox source). Build with `sh busybox-cli/build.sh` (output `build/busybox-cli/busybox`); run `busybox APPLET ARGS` or through a link named after the applet.

## Coverage against BusyBox.html

BusyBox.html lists 297 applets. **228 are implemented (77%); 69 are not.** This is not a complete replacement: full parity is not claimed.

Tests (`tests/busybox-cli.test.dev`) compare most applets with the system tools (stdout and exit status); BusyBox-only behaviour is checked by pattern. Known approximations: no sub-second timestamps, the POSIX regex engine is a backtracking matcher (first match, not longest, for alternation), `printf` has no floating point, `ls` prints one entry per line, `awk` has no `printf %c` for values above 255 and uses `|`/`getline` through temporary files, `ps`/`free`/`uptime` formats are approximations.

### Implemented

addgroup adduser adjtimex ar arp awk basename beep blkid bunzip2 bzcat bzip2 cal cat catv chattr chgrp chmod chown chpasswd chpst chroot chrt chvt cksum clear cmp comm cp cpio crond crontab cryptpw cut date dc dd deallocvt delgroup deluser devmem df diff dirname dmesg dnsd dos2unix dpkg du echo ed eject env envdir envuidgid expand expr false fdflush fdisk find findfs fold free freeramdisk fsync ftpd ftpget ftpput fuser getopt grep gunzip gzip hd head hexdump hostid hostname httpd hwclock id ifconfig ifdown ifup inetd inotifyd insmod install ionice ipcalc ipcrm ipcs kbd_mode kill killall killall5 klogd last length less ln logger login logname ls lsattr lsmod lzmacat md5sum mesg mkdir mkdosfs mkfifo mkfs.vfat mknod mkpasswd mkswap mktemp modprobe more mount mountpoint mv nameif nc netstat nice nohup nslookup od passwd patch pgrep pidof ping pivot_root pkill printenv printf ps pscan pwd raidautorun rdev readlink realpath renice reset rm rmdir rmmod route rpm rpm2cpio run-parts runlevel runsv runsvdir sed seq setarch setconsole setlogcons setsid setuidgid sha1sum sha256sum sha512sum sleep softlimit sort split start-stop-daemon stat strings stty su sum sv svlogd swapoff swapon sync sysctl syslogd tac tail tar taskset tcpsvd tee telnet telnetd test tftp tftpd time timeout top touch tr true tty ttysize umount uname uncompress unexpand uniq unix2dos unlzma unzip uptime usleep uudecode uuencode volname watch watchdog wc wget which who whoami xargs yes zcat

### Not implemented

acpid arping brctl chat dhcprelay dumpkmap dumpleases fakeidentd fbset fbsplash fdformat flash_lock flash_unlock fsck fsck.minix getty hdparm ifenslave ifplugd init ip ipaddr iplink iproute iprule iptunnel loadfont loadkmap logread losetup lpd lpq lpr lzop lzopcat makemime man mdev microcom mkfs.minix mt nmeter openvt ping6 popmaildir rdate readprofile reformime resize rtcwake rx script scriptreplay sendmail setfont setkeycodes showkey slattach sulogin switch_root traceroute udhcpc udhcpd udpsvd unlzop vconfig vi vlock zcip
