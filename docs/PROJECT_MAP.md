# MoeReview Project Map

Document status: Current

## One-line Definition

MoeReview is a local-first paper discovery and reading platform. Personalized paper browsing is the primary experience; source-grounded learning sessions are an optional deep-reading mode.

## Current Top-level Structure

- `web/`
  - React + Vite frontend.
  - Owns routed discovery, search, paper detail, saved, history, learning, settings, quiz views, and user input.
- `mcp-server/`
  - Node.js Hub and MCP adapter.
  - `src/hub.ts` starts the long-lived HTTP/WebSocket Hub.
  - `src/index.ts` starts the MCP stdio adapter.
  - `src/ws/server.ts` owns HTTP APIs, WebSocket routing, agent registration, and tool dispatch.
  - `src/tools/` owns render, interaction, data, execution, and control tools.
  - `src/state/` owns local session persistence and bindings.
- `skills/moereview-agent/`
  - Optional Codex skill for MCP-capable agents.
- `docs/`
  - Current governance and design documents.

## Current Main Paths

- Paper discovery path:
  - Browser `/discover` -> Hub `/api/papers/feed` -> arXiv candidates + Semantic Scholar diagnostics -> local explainable ranking -> paper cards.
- Paper detail path:
  - Browser `/paper/:id` -> local paper cache/library/summary -> optional PDF extraction and translation -> reading progress.
- Paper learning path:
  - Detail “Start learning” -> linked session -> existing learning pages, API Agent, MCP tools, quizzes, and source-anchored questions.

- MCP path:
  - External agent -> MCP stdio adapter -> Hub HTTP tool API -> tool handler -> local session data + WebSocket UI.
- Web path:
  - Browser -> Hub WebSocket/API -> local session data and page updates.
- Quick QA path:
  - Browser local settings -> OpenAI-compatible chat completions -> QA drawer -> session QA history event.

## Current First-class Paths

- API Agent path:
  - Web UI -> Hub API -> OpenAI-compatible provider -> structured actions -> existing tool handlers -> Web UI.
- Paper research path:
  - Web UI -> Hub paper feed/search APIs -> paper providers -> normalized paper records -> detail / library / reader / learning session.
- Translation path:
  - Web UI -> Hub translation API -> model provider -> segment translation + glossary checks -> paper reader / learning page.

## Key Source Truths

- Tool schemas and handlers: `mcp-server/src/tools/registry.ts` and `mcp-server/src/tools/*`.
- Hub API routing: `mcp-server/src/ws/server.ts`.
- Session persistence: `mcp-server/src/state/persistence.ts` and `mcp-server/src/state/sessions.ts`.
- Frontend shared types: `web/src/types.ts`.
- Quick QA model client: `web/src/services/quickQa.ts`.

## New Module Questions

Before adding a module, answer:

- Does it belong in Web UI, Hub, MCP adapter, provider client, or local cache?
- Does it need a shared frontend/backend type?
- Does it read secrets? If yes, keep it Hub-side.
- Does it create durable session history or temporary context?
- What is the runtime log or diagnostic surface?
- What should be impossible to reintroduce later?
