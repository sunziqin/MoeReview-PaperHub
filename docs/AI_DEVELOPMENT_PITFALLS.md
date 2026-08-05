# MoeReview AI Development Pitfalls

Document status: Current

## Common Mistakes

### Not checking the current directory

Always confirm the workspace before reading or editing. This repository may be a clone, temp checkout, or imported working tree.

### Treating MCP as the whole product

MCP is a compatibility path. New API-agent and paper features should be available without requiring an MCP-capable external agent.

### Adding a parallel rendering path

Do not create a separate API Agent renderer if existing tool handlers can create pages, guidance, quizzes, or results.

### Storing backend secrets in the browser

Quick QA currently uses localStorage for direct browser calls. New backend-mediated provider calls should keep keys Hub-side and expose only configured/not configured state.

### Translating without source anchors

Paper translation and explanation must keep the source paper and segment identity. Otherwise later answers cannot be audited.

### Calling a model summary "paper content"

Metadata and extracted passages are source facts. Summaries, explanations, and translations are model outputs and should be labeled as such.

### One-shot PDF ingestion

Do not inject entire PDFs into prompts by default. Use selected passages, abstracts, or extracted section snippets with budgets.

### Silent fallback

Missing config, provider failures, parse failures, and timeouts should be visible. Do not silently switch providers or pretend results are complete.
