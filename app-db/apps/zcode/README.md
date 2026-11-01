# ZCode

Agentic development workspace by Z.ai.

- Publisher: Z.ai
- Official website: [ZCode](https://zcode.z.ai/en)
- Official download page: [Download](https://zcode.z.ai/en#all-downloads)
- Source checked: 2026-10-27

## Installation status

This app is listed in the DevOs catalog. Automatic installation through DevOsPM is not configured yet. Use the official download page for manual installation. No download-page URL is treated as a binary artifact.

Before enabling `dev install zcode`, add a pinned release, platform/architecture artifacts, verified SHA-256 and file sizes, a supported installation recipe, and launcher entries verified against the installed files.

The icon fallback is a text tile, not the official app logo. Replace it with an approved local PNG when available. LicenseRef values identify vendor-specific terms; they do not grant redistribution rights.

Identity confirmed by the user: ZCode by Z.ai. Official installation documentation: https://zcode.z.ai/en/docs/install

## Direct installer files

Target: Linux ARM64. Format: Debian package (`deb`).

| Platform | Architecture | Format | File | Verification |
| --- | --- | --- | --- | --- |
| linux | arm64 | deb | [Download](https://cdn-zcode.z.ai/zcode/electron/releases/3.16.3/linux-arm64/ZCode-3.16.3-linux-arm64.deb) | headers-checked |

Linux ARM64 upstream Debian package. HTTP HEAD checked only; payload, dependencies, executable paths, and DevOs compatibility remain untested. DevOsPM extracts deb without maintainer scripts or dependency resolution.

Automatic PM installation remains disabled until the artifact and DevOs runtime compatibility are verified.
