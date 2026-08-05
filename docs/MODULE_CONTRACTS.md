# MoeReview Module Contracts

Document status: Current

## Layer Ownership

| Layer | Owns | Must Not Own |
| --- | --- | --- |
| Web UI | display, user input, selected text, reader ergonomics, local transient UI state | provider secrets for new backend-mediated features, paper provider calls that need keys, durable business truth not synced to Hub |
| Hub | sessions, persistence, HTTP APIs, WebSocket routing, provider calls, paper cache, backend secrets | browser-only view state |
| MCP adapter | stdio compatibility and forwarding tool calls to Hub | durable data ownership, independent rendering logic |
| Tool handlers | page creation, quiz/result rendering, guidance, session data reads | direct UI-only assumptions |
| Provider clients | external API request/response normalization | raw UI rendering or session navigation |

## API Agent Contract

API Agent features must:

- Use OpenAI-compatible chat completions as the first backend provider shape.
- Keep API keys in Hub-side storage for backend-mediated calls.
- Return clear errors when config is missing; do not silently switch provider or endpoint.
- Prefer structured actions that reuse existing tool handlers.
- Strip internal action JSON from visible assistant text before writing user-facing pages or guidance.
- Internal learning turns and external MCP calls must reuse the same validated tool handlers. MCP transport must not be required for first-party learning UI actions.
- Learning API actions are allowlisted to durable learning pages, cards, quizzes, progress, and guidance. Model output must pass the existing Zod tool schema before persistence or broadcast.

## Paper Learning Session Contract

- Paper learning sessions persist `sessionKind: "paper"` and `paperId` in session metadata.
- The paper library may retain `learningSessionId` for reverse lookup, but URL query parameters are not the source of truth.
- Existing linked sessions without metadata are repaired from the paper library when sessions are listed.
- A learning turn may use paper metadata, abstract, cached reading guide, a selected passage of at most 20,000 characters, and recent page summaries. It must not inject the full PDF by default.

## Paper Record Contract

Normalized paper records should use this stable shape:

```ts
interface PaperRecord {
  id: string;
  source: "arxiv" | "semantic-scholar" | "crossref" | "openalex" | "manual";
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  abstract?: string;
  doi?: string;
  arxivId?: string;
  url?: string;
  pdfUrl?: string;
  keywords?: string[];
  sourceConfidence: "metadata" | "abstract" | "pdf" | "manual";
  fetchedAt: string;
}
```

Paper records are metadata and source anchors. They are not model-generated summaries.

## Global Paper Workspace Contract

- Global paper state lives under `~/.examforge/papers`, separate from session learning data.
- `library.json` owns favorite, read-later, reading progress, and linked learning-session state.
- `interactions.json` contains local recommendation events and is bounded.
- `summaries.json` contains model output keyed by paper/source/model fingerprint.
- `reading-guides.json` contains detailed plain-Chinese guides keyed by extracted source and model fingerprint.
  - `feed-cache.json` contains normalized provider metadata for detail deep links and is the durable paper metadata cache. It is not trimmed by age or count; it is removed only by an explicit local-data clear.
- `provider-feed-cache.json` contains short-lived raw provider search results keyed by query, provider set, page, and sort; it is only a network cache and is reranked with current local behavior on every uncached feed request.
  - `documents.json` contains extracted, source-anchored paper text keyed by paper id and source fingerprint.
  - `pdf-cache/` contains downloaded PDF bytes keyed by paper id and file fingerprint. The Hub serves these local copies through `GET /api/papers/:paperId/pdf`; the Web UI must not embed provider PDF URLs directly for normal reading.
  - `translations.json` contains section translations keyed by paper id, source fingerprint, model, and translation-prompt fingerprint. Only the current model/prompt version is returned to the reader.
  - `translation-segment-cache.json` contains persistent on-demand abstract and segment translations. Its key includes source text, paper/segment id, model, prompt, keywords, and glossary, so a matching request does not call the model again.
