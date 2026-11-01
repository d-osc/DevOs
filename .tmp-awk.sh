cd /tmp && rm -rf dk && mkdir dk && cd dk
B=/mnt/c/Users/ondev/Projects/DevOs/build/busybox-cli/busybox
mkdir -p pk/DEBIAN pk/usr/bin pk/etc
printf 'Package: demo\nVersion: 1.2-3\nArchitecture: all\nMaintainer: t <t@example.test>\nDescription: a demo package\n' > pk/DEBIAN/control
printf '#!/bin/sh\necho demo\n' > pk/usr/bin/demo; chmod 755 pk/usr/bin/demo; printf 'conf\n' > pk/etc/demo.conf
dpkg-deb -Zgzip --build pk demo.deb > /dev/null
mkdir rootfs
$B dpkg -i --root=rootfs demo.deb; echo rc=$?
find rootfs | head; cat rootfs/var/lib/dpkg/status
