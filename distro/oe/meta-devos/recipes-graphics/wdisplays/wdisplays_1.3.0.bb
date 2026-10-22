SUMMARY = "Native Wayland display configuration for DevOs"
HOMEPAGE = "https://github.com/artizirk/wdisplays"
LICENSE = "GPL-3.0-or-later"
LIC_FILES_CHKSUM = "file://COPYING;md5=1c76c4cc354acaac30ed4d5eefea7245"
SRC_URI = "git://github.com/artizirk/wdisplays.git;protocol=https;branch=master;tag=${PV}"
SRCREV = "4879651019ffba6a8974ec08cf3bb3a220ffdd33"
DEPENDS = "gtk+3 libepoxy wayland wayland-native wayland-protocols glib-2.0-native"
inherit meson pkgconfig gtk-icon-cache gsettings
