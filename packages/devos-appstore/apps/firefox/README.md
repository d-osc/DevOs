# Mozilla Firefox

Web browser by Mozilla.

- Publisher: Mozilla
- Official website: [Mozilla Firefox](https://www.mozilla.org/firefox/)
- Official download page: [Download](https://www.mozilla.org/firefox/new/)
- Source checked: 2026-10-27

## Installation status

This app is listed in the DevOs catalog. Automatic installation through DevOsPM is not configured yet. Use the official download page for manual installation. No download-page URL is treated as a binary artifact.

Before enabling `dev install firefox`, add a pinned release, platform/architecture artifacts, verified SHA-256 and file sizes, a supported installation recipe, and launcher entries verified against the installed files.

The icon fallback is a text tile, not the official app logo. Replace it with an approved local PNG when available. LicenseRef values identify vendor-specific terms; they do not grant redistribution rights.

## Direct installer files

Target: Linux ARM64. Format: Debian package (`deb`).

| Platform | Architecture | Format | File | Verification |
| --- | --- | --- | --- | --- |
| linux | arm64 | deb | [Download](https://packages.mozilla.org/apt/pool/mozilla/firefox_158.0.1~build1_arm64_9cfb667797b45d588269f88a64e12d56.deb) | source-only |

Listed in the official Mozilla ARM64 apt Packages index. HTTP HEAD returned 400; file availability and payload remain unverified. DevOs compatibility is untested.

Automatic PM installation remains disabled until the artifact and DevOs runtime compatibility are verified.
