# busybox-cli

A native multi-call `busybox` written in DevLang. Production code uses libc system interfaces; it contains no handwritten C or copied BusyBox implementation. Build with `sh busybox-cli/build.sh` (output `build/busybox-cli/busybox`), then run `busybox APPLET ARGS` or use a link named after an applet.

## Coverage against BusyBox.html

The reference inventory contains 297 applets. **297 are implemented (100%); 0 are not.** This measures native entry points against the pinned inventory in `applets.json`, not complete option or behavioral compatibility. This project does not claim to be a drop-in replacement for every BusyBox configuration.

Run `node busybox-cli/coverage.mjs --require-complete` to verify imports, entry points, duplicates and missing applets. `--write` refreshes this inventory. The reference includes legacy applets; extra aliases are not counted toward 297.

## Added implementations

- Terminal and console: `script`, `scriptreplay`, `resize`, `openvt`, keyboard maps/keycodes, PSF/raw fonts, `showkey`, `microcom`, `chat`, `slattach`, and `getty`. Recording/replay preserve binary data; PTY operations restore terminal attributes on handled exits. Replay accepts classic two-column timing files, a typescript path and an optional positive fractional divisor; it neither skips a header nor adds a newline.
- Network administration: IPv4/IPv6 `ip` link/address/route/rule operations and ipip/sit tunnels; bridges, VLANs, bonding ioctls, loopback ICMPv6, UDP/ICMP traceroute, `ifplugd`, `arping` and `zcip`. Link creation includes dummy, bridge, VLAN and veth peers. `zcip` probes, announces, defends and relinquishes conflicting link-local addresses through its configuration script.
- DHCP: native Ethernet transport for `udhcpc` before an interface has an IPv4 address; DISCOVER/OFFER/REQUEST/ACK, NAK, renewal/rebinding, expiry, optional ARP validation, script environments, PID lifecycle, and signal-driven renew/release. `udhcpd` supports an IPv4 pool, reservations, common network options, lease negotiation, ARP conflict probing and persistent leases. `dhcprelay` forwards through separately bound client/server interfaces, increments hops, sets `giaddr`, and matches replies to recent transactions. `dumpleases` reads remaining/absolute expiration times from the BusyBox-compatible timestamp-plus-36-byte-record format.
- `vi`: a native visual editor with insert/replace modes, counted motions, word/line changes and deletions, yank/paste, line joining, literal search, one undo/redo level, scrolling, read-only mode, and basic `:w`, `:q`, `:wq`, `:x`, `:e`, `:r` and `:set` commands. Unsaved changes require confirmation through `:q!`/`:e!`.
- Compression and filesystems: independent LZO1X encoding/decoding with lzop framing/checksums, `mkfs.minix` V1/V2 images including bad-block inode trees, `fsck.minix` structural checking and selected repairs, `fsck` checker orchestration and `man` lookup/formatter invocation.
- Mail/MIME and printing: `makemime`, nested multipart `reformime`, binary-safe transfer encodings, SMTP `sendmail`, POP3-to-Maildir `popmaildir`, connected per-peer `udpsvd`, `fakeidentd`, and RFC 1179 `lpr`/`lpq`/`lpd`. Maildir delivery is committed before server deletion; print jobs stage validated names and publish without overwriting existing files.
- Devices and system services: loop devices, framebuffer modes and PPM splash rendering, floppy formatting, RTC wake alarms, XMODEM receive, tape/flash controls, HDIO/ATA controls, `mdev` scan/hotplug/firmware, ACPI actions, `readprofile`, `nmeter`, `sulogin`, `vlock`, PID-1 `init`, and guarded `switch_root`.
- Logging: `syslogd -C` and `logread` share a semaphore-protected SysV ring compatible with an independently built BusyBox. Owned IPC objects are removed on handled termination.
- Time: `rdate [-s|-p] HOST[:PORT]` uses IPv4 TCP RFC 868 and selects the era nearest the local clock. Print-only modes do not set the clock.

## Verification

Run on Linux with the DevLang toolchain installed:

```sh
sh busybox-cli/build.sh
d tests/busybox-cli.test.dev
node busybox-cli/coverage.mjs --require-complete
```

The main suite checks the original applets and invokes fixtures in `tests/lib/check-*.py`. It requires Python 3, a C compiler for the test-only Linux ioctl fixture, and liblzo2 for independent codec validation. The production executable does not link liblzo2. Compression and protocol compatibility fixtures use an independent BusyBox binary; set `BUSYBOX_ORACLE` when it is not at the fixture's default path. `tests/lib/console-ioctl-fixture.c` is exclusively a test double, compiled against Linux UAPI headers.

Privileged integration checks are separate. For example, from a Linux checkout:

```sh
sudo unshare -mn python3 tests/lib/check-network-admin.py build/busybox-cli/busybox --namespace
sudo unshare -mn python3 tests/lib/check-arp.py build/busybox-cli/busybox --namespace
sudo unshare -mn python3 tests/lib/check-dhcp.py build/busybox-cli/busybox --namespace
sudo python3 tests/lib/check-boot.py build/busybox-cli/busybox --root
```

