# MoeReview Module Status

Document status: Current

## Current Modules

| Module | Current Main Path | Source Truth | Verification | Do Not |
| --- | --- | --- | --- | --- |
| Web UI | Routed paper discovery SPA with detail, library, history, learning, and settings pages | `web/src` | `npm.cmd --prefix web run build` | Do not store new backend API secrets in frontend state |
| Hub | HTTP/WebSocket service owns sessions and routes tools | `mcp-server/src/ws/server.ts` | `npm.cmd --prefix mcp-server run build` | Do not make MCP adapter own durable data |
| MCP adapter | Optional stdio compatibility adapter forwarding external Agent tool calls to Hub | `mcp-server/src/index.ts`, `src/hub/client.ts` | backend build, MCP manual smoke test | Do not make MCP the only possible assistant path |
| Tool handlers | Render pages, quizzes, results, guidance, data reads | `mcp-server/src/tools/*` | backend build and tool smoke tests | Do not duplicate rendering logic in API Agent |
| Sessions | Local session files under `~/.examforge/sessions` | `mcp-server/src/state/*` | backend build, manual session switch | Do not commit runtime data |
| Quick QA | Contextual QA drawer calling the Hub API Agent | `web/src/services/quickQa.ts`, `/api/ai-agent/chat` | frontend/backend build, missing-key smoke test | Do not store provider keys in browser storage or add a second config form |
| API Agent | Hub-side OpenAI-compatible chat/page, translation, summary, and structured learning API using one settings configuration | `mcp-server/src/services/apiAgent.ts`, `mcp-server/src/services/learningAgent.ts`, `mcp-server/src/state/appConfig.ts`, Hub `/api/config/api-agent`, `/api/learning/*` | backend/frontend build, page/card/quiz and missing-key smoke tests | Do not silently switch providers or expose API keys to Web UI |
| Paper discovery | Personalized local feed with explainable ranking, three-minute provider-result caching, durable paper metadata/PDF/document caches, per-channel memory caching/prefetch, search, global paper library, original PDF viewing, persistent section translation jobs, detailed plain-language guides, history, and linked learning sessions | `mcp-server/src/papers/*`, Hub `/api/papers/*`, `web/src/components/research/*` | backend/frontend build, feed cache/prefetch, detail/PDF/translation-job/guide/library/learning smoke tests | Do not inject entire PDFs or treat model answers as paper facts |
| Settings and themes | Unified Hub-backed settings page with four presets and left/right/bottom navigation | `mcp-server/src/state/appConfig.ts`, `/api/config/app`, `web/src/research.css` | frontend build and responsive browser checks | Do not expose secrets or scatter full config forms across feature pages |
| Translation | Hub-side manual segment translation plus low/medium/high/max persistent translation jobs with bounded concurrency, pause/resume/cancel, persistent segment cache, source/model/prompt version isolation, English keyword checks, glossary consistency warnings, and max-tier automatic translation of locally discovered papers | `mcp-server/src/services/translation.ts`, `mcp-server/src/papers/translationJobs.ts`, `web/src/components/research/PaperFullTextReader.tsx`, Hub `/api/translate/segment` and `/api/papers/translation-jobs` | backend/frontend build, invalid-input/missing-key smoke test, max/all enqueue and dedup checks, job cache/status checks, term and number preservation checks | Do not treat model translation as source truth, scan the internet for automatic work, or exceed the Hub concurrency cap |
| Desktop release | Electron launcher for the existing Hub/Web build, NSIS installer, portable executable, and optional `--mcp` stdio mode | `desktop/main.cjs`, `desktop/package.json` | desktop package build, installed-app smoke test, release content check | Do not package local secrets, paper caches, runtime logs, or generated media into source commits |

## Planned / In Progress Modules

| Module | Stage | Planned Main Path | Verification |
| --- | --- | --- | --- |
| OCR for scanned PDFs | Planned | guarded PDF source -> OCR worker -> page anchors | scanned PDF fixture and OCR confidence |
