# MoeReview Runtime Flows

Document status: Current

## MCP Tool Rendering

1. External MCP-capable agent calls a MoeReview tool.
2. MCP adapter forwards the call to Hub `/api/agent-connections/:agentId/tools`.
3. Hub validates the agent connection and dispatches the named tool handler.
4. Tool handler writes session data and broadcasts a WebSocket update.
5. Web UI updates the current session view.

## API Agent Turn

Current first implementation:

1. Web UI sends user prompt and session id to Hub.
2. Hub loads configured OpenAI-compatible provider settings.
3. Hub sends a bounded context window to the provider.
4. Provider returns assistant text.
5. `/api/ai-agent/chat` returns plain assistant text.
6. `/api/ai-agent/page` writes the generated Markdown as a session learning page and broadcasts page updates.

Structured tool-action parsing is still a later step; do not assume the API Agent can yet call every MCP tool.

## Unified Learning API Turn

1. `/learning` sends an intent or learner question to `POST /api/learning/sessions/:sessionId/turn`.
2. Hub restores the paper binding from session metadata, then loads paper metadata, abstract, cached reading guide, selected source passage, and recent learning-page summaries.
3. The configured OpenAI-compatible API returns a bounded structured learning plan: page, knowledge cards, or quiz.
4. Hub validates the plan and dispatches the existing `create_pages`, `show_card`, `show_quiz`, `set_progress`, and `set_guidance_panel` handlers inside the target session context.
5. Existing WebSocket broadcasts update the learning canvas. No MCP connection is required.
6. External MCP agents continue to call the same handlers through the compatibility adapter.

## Paper Search

1. User types keywords or uses browser Chinese speech recognition to fill the editable query.
2. Web UI sends query, provider preferences, and limit to Hub.
3. Hub calls arXiv and Semantic Scholar with timeouts.
4. Provider clients normalize results into `PaperRecord`.
5. Hub merges duplicates by DOI/arXiv id/title similarity.
6. Hub returns records plus provider diagnostics to Web UI.
7. User can open source/PDF links, translate the abstract, or add a paper metadata page to the session.

8. For a result with a PDF URL, the user can request Hub-side extraction.
9. Hub validates the public URL and redirects, enforces size/time limits, extracts text, and returns source-anchored sections.

## Personalized Paper Feed

1. `/discover` requests a channel, cursor, and limit from `/api/papers/feed`.
2. Hub maps known Chinese interests to stable English provider queries. The `for-you` channel searches up to three interests independently instead of combining them into one restrictive query.
3. Hub reuses a three-minute raw provider result cache for the same query, provider set, page, and sort; cache hits still go through current local ranking.
4. arXiv supplies the primary candidates; Semantic Scholar supplements results when available and reports rate limits honestly.
5. Hub merges and deduplicates the per-interest candidates, removes dismissed papers, applies local recency/interest/read penalties, and returns an interest-specific recommendation reason.
6. If all explicit-interest searches are empty, Hub retries with a general English AI query and labels those cards as fallback candidates. Provider failures remain visible in diagnostics.
7. Web UI keeps a five-minute per-channel memory cache, serves stale results while refreshing in the background, and after the first channel is ready sequentially prefetches the fixed channels plus the first three interest channels with a short delay between requests. Hover and keyboard focus still trigger the same deduplicated prefetch path.
8. Web UI records impressions only when personalization is enabled.
9. Cursor pagination appends deduplicated results without replacing the current feed.

## On-demand Paper Summary

1. A paper card or detail page requests `/api/papers/:id/summary`.
2. Hub fingerprints paper id, title, abstract, and configured model.
3. A matching cached structured summary is returned immediately; otherwise Hub calls the API Agent.
4. The summary preserves source metadata and is stored separately from `PaperRecord`.
5. Missing key, missing abstract, malformed JSON, and empty output fail visibly.

## Full-text Translation And Reading Guide

1. The paper detail page requests `GET /api/papers/:paperId/pdf`; Hub serves `pdf-cache/` and only performs the guarded provider download when no valid local copy exists. Figures, tables, charts, equations, and page layout remain available.
2. The user can switch to translation reading, which reuses Hub-side safe PDF extraction from `documents.json` and stable section anchors.
3. A section translation is split into bounded chunks, translated through `/api/translate/segment`, and recombined while carrying the glossary forward. Matching source/model/prompt/keyword/glossary fingerprints return from persistent cache.
4. “One-click translate and summarize” creates a local job. The job counts matching `translations.json` sections as completed and sends only missing or invalidated sections to the model, then calls `/api/papers/:paperId/reading-guide` with bounded extracted source text.
5. The reading guide explains background, question, method, experiments, findings, limitations, reading tips, and terms in plain Simplified Chinese while preserving English keywords in parentheses.
6. Reading guides, extracted documents, PDF bytes, and translations are cached separately from paper metadata. AI output never replaces the original PDF or extracted source.

