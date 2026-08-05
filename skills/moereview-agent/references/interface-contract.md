# MoeReview Interface Contract

Use MoeReview as the user's primary learning workspace. Agent chat should stay short when the Hub is healthy and bound.

## Turn Startup

### `prepare_turn`

Start each Agent turn with `prepare_turn` when available.

It replaces the common sequence:

```text
get_binding_status
get_pending_messages
get_session_snapshot(limit: small)
```

Typical arguments:

```json
{
  "drainPending": true,
  "includeSnapshot": true,
  "snapshotLimit": 3
}
```

Rules:

- If `bound: false`, bind with `create_conversation_binding` for new work or `claim_session` when the user provides a claim code.
- Handle `pending.messages` before creating new pages.
- Use the compact `snapshot` for orientation.
- Call `get_session_snapshot` only when deeper history is needed.

### `claim_session`

Use when the user provides a MoeReview claim code.

After a successful claim, call `get_session_snapshot` before continuing. The snapshot must include historical pages, wrong answers, favorites, QA history, and activity so the Agent can continue the existing review flow.

## Interaction Tools

### `wait_for_response`, `ask_choice`, `enter_standby`

Use these when the Agent needs live input from the Web UI.

Rules:

- Single waits are capped at 280 seconds.
- If a wait returns `shouldContinueWaiting: true` and live input is still needed, call `enter_standby` again immediately.
- Do not claim the Web UI can wake an ended or idle Agent turn. Only an active wait state can be woken immediately.

## Durable Rendering Tools

Pages are durable learning artifacts. Create them only when the content is worth revisiting.

Use durable pages for:

- concept explanations;
- structured summaries;
- learning plans;
- non-interactive practice sets;
- corrections and mistake reviews.

Do not use durable pages for:

- acknowledgements;
- "I will now..." status;
- navigation hints;
- short next-step reminders;
- low-value transition text.

### `update_workspace`

Batch normal non-quiz UI updates in one call. Prefer it over separate `create_pages/show_card`, `set_guidance_panel`, `set_progress`, `show_toast`, and `update_dashboard` calls.

Correct shape:

```json
{
  "pages": [
    {
      "title": "TCP three-way handshake summary",
      "kind": "card",
      "content": "## Core idea\n\nReadable Markdown body goes here.\n\n- Put only the page body in `content`.\n- Do not wrap it as JSON."
    }
  ],
  "guidance": {
    "title": "Next step",
    "content": "Answer these 3 questions first; I will grade them.",
    "tone": "next_step",
    "nextActions": ["Answer", "Submit"]
  },
  "progress": { "percent": 40, "label": "Organizing concepts" },
  "toast": { "text": "Review page updated", "toastType": "success" }
}
```

Hard rules:

- `pages[].content` must be the readable Markdown body as a plain string.
- Never pass a page object as `pages[].content`.
- Never pass stringified JSON such as `{ "title": "...", "content": "..." }` as `pages[].content`.
- Put the page title only in `pages[].title`.
- Keep short answers in `guidance`, not pages.
- Do not use `update_workspace` for quizzes or grading; use `show_quiz` and `show_result`.
- Durable Markdown pages may include semantic directives, KaTeX, Mermaid, and isolated `html-preview` fences. Follow `references/content-authoring.md` from the main skill.

### `create_pages`

Append multiple immutable Markdown learning pages.

Correct shape:

```json
{
  "pages": [
    {
      "title": "Review plan",
      "kind": "mixed",
      "summary": "Two-day review plan",
      "content": "## Day 1\n\n- Review core terms.\n- Complete short-answer drills."
    }
  ]
}
```

Hard rules:

- `content` must be a plain Markdown string.
- Do not use objects, arrays, quiz payloads, result payloads, or JSON wrappers in `content`.
- Do not use `create_pages` for quizzes or grading results.
- `content` may contain supported extended-Markdown blocks; the overall value is still one plain Markdown string.

### `show_card`

Append one durable knowledge page.

Use for one focused concept or explanation. The `content` argument must be Markdown text, not a JSON wrapper.

Use semantic directives, KaTeX, Mermaid, or isolated HTML previews according to the content-authoring reference. Keep the complete page body in one Markdown string.

### `show_quiz`

Append an interactive quiz page.

Supported question types:

- `choice`
- `fill`
- `short_answer`
- `code`

After showing a quiz, wait for answers with `wait_for_response` or `enter_standby`, then grade with `show_result`.

### `show_result`

Append a structured grading result page.

Every result item must include at least one of:

- `correct`;
- `verdict`;
- `score` and `maxScore`.

Do not write grading as free-form Markdown when the UI needs automatic statistics.

## Correction Tools

### `correct_result`

Use only when a published grading page has materially wrong scoring or per-question verdicts.

Rules:

- Provide a concrete `reason`.
- Provide the corrected structured `results`.
- Do not use it for style edits or minor wording changes.

### `supersede_page`

Use only when a page is materially wrong, harmful, or unusable.

Rules:

- Provide a concrete reason.
- Do not supersede pages just to polish wording.
- After superseding, create a replacement page only if the corrected content is still useful.

## Agent Chat Policy

When MoeReview is healthy and bound:

- put substantive explanations, summaries, plans, quizzes, grading, and corrections into MoeReview;
- keep Agent chat to short status messages or failure details;
- do not answer a learning request only in Agent chat unless the user explicitly asks for chat-only output or MoeReview is unavailable.
