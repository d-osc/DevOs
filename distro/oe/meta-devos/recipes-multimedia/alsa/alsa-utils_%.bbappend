BBCLASSEXTEND += "native"
PACKAGECONFIG:class-native = ""
DEPENDS:remove:class-native = "libsamplerate0 libsamplerate0-native"
EXTRA_OECONF:append:class-native = " --disable-alsaloop --disable-alsamixer --disable-bat --disable-alsaconf"
