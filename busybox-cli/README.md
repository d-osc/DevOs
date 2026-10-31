# busybox-cli

A native multi-call `busybox` written in DevLang (no C, no BusyBox source). Build with `sh busybox-cli/build.sh` (output `build/busybox-cli/busybox`); run `busybox APPLET ARGS` or through a link named after the applet.

## Coverage against BusyBox.html

BusyBox.html lists 297 applets. **138 are implemented (46%); 159 are not.** This is not a complete replacement: full parity is not claimed.

Tests (`tests/busybox-cli.test.dev`) compare most applets with the system tools (stdout and exit status); BusyBox-only behaviour is checked by pattern. Known approximations: no sub-second timestamps, the POSIX regex engine is a backtracking matcher (first match, not longest, for alternation), `printf` has no floating point, `ls` prints one entry per line, `awk` has no `printf %c` for values above 255 and uses `|`/`getline` through temporary files, `ps`/`free`/`uptime` formats are approximations.

### Implemented

ar awk basename cal cat catv chgrp chmod chown chroot cksum clear cmp comm cp cpio cut date dc dd df diff dirname dmesg dos2unix du echo env expand expr false find fold free fsync getopt grep gunzip gzip hd head hexdump hostid hostname id insmod install ionice ipcalc kill killall killall5 length less ln logname ls lsmod md5sum mesg mkdir mkfifo mknod mktemp more mount mountpoint mv nice nohup od patch pgrep pidof pivot_root pkill printenv printf ps pwd rdev readlink realpath renice reset rm rmdir rmmod run-parts runlevel sed seq setarch setsid sha1sum sha256sum sha512sum sleep sort split stat strings sum swapoff swapon sync sysctl tac tail tar taskset tee test time timeout touch tr true tty ttysize umount uname unexpand uniq unix2dos unzip uptime usleep uudecode uuencode watch wc which who whoami xargs yes zcat

### Not implemented

acpid addgroup adduser adjtimex arp arping beep blkid brctl bunzip2 bzcat bzip2 chat chattr chpasswd chpst chrt chvt crond crontab cryptpw deallocvt delgroup deluser devmem dhcprelay dnsd dpkg dumpkmap dumpleases ed eject envdir envuidgid fakeidentd fbset fbsplash fdflush fdformat fdisk findfs flash_lock flash_unlock freeramdisk fsck fsck.minix ftpd ftpget ftpput fuser getty hdparm httpd hwclock ifconfig ifdown ifenslave ifplugd ifup inetd init inotifyd ip ipaddr ipcrm ipcs iplink iproute iprule iptunnel kbd_mode klogd last loadfont loadkmap logger login logread losetup lpd lpq lpr lsattr lzmacat lzop lzopcat makemime man mdev microcom mkdosfs mkfs.minix mkfs.vfat mkpasswd mkswap modprobe mt nameif nc netstat nmeter nslookup openvt passwd ping ping6 popmaildir pscan raidautorun rdate readprofile reformime resize route rpm rpm2cpio rtcwake runsv runsvdir rx script scriptreplay sendmail setconsole setfont setkeycodes setlogcons setuidgid showkey slattach softlimit start-stop-daemon stty su sulogin sv svlogd switch_root syslogd tcpsvd telnet telnetd tftp tftpd top traceroute udhcpc udhcpd udpsvd uncompress unlzma unlzop vconfig vi vlock volname watchdog wget zcip
