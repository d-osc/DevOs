# busybox-cli

A native multi-call `busybox` written in DevLang (no C, no BusyBox source). Build with `sh busybox-cli/build.sh` (output `build/busybox-cli/busybox`); run `busybox APPLET ARGS` or through a link named after the applet.

## Coverage against BusyBox.html

BusyBox.html lists 297 applets. **172 are implemented (58%); 125 are not.** This is not a complete replacement: full parity is not claimed.

Tests (`tests/busybox-cli.test.dev`) compare most applets with the system tools (stdout and exit status); BusyBox-only behaviour is checked by pattern. Known approximations: no sub-second timestamps, the POSIX regex engine is a backtracking matcher (first match, not longest, for alternation), `printf` has no floating point, `ls` prints one entry per line, `awk` has no `printf %c` for values above 255 and uses `|`/`getline` through temporary files, `ps`/`free`/`uptime` formats are approximations.

### Implemented

addgroup adduser ar arp awk basename blkid bunzip2 bzcat bzip2 cal cat catv chgrp chmod chown chpst chroot cksum clear cmp comm cp cpio crontab cut date dc dd delgroup deluser df diff dirname dmesg dos2unix du echo ed env envdir envuidgid expand expr false find findfs fold free fsync ftpget ftpput fuser getopt grep gunzip gzip hd head hexdump hostid hostname httpd id ifconfig inotifyd insmod install ionice ipcalc kill killall killall5 length less ln logname ls lsattr lsmod md5sum mesg mkdir mkfifo mknod mkswap mktemp more mount mountpoint mv nc netstat nice nohup nslookup od patch pgrep pidof ping pivot_root pkill printenv printf ps pwd rdev readlink realpath renice reset rm rmdir rmmod route rpm2cpio run-parts runlevel sed seq setarch setsid setuidgid sha1sum sha256sum sha512sum sleep softlimit sort split stat strings sum swapoff swapon sync sysctl tac tail tar taskset tee telnet test time timeout top touch tr true tty ttysize umount uname unexpand uniq unix2dos unzip uptime usleep uudecode uuencode watch wc wget which who whoami xargs yes zcat

### Not implemented

acpid adjtimex arping beep brctl chat chattr chpasswd chrt chvt crond cryptpw deallocvt devmem dhcprelay dnsd dpkg dumpkmap dumpleases eject fakeidentd fbset fbsplash fdflush fdformat fdisk flash_lock flash_unlock freeramdisk fsck fsck.minix ftpd getty hdparm hwclock ifdown ifenslave ifplugd ifup inetd init ip ipaddr ipcrm ipcs iplink iproute iprule iptunnel kbd_mode klogd last loadfont loadkmap logger login logread losetup lpd lpq lpr lzmacat lzop lzopcat makemime man mdev microcom mkdosfs mkfs.minix mkfs.vfat mkpasswd modprobe mt nameif nmeter openvt passwd ping6 popmaildir pscan raidautorun rdate readprofile reformime resize rpm rtcwake runsv runsvdir rx script scriptreplay sendmail setconsole setfont setkeycodes setlogcons showkey slattach start-stop-daemon stty su sulogin sv svlogd switch_root syslogd tcpsvd telnetd tftp tftpd traceroute udhcpc udhcpd udpsvd uncompress unlzma unlzop vconfig vi vlock volname watchdog zcip
