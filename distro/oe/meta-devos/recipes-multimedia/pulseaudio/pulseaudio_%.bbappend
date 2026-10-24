# Ship the CLI client used by DevOs Sound without pulling in a second audio server.
PACKAGES =+ "pulseaudio-client-tools"
FILES:pulseaudio-client-tools = "${bindir}/pactl"
