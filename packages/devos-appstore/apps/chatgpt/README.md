# ChatGPT

Desktop AI assistant by OpenAI.

- Publisher: OpenAI
- Official website: [ChatGPT](https://chatgpt.com/)
- Official download page: [Download](https://chatgpt.com/download/)
- Source checked: 2026-10-27

## Installation status

This app is listed in the DevOs catalog. Automatic installation through DevOsPM is not configured yet. Use the official download page for manual installation. No download-page URL is treated as a binary artifact.

Before enabling `dev install chatgpt`, add a pinned release, platform/architecture artifacts, verified SHA-256 and file sizes, a supported installation recipe, and launcher entries verified against the installed files.

The icon fallback is a text tile, not the official app logo. Replace it with an approved local PNG when available. LicenseRef values identify vendor-specific terms; they do not grant redistribution rights.

## Direct installer files

Target: Linux ARM64. Format: Debian package (`deb`).

| Platform | Architecture | Format | File | Verification |
| --- | --- | --- | --- | --- |
| linux | arm64 | deb | [Download](https://persistent.oaistatic.com/codex-app-prod/linux/deb/latest/chatgpt_arm64.deb) | headers-checked |

Linux ARM64 upstream Debian package. HTTP HEAD checked only; payload, dependencies, executable paths, and DevOs compatibility remain untested. DevOsPM extracts deb without maintainer scripts or dependency resolution.

Automatic PM installation remains disabled until the artifact and DevOs runtime compatibility are verified.
