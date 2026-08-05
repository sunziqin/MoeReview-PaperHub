# MoeReview

<p align="center">
  <strong>A local-first paper discovery, Chinese reading, and deep-study workspace.</strong><br />
  Discover papers first, understand them in plain language, then study only when you are ready.
</p>

<p align="center">English · <a href="./README.md">简体中文</a></p>

<p align="center">
  <img alt="Node.js >= 18" src="https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/react-19-61DAFB?logo=react&logoColor=111" />
  <img alt="Electron" src="https://img.shields.io/badge/electron-windows-47848F?logo=electron&logoColor=white" />
  <img alt="Local first" src="https://img.shields.io/badge/storage-local--first-blue" />
  <img alt="License: GPL v3" src="https://img.shields.io/badge/license-GPLv3-blue" />
</p>

MoeReview is a local Windows paper platform that connects discovery, readable Chinese explanations, source-grounded reading, and optional active study in one workflow.

## Features

- Personalized paper feed with interest channels, latest work, LLM, computer vision, reinforcement learning, and explainable local ranking.
- Chinese or English keyword search with author, source, topic, and browser speech input.
- One-click plain-language summaries that preserve `中文术语（English keyword）` for important technical terms.
- Source, Chinese, and bilingual reading modes with persistent translation and summary caches keyed by paper, model, and prompt fingerprints.
- Original PDF access for figures, tables, charts, equations, and page layout, plus source-anchored extracted sections for translation and questions.
- Favorites, read-later, browsing history, reading progress, and study sessions.
- Optional study mode with paper analysis, chapter explanations, selected-text QA, glossary, knowledge cards, and quizzes.
- One settings center for AI services, providers, reading, translation, recommendations, themes, navigation, and local data.
- Four translation tiers with configurable scope, concurrency, and prompts. The maximum tier processes papers already known to the local library; it does not crawl the internet.
- Optional MCP compatibility adapter. The Web UI and study flow call the Hub API directly and do not require MCP.
- Windows NSIS installer and portable executable.

## Windows desktop build

Download the latest release assets:

- `MoeReview-<version>-x64.exe`: installer.
- `MoeReview-<version>-portable.exe`: portable build.
- `moereview-product-intro.mp4`: product introduction video.

The desktop app starts the local Hub and opens the discovery feed. Configure the OpenAI-compatible Base URL, model, and API Key in Settings on first use.

## Run from source

Node.js 18 or newer is required. On Windows PowerShell:

```powershell
npm.cmd run setup
npm.cmd run build
npm.cmd start
```

Open `http://127.0.0.1:3456/discover`. `scripts/start.ps1 -NoOpen` starts the Hub without opening a browser.

## Build the Windows package

```powershell
npm.cmd run setup
npm.cmd run build:desktop
npm.cmd run release:check
```

Build output is written to `release/`. The desktop shell packages the existing Web and Hub builds; it does not package `~/.examforge`, API Keys, paper PDFs, or runtime caches.

## Architecture

```text
Electron / Browser
        |
        | HTTP + WebSocket (loopback only)
        v
MoeReview Hub ---- arXiv / Semantic Scholar / configured AI provider
        |
        +-- local paper cache, summaries, translations, library, sessions
        |
        +-- optional MCP stdio adapter
```

- **Web UI** owns routes, discovery, reading, study views, and user input.
- **Hub** owns local HTTP/WebSocket APIs, providers, AI calls, secrets, caching, persistence, and sessions.
- **Electron** owns the Windows window, Hub lifecycle, external links, and single-instance behavior.
- **MCP Adapter** is a compatibility transport and does not own paper data or rendering.

## Local data and privacy

Runtime data is stored under `~/.examforge/`, including public app settings, Hub-only secrets, paper metadata, library state, recommendation behavior, summaries, translations, extracted documents, PDF cache, and study sessions.

The Hub binds to `127.0.0.1` by default. It does not expose sessions, settings, or paper data to the LAN. Recommendations can be disabled, cleared, and exported from Settings. See [SECURITY.md](./SECURITY.md) for the release boundary.

## Repository layout

```text
web/            React + Vite frontend
mcp-server/     TypeScript Hub and MCP Adapter
desktop/        Electron Windows shell
docs/           Current architecture and contracts
promo-video/    Promotional video source project
scripts/        Start, check, and release scripts
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development expectations.

## License

MoeReview is licensed under the GNU General Public License v3.0. See [LICENSE](./LICENSE).
