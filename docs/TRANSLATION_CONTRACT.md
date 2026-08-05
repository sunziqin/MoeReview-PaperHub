# MoeReview Translation Contract

Document status: Current

## Goal

Translations must be useful for paper reading: faithful Chinese, preserved technical keywords, and source traceability.

## Current Code Anchors

- Backend service: `mcp-server/src/services/translation.ts`
- Hub API: `/api/translate/segment`
- Frontend client: `web/src/services/apiAgent.ts`
- Frontend entry: `web/src/components/PaperSearchView.tsx`

The first implementation translates paper abstracts or selected segments through the configured Hub-side API Agent provider. It returns model output with source text, term metadata, warnings, and a `modelNote` that records whether JSON parsing succeeded. Matching requests are persisted under `~/.examforge/papers/translation-segment-cache.json` and return with `cached: true` without another model call.

## Required Style

- Preserve important technical terms as `中文术语（English keyword）`.
- If an abbreviation is standard, include it: `检索增强生成（retrieval-augmented generation, RAG）`.
- Keep equations, variable names, citation markers, dataset names, model names, and metric names unchanged unless a conventional Chinese name is necessary.
- Do not omit limitations, uncertainty, negative results, or experimental caveats.
- Do not turn translation into explanation unless the user asks for explanation.

## Segment Rules

Every translated segment should keep:

- paper id;
- source segment id or section;
- original text;
- translated text;
- terms used;
- warnings when the model is uncertain.

Long extracted sections must be split into bounded chunks and translated in source order. The glossary returned by one chunk is supplied to the next chunk, and the UI recombines the translated chunks under the original section anchor.

Full-text translation excludes references and acknowledgements by default. The original PDF remains available beside the translated text because extracted text does not preserve figures, tables, charts, equations, or page layout.

## Consistency Checks

The system should warn when:

- the same English term receives multiple Chinese translations;
- a required English keyword in parentheses is missing;
- numbers, citations, equations, or named datasets appear to be dropped;
- the translation adds claims not present in the source.

Current automatic checks cover required keyword presence, English keyword parentheses, obvious missing numbers, and conflicts against the glossary supplied by the current Web UI reading session. Glossary persistence across app restarts is not implemented yet for manual segment sessions; Hub batch translation persists the merged glossary with the paper translation document.

## Translation Tiers And Jobs

- Low: on-demand segment translation with concurrency 1.
- Medium: current-paper translation with a maximum section concurrency of 4.
- High: explicit batch translation for selected papers or a library scope, with a user-configured concurrency from 1 to 16.
- Max: automatic batch translation for all papers currently discovered in the local paper cache and library. It does not scan the internet, and one automatic enqueue operation is capped at 500 papers.
- Explicit multi-paper batches run up to four paper jobs at once; model calls share a Hub-wide maximum of 16, while each job still honors its low/medium/high/max section limit.
- Max uses the `all` scope. Queued, running, or paused jobs for the same paper are deduplicated; failed or cancelled jobs remain retryable.
- Low, medium, and high tier changes request scope and concurrency, not a license to silently translate the entire recommendation feed. A batch scope must be explicitly selected.
- Hub stores job state in `~/.examforge/papers/translation-jobs.json` and completed section output in `translations.json`.
- A section cache is reused only when the source text, model, and custom prompt fingerprints match. Failed sections can be retried without retranslating completed sections.
- A repeated job first counts matching cached sections as completed. If every relevant section is already cached for the current model and prompt, the job finishes without a translation request. A model or prompt change starts a new cache version and does not mix old sections into the new reader response.
- PDF bytes and extracted source text are cached separately from translation output. Translation cache persistence never replaces the original source and is not a provider-result TTL cache.
- The Web UI defaults to Chinese reading for new configurations while retaining the original PDF as the visual authority for figures, tables, charts, equations, and page layout.
- Settings expose a custom translation prompt and a custom plain-language summary prompt. Mandatory fidelity, source-grounding, number-preservation, and keyword-preservation rules remain active.
