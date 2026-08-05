# GitHub Release Checklist

## Local preflight

1. Run `npm.cmd run release:check`.
2. Run `npm.cmd run build:desktop` on Windows.
3. Confirm the release directory contains the installer, portable executable, and portable ZIP.
4. Confirm `promo-video/renders/moereview-product-intro.mp4` is the intended final video.
5. Review `git status --short --branch` and `git diff --cached --check` before committing.

## Source repository

- Commit source, docs, lockfiles, CI, and packaging scripts.
- Do not commit `release/`, `node_modules/`, `web/dist/`, `mcp-server/dist/`, `desktop/package-resources/`, `~/.examforge/`, PDFs, runtime logs, or generated video.
- Create a version tag such as `v0.1.0` after the source commit.

## Release assets

Upload these files to the GitHub Release, not to the source tree:

- `release/MoeReview-0.1.0-x64.exe`
- `release/MoeReview-0.1.0-portable.exe`
- `release/MoeReview-0.1.0-portable.zip`
- `promo-video/renders/moereview-product-intro.mp4`

The installer and portable executable use Electron's default icon until a distributable project icon is added. This is cosmetic and does not affect runtime behavior.
