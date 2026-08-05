# Security and Privacy

## Local-first boundary

MoeReview is designed for one local machine. The Hub binds to `127.0.0.1` by default and owns local sessions, paper metadata, PDF caches, translations, recommendation behavior, and model calls.

The application does not provide accounts, cloud synchronization, or a hosted multi-user boundary. Do not expose the Hub port through a reverse proxy or LAN port forward unless you have added authentication and understand the risk.

## Secrets

- API Keys are stored in `~/.examforge/secrets.json` and are read by the Hub only.
- The Web UI receives `configured`, not the secret value.
- Quick QA, summaries, translations, and learning calls use the Hub API. They do not store provider keys in `localStorage`.
- Do not commit `.env` files, `secrets.json`, local runtime directories, logs, PDFs, or build output.

## External providers

Paper metadata may be requested from arXiv and Semantic Scholar. AI requests are sent to the provider configured by the user. The provider's retention, logging, and data-processing policy still applies to paper text sent for summaries, translation, or questions.

MoeReview limits injected paper passages and does not inject an entire PDF into a model by default. Source identifiers and passage anchors are retained with saved answers where supported.

## Reporting a vulnerability

Please do not publish credentials, private paper data, or a working exploit in a public issue. Use a private GitHub Security Advisory when enabled, or contact the repository maintainer through the private channel listed in the repository profile. Include the affected version, operating system, reproduction steps, and impact.

## Release hygiene

Before a release, run `npm.cmd run release:check`, inspect `git status`, review the diff, and verify that Release assets contain only the intended installer, portable executable, and promotional video.