## Paper Library And Learning

1. Favorite/read-later/progress changes update the global paper library.
2. Opening a paper records history and dwell time locally when personalization is enabled.
3. “Start learning” creates or restores a session with a durable paper id in session metadata.
4. The learning route restores the paper even when the URL contains only a session id.
5. First-party learning actions use the unified Hub API and reuse existing pages, WebSocket updates, source context, cards, and quiz rendering. MCP remains optional compatibility.

## Paper Injection

1. User opens an extracted paper and selects a section.
2. Web UI sends the question, paper metadata, section id/title, and bounded passage to `/api/papers/ask`.
3. Hub builds a source-anchored prompt and calls the configured API Agent.
4. Model answer must distinguish paper facts from model explanation and name the source segment.
5. User may explicitly save the existing answer through `/api/papers/answer-page`; Hub writes the answer and quoted source passage to the current session.

## Translation

Current first implementation:

1. User selects a segment or paper abstract.
2. Web UI sends `paperId`, `paperTitle`, `sourceSegmentId`, `sourceText`, and optional keywords to `/api/translate/segment`.
3. Hub builds a source-anchored translation request with glossary rules and calls the configured API Agent provider.
4. Model returns JSON with translated text, term list, and warnings; raw text is allowed only as an explicit fallback.
5. Hub checks required English keyword parentheses and obvious dropped numbers when possible.
6. Hub compares returned term mappings with the supplied session glossary and warns on conflicts.
7. Web UI displays the translation, preserved terms, and warnings under the abstract or selected section, and reuses the merged glossary in later translations.

## Recommendation Ranking

1. Hub requests independent provider candidates for each explicit interest or fixed channel.
2. Hub normalizes title, abstract, keywords, and known interest aliases into token profiles.
3. Local library actions and allowed reading interactions build positive and negative paper profiles; impressions remain exposure data, not positive preference.
4. Each candidate receives explicit-fit, behavior-fit, freshness, provider-rank, source-quality, novelty, and negative-fit components.
5. Hub removes dismissed papers, applies topic and author diversity caps, and returns an explainable reason plus `scoreBreakdown`.
6. Provider diagnostics remain visible when one provider is rate-limited or unavailable.

## Batch Translation Job

1. The Web UI creates a Hub job for the current paper, favorites, read-later papers, or an explicit queue.
2. Hub persists the job in `translation-jobs.json`, fetches and safely extracts the PDF, and excludes references and acknowledgements.
3. Up to four paper jobs can run at once; independent sections run at each job's tier-bounded concurrency while all model calls share a Hub-wide maximum of 16. Max tier uses `all`, targets locally cached or library papers only, caps one enqueue operation at 500 papers, and skips jobs already queued, running, or paused for the same paper.
4. Hub reuses `translations.json` when source, model, and custom-prompt fingerprints match, then serializes and merges each completed section write so concurrent papers do not overwrite one another.
5. The job exposes progress and supports pause, resume, cancel, retry, and partial-failure reporting.
6. A completed job can generate the detailed plain-Chinese reading guide. The original PDF remains the visual source for figures, tables, formulas, and charts.

## Failure Semantics

- Missing API key: show explicit configuration error.
- Provider timeout: show provider and timeout reason.
- Empty paper results: show empty state, not a fake summary.
- Translation uncertainty: surface a warning instead of pretending certainty.
- Invalid action JSON: preserve assistant text as fallback only if safe; otherwise show error.

## Windows Desktop Startup

1. The Electron main process enforces a single running desktop instance.
2. It checks the local Hub health endpoint and starts the bundled Hub with `ELECTRON_RUN_AS_NODE=1` when needed.
3. The Hub binds to `127.0.0.1`; the desktop window loads `/discover` over the same HTTP/WebSocket path as browser development.
4. External links are opened by the system browser. The renderer has `contextIsolation` enabled and Node integration disabled.
5. Closing the desktop window stops the Hub process started by that instance.
6. With `--mcp`, Electron skips the window and runs the bundled MCP adapter with inherited stdio, preserving MCP compatibility without making it a product dependency.
