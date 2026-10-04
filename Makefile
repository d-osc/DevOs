PREFIX ?= $(HOME)/.local

.PHONY: build check doctor run smoke install

build:
	npm run build
	sh tools/bootstrap-window-tracker.sh

check: build
	gjs -m dist/config-test.js
	gjs -m dist/extensions-test.js

doctor:
	sh bin/dev-os-shell doctor

run: build
	chmod +x bin/*
	bin/dev-os-session --nested

smoke: build
	python3 tools/smoke.py

install: build
	python3 tools/install.py --prefix "$(PREFIX)"

