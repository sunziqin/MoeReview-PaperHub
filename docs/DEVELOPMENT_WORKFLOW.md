# MoeReview Development Workflow

Document status: Current

## Purpose

This is the development entrypoint for MoeReview. It keeps future AI and human work grounded in the real codebase instead of stale chat context.

## Task Types

| Type | Examples | Read First |
| --- | --- | --- |
| Bug fix | WebSocket stale state, page not rendered, tool result wrong | Runtime flow, affected source, logs if available |
| API agent | OpenAI-compatible model call, tool action parsing, streaming | Project map, module contracts, runtime flows |
| Paper research | paper search, metadata, PDF, extraction, injection | Paper module, contracts, runtime flows |
| Translation | paragraph translation, glossary, term checks | Translation contract, paper module |
| MCP compatibility | tool schema, adapter reconnect, binding | MCP tools, session connection docs |
| UI | search panel, reader, settings, session pages | Project map, frontend store/components |
| Docs | workflow, module status, red lines | Existing docs and current source facts |

## Fixed Work Order

1. Confirm the directory and repository status.
2. Identify the task type.
3. Read only the docs and source files relevant to that task.
4. Confirm the existing path to reuse.
5. Define change scope and non-scope.
6. Implement in small slices.
7. Run the relevant build/tests.
8. Update module docs when contracts, runtime flows, status, or red lines change.

## New Feature Checklist

- What user workflow does this unlock?
- Which layer owns it: Web UI, Hub service, MCP adapter, provider, or local cache?
- What data contract is required?
- Does it touch secrets, files, PDFs, external APIs, or model output?
- How does it fail visibly and safely?
- What gets persisted, and where?
- Which runtime flow and module status entries need updating?

## Documentation Sync

- User-visible or architecture changes: update `docs/MODULE_STATUS.md`.
- New fields, APIs, or ownership rules: update `docs/MODULE_CONTRACTS.md`.
- New request/event sequence: update `docs/RUNTIME_FLOWS.md`.
- New paper behavior: update `docs/PAPER_RESEARCH_MODULE.md`.
- New translation behavior: update `docs/TRANSLATION_CONTRACT.md`.
- New repeated pitfall or regression risk: update `docs/AI_DEVELOPMENT_PITFALLS.md` or `docs/DO_NOT_REINTRODUCE.md`.
