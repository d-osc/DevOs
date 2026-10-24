#!/bin/sh
set -eu
if gjs -c "imports.gi.versions.Gst='1.0'; imports.gi.Gst;" >/dev/null 2>&1 &&
    gst-inspect-1.0 gtksink >/dev/null 2>&1 && gst-inspect-1.0 pulsesrc >/dev/null 2>&1; then exit 0; fi
if [ "$(id -u)" = 0 ]; then
    apt-get install -y gir1.2-gstreamer-1.0 gstreamer1.0-tools gstreamer1.0-gtk3 gstreamer1.0-plugins-base gstreamer1.0-plugins-good v4l-utils
else
    sudo apt-get install -y gir1.2-gstreamer-1.0 gstreamer1.0-tools gstreamer1.0-gtk3 gstreamer1.0-plugins-base gstreamer1.0-plugins-good v4l-utils
fi
