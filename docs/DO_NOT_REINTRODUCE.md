# MoeReview Do Not Reintroduce

Document status: Current

## Architecture

- Do not make the MCP adapter own durable session data.
- Do not require an MCP Agent connection for first-party learning buttons or tutor questions.
- Do not create a second set of page, card, or quiz renderers for the API Agent; dispatch the existing validated tool handlers.
- Do not make API Agent output bypass existing tool handlers when those handlers already fit.
- Do not introduce another learning-session store. The global paper-domain store is intentionally separate and must not duplicate session pages or quiz history.
- Do not write planned features as Current implementation facts.

## Secrets and Data

- Do not commit `~/.examforge` runtime data, secrets, logs, PDFs, generated assets, `node_modules`, or build output.
- Do not expose backend API keys through frontend snapshots or normal WebSocket messages.
- Do not store raw provider error bodies if they may contain secrets.

## Paper Research

- Do not use Google Scholar scraping as the first official provider.
- Do not concatenate multiple Chinese interests into one provider query. Map known topics to English, search interests independently, then merge and rank the candidates.
- Do not claim source certainty without DOI/arXiv/provider URL or user-provided source.
- Do not inject full PDF text by default.
- Do not replace the original PDF with extracted text when the user needs figures, tables, charts, equations, or page layout.
- Do not redraw paper charts from extracted prose or present an AI reconstruction as the source figure.
- Do not let stale search results automatically pollute unrelated prompts.

## Translation

- Do not drop English technical keywords when translating paper terms.
- Do not present explanatory additions as if they were source translation.
- Do not hide uncertainty in ambiguous terms.

## UI

- Do not move paper discovery back into a sidebar drawer. `/discover` is the default usable product screen.
- Do not scatter API, provider, recommendation, or appearance forms across feature pages; full configuration belongs in `/settings`.
- Do not make desktop navigation depend on hover reveal. Labels and position are explicit saved preferences.
- Do not create controls that silently do network work without visible status.
