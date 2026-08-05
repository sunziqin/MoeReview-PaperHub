# MoeReview AI Development Guide

MoeReview is a local-first learning workspace. Before changing code or docs, confirm the current working directory and read this file plus the task-relevant docs under `docs/`.

## Startup Order

1. Confirm the current directory and `git status --short --branch`.
2. Read `docs/DEVELOPMENT_WORKFLOW.md`.
3. For feature or architecture work, read `docs/PROJECT_MAP.md`, `docs/MODULE_CONTRACTS.md`, `docs/RUNTIME_FLOWS.md`, and `docs/MODULE_STATUS.md`.
4. For paper search, reading, injection, or translation work, also read `docs/PAPER_RESEARCH_MODULE.md` and `docs/TRANSLATION_CONTRACT.md`.
5. For regressions or repeated mistakes, read `docs/AI_DEVELOPMENT_PITFALLS.md` and `docs/DO_NOT_REINTRODUCE.md`.
6. Check existing code paths before adding new services or UI state.
7. State the task type, confirmed fact sources, reused module path, change scope, non-scope, and verification plan before edits unless the user explicitly asked to implement.

## Core Rules

- The Hub owns local sessions, HTTP APIs, WebSocket routing, persisted data, provider calls, and secrets.
- The Web UI owns display, user input, local selection state, and ergonomics. It must not own provider API keys for new backend-mediated features.
- The MCP adapter is a compatibility entry, not the only product path.
- API-agent features should reuse existing Hub tool handlers where possible instead of opening a parallel rendering path.
- Paper search results, translations, extracted passages, and injected snippets must carry source metadata.
- Do not present plans, experiments, or external ideas as Current implementation facts.
- Do not commit runtime data, logs, secrets, PDFs, generated audio/video, `node_modules`, or build output.

## Verification

Use `npm.cmd` on Windows to avoid PowerShell execution policy issues.

```powershell
npm.cmd --prefix mcp-server run build
npm.cmd --prefix web run build
git diff --check
```

If a change touches external providers, also test missing-key, network-failure, and empty-result paths.
