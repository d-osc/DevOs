# busybox-cli

A native multi-call `busybox` written in DevLang (no C, no BusyBox source). Build with `sh busybox-cli/build.sh` (output `build/busybox-cli/busybox`); run `busybox APPLET ARGS` or through a link named after the applet.

## Coverage against BusyBox.html

BusyBox.html lists 297 applets. **202 are implemented (68%); 95 are not.** This is not a complete replacement: full parity is not claimed.

Tests (`tests/busybox-cli.test.dev`) compare most applets with the system tools (stdout and exit status); BusyBox-only behaviour is checked by pattern. Known approximations: no sub-second timestamps, the POSIX regex engine is a backtracking matcher (first match, not longest, for alternation), `printf` has no floating point, `ls` prints one entry per line, `awk` has no `printf %c` for values above 255 and uses `|`/`getline` through temporary files, `ps`/`free`/`uptime` formats are approximations.

### Implemented

addgroup adduser ar arp awk basename blkid bunzip2 bzcat bzip2 cal cat catv chgrp chmod chown chpasswd chpst chroot cksum clear cmp comm cp cpio crond crontab cryptpw cut date dc dd delgroup deluser df diff dirname dmesg dos2unix du echo ed env envdir envuidgid expand expr false find findfs fold free fsync ftpget ftpput fuser getopt grep gunzip gzip hd head hexdump hostid hostname httpd id ifconfig ifdown ifup inetd inotifyd insmod install ionice ipcalc ipcrm ipcs kill killall killall5 klogd length less ln logger login logname ls lsattr lsmod lzmacat md5sum mesg mkdir mkdosfs mkfifo mkfs.vfat mknod mkpasswd mkswap mktemp more mount mountpoint mv nc netstat nice nohup nslookup od passwd patch pgrep pidof ping pivot_root pkill printenv printf ps pscan pwd rdev readlink realpath renice reset rm rmdir rmmod route rpm2cpio run-parts runlevel runsv runsvdir sed seq setarch setsid setuidgid sha1sum sha256sum sha512sum sleep softlimit sort split start-stop-daemon stat strings su sum sv svlogd swapoff swapon sync sysctl syslogd tac tail tar taskset tcpsvd tee telnet telnetd test tftp tftpd time timeout top touch tr true tty ttysize umount uname uncompress unexpand uniq unix2dos unlzma unzip uptime usleep uudecode uuencode watch wc wget which who whoami xargs yes zcat

### Not implemented

acpid adjtimex arping beep brctl chat chattr chrt chvt deallocvt devmem dhcprelay dnsd dpkg dumpkmap dumpleases eject fakeidentd fbset fbsplash fdflush fdformat fdisk flash_lock flash_unlock freeramdisk fsck fsck.minix ftpd getty hdparm hwclock ifenslave ifplugd init ip ipaddr iplink iproute iprule iptunnel kbd_mode last loadfont loadkmap logread losetup lpd lpq lpr lzop lzopcat makemime man mdev microcom mkfs.minix modprobe mt nameif nmeter openvt ping6 popmaildir raidautorun rdate readprofile reformime resize rpm rtcwake rx script scriptreplay sendmail setconsole setfont setkeycodes setlogcons showkey slattach stty sulogin switch_root traceroute udhcpc udhcpd udpsvd unlzop vconfig vi vlock volname watchdog zcip