- `translation-jobs.json` contains queued, running, paused, completed, cancelled, and failed batch jobs. It is local runtime data and must not enter git.
- Disabling personalization stops implicit impression/open/dwell recording; explicit library actions still persist.
- Feed scoring uses explicit interest fit, local behavior fit, freshness, provider rank, source quality, negative feedback, and diversity caps. `PaperFeedItem.scoreBreakdown` explains the main components.

## App Preferences Contract

- Public app preferences live in Hub `config.json` and are exposed by `/api/config/app`.
- API keys remain in `secrets.json` and are never returned to the Web UI.
- Appearance supports preset, color mode, accent, density, font scale, navigation position, and navigation label mode.
- Mobile navigation is always bottom-positioned regardless of desktop preference.
- Translation preferences include `translationTier`, `translationConcurrency`, `translationScope`, `translationPrompt`, and `summaryPrompt`. API keys remain separate from all of these fields.

## Injection Contract

Injected paper context must include:

- paper id and title;
- source provider and URL/DOI/arXiv id when available;
- selected passage text or abstract;
- passage/section anchor when available;
- max character budget.

Do not inject entire PDFs by default.

Current Hub endpoints enforce a 20,000-character passage ceiling. Saved paper answers include the question, model answer, paper identifiers, segment id, section title, source URL, and quoted passage.

## PDF Extraction Contract

- PDF fetching is Hub-side only.
- Only HTTP(S) public addresses are accepted; private/loopback DNS results are rejected.
- Redirects are revalidated and bounded.
- Downloads are limited to 25 MB and extracted text to 500,000 characters.
- Scanned or encrypted PDFs without extractable text fail visibly.
- Extracted sections carry stable ids and character offsets for source anchoring.
- `POST /api/papers/extract` reuses `documents.json` and `pdf-cache/` when the paper source fingerprint is unchanged; concurrent extraction requests for the same paper are coalesced.
- `GET /api/papers/:paperId/pdf` serves the locally cached PDF and fetches/extracts it once when no valid local copy exists. This route never exposes the provider URL as the normal reader source.
- The original PDF view is the visual source of truth for figures, tables, charts, equations, and page layout. Extracted text must not pretend to preserve those visual structures.

## Translation Contract Pointer

Translation rules live in `docs/TRANSLATION_CONTRACT.md`. The short rule is: translate faithfully, preserve technical English keywords in parentheses, and keep source anchors.

## Translation Job Contract

- `POST /api/papers/translation-jobs` creates one or more Hub-owned jobs. A job is created only for an explicit paper id or an explicit library scope.
- `GET /api/papers/translation-jobs` lists local job status; `POST /api/papers/translation-jobs/:jobId/{pause|resume|cancel}` controls it.
- `GET /api/papers/:paperId/translations` returns cached, source-anchored section translations.
- Low tier uses one section at a time, medium tier caps section concurrency at four, high tier accepts the configured 1-16 concurrency range, and max tier uses the same configured range for automatic local-library translation.
- Max tier implies the `all` scope unless a caller explicitly requests a single-paper current scope. `all` is bounded to 500 papers per enqueue operation and never performs an internet-wide scan.
- Repeated automatic enqueue operations skip papers with queued, running, or paused jobs; failed and cancelled jobs can be retried.
- A running job counts sections that already match the current source, model, and prompt fingerprints as completed and translates only missing or invalidated sections. If all sections are cached, it completes without a model call.
- Custom prompts are appended to mandatory source-fidelity, number-preservation, and English-keyword rules. They cannot disable those rules.

## Release And Desktop Contract

- The Hub listens on `127.0.0.1` by default. A public release must not broaden the bind address without adding authentication and an explicit opt-in.
- Electron owns only the Windows process shell: it starts the already-built Hub, opens the Web UI, routes external links to the system browser, and stops the Hub on exit.
- The desktop package includes `web/dist`, `mcp-server/dist`, the Hub runtime dependencies, and the MCP adapter. It does not include `~/.examforge`, secrets, PDF caches, logs, or generated video.
- Running the packaged executable with `--mcp` starts the bundled stdio adapter and inherits stdin/stdout for MCP clients; normal Web UI and learning flows do not require MCP.
- Quick QA, summaries, translations, and learning calls use the Hub-owned API Agent configuration. The Web UI may receive public configuration fields and `configured`, but never an API key.
