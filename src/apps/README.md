# System apps

Built-in apps live here, each under its stable `org.devos.*` ID. Desktop infrastructure such as Panel, Display Care and Background lives in `src/system/`. Their `extension.json` manifests retain `system: true` and the existing compiled entry names.

Optional packages live in `src/extensions/`. The system loader scans `src/apps/` and `src/system/`; the preferences catalog presents separate System, System Apps and Extensions groups. Existing user settings and package IDs are preserved.

The build, release packages, WSL staging and installed runtime all include this directory.
