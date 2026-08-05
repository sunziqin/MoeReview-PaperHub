# Page Authoring Rules

Pages are durable learning artifacts. Create pages only when the content has a clear reason to exist in the long-term session timeline.

## Create a Page When

Use `show_card`, `show_quiz`, `show_result`, or `create_pages` for:

- a complete concept explanation;
- a structured summary;
- a learning plan that the user will revisit;
- a practice set or quiz;
- quiz results and explanations;
- a correction or revision to earlier material;
- a mistake review;
- a milestone or meaningful system event.

## Do Not Create a Page For

Use `set_guidance_panel`, `show_toast`, or normal chat instead for:

- acknowledgements;
- "I will now..." statements;
- tool status;
- brief suggestions;
- navigation hints;
- short next-step reminders;
- low-value transition text.

## Multi-Page Discipline

Use `create_pages` only when each page has a distinct purpose. Avoid splitting merely because content is long.

Good multi-page split:

- overview;
- key concept;
- worked example;
- practice;
- result or summary.

Bad multi-page split:

- one paragraph per page;
- status update as a page;
- every chat reply as a page.

## Correction Policy

Do not silently overwrite the learning timeline. If earlier material was wrong, append a correction/revision page that explains what changed.

## Page Content Quality

Each durable page should have:

- a clear title;
- a useful summary;
- one main purpose;
- enough context to be understood later without opening the Agent chat.

For normal card/mixed pages, the page body must be Markdown text directly. Do not put JSON, page objects, or stringified `{ "title": "...", "content": "..." }` wrappers into the body. The title belongs in the tool's `title` field, and the readable page text belongs in `content`.

For semantic blocks, formulas, Mermaid, and interactive HTML previews, follow `references/content-authoring.md` from the main skill.
