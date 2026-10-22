PREFIX ?= $(HOME)/.local

.PHONY: build check doctor run smoke install base base-test distro-check distro-image

base:
	bash distro/base/build.sh

base-test:
	bash distro/base/test-qemu.sh

distro-check:
	bash distro/oe/build.sh --parse

distro-image:
	bash distro/oe/build.sh --build

build:
	npm run build
	sh tools/setup/bootstrap-window-tracker.sh

check: build
	gjs -m dist/config-test.js
	gjs -m dist/extensions-test.js

doctor:
	sh bin/dev-os-shell doctor

run: build
	chmod +x bin/*
	bin/dev-os-session --nested

smoke: build
	d tools/test/smoke.dev --

install: build
	d tools/maintenance/install.dev -- --prefix "$(PREFIX)"

