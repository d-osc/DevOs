# busybox-cli

A native multi-call `busybox` written in DevLang (no C, no BusyBox source). Build with `sh busybox-cli/build.sh` (output `build/busybox-cli/busybox`); run `busybox APPLET ARGS` or through a link named after the applet.

## Coverage against BusyBox.html

BusyBox.html lists 297 applets. **115 are implemented (39%); 182 are not.** This is not a complete replacement: full parity is not claimed.

Tests (`tests/busybox-cli.test.dev`) compare most applets with the system tools (stdout and exit status); BusyBox-only behaviour is checked by pattern. Known approximations: no sub-second timestamps, POSIX regex is a backtracking matcher (first match, not longest, for alternation), `printf` has no floating point, `ls` prints one entry per line, `ps`/`free`/`uptime` formats are approximations.

### Implemented

basename cal cat chgrp chmod chown chroot cksum clear cmp comm cp cut date dd df diff dirname dos2unix du echo env expand expr false find fold free fsync grep gunzip gzip hd head hexdump hostid hostname id install ionice kill killall length less ln logname ls lsmod md5sum mesg mkdir mkfifo mknod mktemp more mountpoint mv nice nohup od patch pgrep pidof pkill printenv printf ps pwd readlink realpath renice reset rm rmdir runlevel sed seq setsid sha1sum sha256sum sha512sum sleep sort split stat strings sum sync sysctl tac tail tar tee test time timeout touch tr true tty uname unexpand uniq unix2dos uptime usleep uudecode uuencode watch wc which whoami xargs yes zcat

### Not implemented

acpid addgroup adduser adjtimex ar arp arping awk beep blkid brctl bunzip2 bzcat bzip2 catv chat chattr chpasswd chpst chrt chvt cpio crond crontab cryptpw dc deallocvt delgroup deluser devmem dhcprelay dmesg dnsd dpkg dumpkmap dumpleases ed eject envdir envuidgid fakeidentd fbset fbsplash fdflush fdformat fdisk findfs flash_lock flash_unlock freeramdisk fsck fsck.minix ftpd ftpget ftpput fuser getopt getty hdparm httpd hwclock ifconfig ifdown ifenslave ifplugd ifup inetd init inotifyd insmod ip ipaddr ipcalc ipcrm ipcs iplink iproute iprule iptunnel kbd_mode killall5 klogd last loadfont loadkmap logger login logread losetup lpd lpq lpr lsattr lzmacat lzop lzopcat makemime man mdev microcom mkdosfs mkfs.minix mkfs.vfat mkpasswd mkswap modprobe mount mt nameif nc netstat nmeter nslookup openvt passwd ping ping6 pivot_root popmaildir pscan raidautorun rdate rdev readprofile reformime resize rmmod route rpm rpm2cpio rtcwake run-parts runsv runsvdir rx script scriptreplay sendmail setarch setconsole setfont setkeycodes setlogcons setuidgid showkey slattach softlimit start-stop-daemon stty su sulogin sv svlogd swapoff swapon switch_root syslogd taskset tcpsvd telnet telnetd tftp tftpd top traceroute ttysize udhcpc udhcpd udpsvd umount uncompress unlzma unlzop unzip vconfig vi vlock volname watchdog wget who zcip