Namespace fixtures reject the initial host network namespace. DHCP relay tests create a second disposable namespace for the upstream peer. Boot tests create private PID/mount/network namespaces and an ephemeral tmpfs root; they do not run host PID-1 actions. Hardware tests use temporary files and mocked ioctls, not physical disks, framebuffers, flash, floppy drives or RTC wakeups. Additional root fixture modes cover events, authentication, syslog interoperability and temporary device-node creation.

## Compatibility limits

Registration coverage is complete; feature coverage remains partial. Unsupported paths generally return an error, and the tests establish the documented scenarios rather than every combination of flags or every kernel/device driver.

- Existing approximations remain: timestamps omit subseconds; POSIX regex alternation uses first-match rather than longest-match semantics; `printf` lacks floating-point formatting; `ls` is single-column; some `ps`/`free`/`uptime` output differs; `awk` uses temporary files for pipe/getline and does not support `%c` above 255.
- `vi` edits bytes, supports files up to 8 MiB, uses literal searches and one undo/redo level. Full Unicode display widths, regex searches, arbitrary ex commands, macros, registers and multiple buffers are not implemented. Writes go directly to the destination file.
- DHCP is IPv4/Ethernet only. The supported pool spans at most 65,536 addresses with at most 1,024 leases and conservatively excludes host octets 0 and 255. Extended option types, option-overload fields, server-side client-ID lease identity, full syslog integration and all vendor-specific options are not implemented. Relay state is bounded to 1,024 recent transactions and does not chain an already-relayed request. Network configuration is performed by the client script. `zcip` uses fixed probe intervals rather than the complete randomized RFC timing model.
- Network administration and hardware output formats are simplified. Some bonding, virtual-console, carrier-detection and driver-specific behavior has only ioctl-fixture coverage. Real boot, destructive storage operations, physical console locking, setting the clock and actual RTC suspend/wakeup have not been exercised on host hardware.
- LZO compression levels use one fast encoder strategy, not identical compression ratios. Filtered/extra-field lzop containers and LZO RLE extensions are unsupported. Font loading does not install a PSF Unicode table. Framebuffer splash supports P6 PPM and truecolor 16/24/32-bit modes, with a 16-million-pixel limit.
- Minix checking supports 1 KiB zones and at most four million zones; it reports serious orphan/directory corruption rather than attempting every repair. `fsck` needs external `fsck.TYPE` checkers and does not resolve UUID/LABEL entries. `man` needs a formatter such as mandoc/nroff and supports plain/gzip input.
- MIME does not fully implement RFC 2231 filenames or recursively decode message/rfc822. Mail clients do not provide built-in TLS; use an appropriate connection helper. Printing permits at most 26 files, 64 MiB per file and 256 MiB per job, with one job per connection. A failed delivery helper retains the spooled job.
- Authentication accepts DevOS-supported `$1$`, `$5$` and `$6$` crypt hashes. Full PAM/shadow policy integration is outside the implementation. Test account/device/sysfs roots are ignored across a setuid boundary.

### Registered applets

acpid addgroup adduser adjtimex ar arp arping awk basename beep blkid brctl bunzip2 bzcat bzip2 cal cat catv chat chattr chgrp chmod chown chpasswd chpst chroot chrt chvt cksum clear cmp comm cp cpio crond crontab cryptpw cut date dc dd deallocvt delgroup deluser devmem df dhcprelay diff dirname dmesg dnsd dos2unix dpkg du dumpkmap dumpleases echo ed eject env envdir envuidgid expand expr fakeidentd false fbset fbsplash fdflush fdformat fdisk find findfs flash_lock flash_unlock fold free freeramdisk fsck fsck.minix fsync ftpd ftpget ftpput fuser getopt getty grep gunzip gzip hd hdparm head hexdump hostid hostname httpd hwclock id ifconfig ifdown ifenslave ifplugd ifup inetd init inotifyd insmod install ionice ip ipaddr ipcalc ipcrm ipcs iplink iproute iprule iptunnel kbd_mode kill killall killall5 klogd last length less ln loadfont loadkmap logger login logname logread losetup lpd lpq lpr ls lsattr lsmod lzmacat lzop lzopcat makemime man md5sum mdev mesg microcom mkdir mkdosfs mkfifo mkfs.minix mkfs.vfat mknod mkpasswd mkswap mktemp modprobe more mount mountpoint mt mv nameif nc netstat nice nmeter nohup nslookup od openvt passwd patch pgrep pidof ping ping6 pivot_root pkill popmaildir printenv printf ps pscan pwd raidautorun rdate rdev readlink readprofile realpath reformime renice reset resize rm rmdir rmmod route rpm rpm2cpio rtcwake run-parts runlevel runsv runsvdir rx script scriptreplay sed sendmail seq setarch setconsole setfont setkeycodes setlogcons setsid setuidgid sha1sum sha256sum sha512sum showkey slattach sleep softlimit sort split start-stop-daemon stat strings stty su sulogin sum sv svlogd swapoff swapon switch_root sync sysctl syslogd tac tail tar taskset tcpsvd tee telnet telnetd test tftp tftpd time timeout top touch tr traceroute true tty ttysize udhcpc udhcpd udpsvd umount uname uncompress unexpand uniq unix2dos unlzma unlzop unzip uptime usleep uudecode uuencode vconfig vi vlock volname watch watchdog wc wget which who whoami xargs yes zcat zcip

### Not implemented

None.
