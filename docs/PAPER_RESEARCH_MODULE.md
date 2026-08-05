# Paper Research Module

Document status: Current

## Purpose

The paper module is MoeReview's primary product path: discover personalized papers, search, inspect details, generate Chinese summaries, save papers globally, continue reading, and optionally enter a source-grounded learning session.

## Current First Providers

- arXiv API for open e-print metadata and PDF links.
- Semantic Scholar Academic Graph API for broad metadata and open-access PDF hints.
- Crossref/OpenAlex can be added later for DOI and venue enrichment.

Google Scholar scraping is not a first-version provider because it is unstable for a local app and easy to rate-limit or block.

Personalized feed queries use a bounded Chinese-interest-to-English mapping for known topics. The `for-you` channel queries interests independently, merges and deduplicates candidates, and falls back to general AI candidates only when every interest query is empty. Unknown Chinese interests do not trigger an LLM translation call; the fallback is labeled explicitly.

## Ownership

- Hub owns provider calls, timeouts, normalization, deduplication, and cache.
- Web UI owns query controls, results list, reader layout, and selected passages.
- API Agent owns explanation and synthesis, but not metadata truth.

Feed requests use two short-lived candidate cache layers: the Hub keeps raw provider search results for three minutes in `~/.examforge/papers/provider-feed-cache.json`, while the discovery page keeps per-channel pages in memory for five minutes and prefetches hovered or focused channels. Normalized papers are separately retained in the durable `feed-cache.json` metadata store, so opening a previously discovered paper does not require the provider to return it again. Cached provider candidates are still reranked with current local interests and reading behavior.

## Current Code Anchors

- Backend service: `mcp-server/src/papers/service.ts`
- Backend types: `mcp-server/src/papers/types.ts`
- Hub APIs: `/api/papers/search`, `/api/papers/session-page`
- Frontend entry: `web/src/components/PaperSearchView.tsx`
- Frontend client: `web/src/services/papers.ts`

The current module searches metadata, accepts editable Chinese browser voice queries when the browser supports speech recognition, translates abstracts or extracted sections, creates paper learning pages, extracts text PDFs into bounded sections, and injects one selected section into API Agent questions with source metadata. Scanned-PDF OCR is not implemented.

## Current Product Routes

- `/discover`: personalized magazine-style feed and interest onboarding.
- `/search`: keyword and Chinese browser voice search.
- `/paper/:id`: deep-linkable paper detail, summary, translation, PDF reading, and learning entry.
- `/saved`: favorite and read-later library.
- `/history`: paper reading and learning-session history.
- `/learning`: existing durable learning workspace with paper quick actions.
- `/settings`: the only full configuration center.

Paper learning sessions persist their paper id in session metadata. The learning toolbar and tutor input call the unified Hub learning API using the same API configuration as summaries and translation; an external MCP Agent is optional.

## Current PDF Reader

- Endpoints: `/api/papers/extract` for source-anchored text and `/api/papers/:paperId/pdf` for the locally cached original PDF.
- Maximum download: 25 MB
- Download timeout: 60 seconds, with an explicit retry/open-original error
- Maximum extracted text returned: 500,000 characters
- Public HTTP(S) addresses only, with DNS and redirect validation
- Section ids include character offsets; heading detection falls back to bounded chunks
- The UI never injects the full extracted document automatically
- The detail page offers the Hub-cached original PDF view for figures, tables, charts, equations, and native page layout; the provider URL remains available only as an external verification link.
- The first successful fetch writes PDF bytes to `~/.examforge/papers/pdf-cache/` and extracted sections to `documents.json`. Later detail visits reuse these files instead of downloading or parsing again.
- Detail entry prioritizes the plain-Chinese overview and abstract reading. When a PDF is available, safe text extraction starts shortly after mount in the background so the Chinese reading surface can appear without requiring a manual extraction click; the original PDF remains a separate visual reference.
- The extracted-text view supports per-section source, Chinese, and bilingual reading.
- Chinese is the default reading mode for new installations; the original and bilingual modes remain available.
- One-click translation and summarization creates a Hub-owned translation job with bounded concurrency, persistent section cache, progress, pause/resume/cancel controls, and a detailed plain-Chinese reading guide from at most 60,000 source characters.
- The reader loads completed translations from `GET /api/papers/:paperId/translations`, so translated sections survive page refreshes and browser navigation. The endpoint filters out entries produced by an old model or translation prompt.
- On-demand abstract/segment translation uses the Hub's `translation-segment-cache.json`; a matching source, model, prompt, keyword, and glossary fingerprint returns without a model call.

## Recommendation Ranking

The first ranking pass is intentionally local and explainable. It combines mapped explicit interests, paper title/abstract/keyword overlap, positive library and reading behavior, freshness, provider rank, source completeness, negative feedback, and topic/author diversity. It does not claim semantic embedding quality and does not use impressions as a positive preference signal.

Each feed item includes a human-readable reason and a `scoreBreakdown`. Semantic Scholar rate limits or other provider failures do not suppress usable arXiv candidates.

## Plain-Chinese Output

Summary and reading-guide prompts require a plain-language explanation, the research motivation, method in everyday language, result meaning, practical relevance, limitations, and a short memory list. Technical terms use `中文术语（English keyword）`; numbers, named datasets, metrics, formulas, and citations remain source text. Cached summaries are invalidated when the model or custom summary prompt changes.

## Current Question Injection

- Endpoint: `/api/papers/ask`
- Required context: paper metadata, selected section id/title, selected passage, and question
- Passage ceiling: 20,000 characters
- `/api/papers/answer-page` saves the already returned answer with its quoted source passage, without a second model call

## Data Rules

- Preserve DOI, arXiv id, provider URL, and PDF URL when available.
- Store model-generated summaries separately from source metadata.
- Store translations as model output tied to `paperId` and `sourceSegmentId`; do not overwrite provider metadata with translated text.
- Do not claim a paper has a PDF unless provider metadata includes a PDF URL or a successful fetch confirms it.
- Empty abstracts are allowed and must be shown honestly.

## Injection Rules

Allowed injection:

- title, authors, year, venue;
- abstract;
- user-selected passage;
- extracted section snippets with anchors.

Avoid by default:

- full PDF text;
- references section;
- provider raw JSON;
- unrelated previous search results.

## Diagnostics

Paper provider failures should expose:

- provider name;
- HTTP status when available;
- timeout or parse failure;
- query and limit, without secrets.
