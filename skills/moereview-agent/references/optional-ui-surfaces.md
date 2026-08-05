# Optional UI Surfaces

MoeReview has multiple UI surfaces. Choose the smallest surface that preserves the right amount of history.

## Decision Table

| Surface | Use for | History impact |
|---|---|---|
| Page | durable learning artifact | permanent session timeline |
| Side guidance panel | transient status, suggestions, next steps | latest guidance only |
| Toast | very short notification | ephemeral |
| Progress | current task progress | transient |
| Dashboard | compact session-level widgets | optional summary |
| Agent chat | free conversation | outside MoeReview page timeline |

## Side Guidance Panel

Prefer `set_guidance_panel` when the learner should understand the current state without opening Agent chat.

Good side guidance:

- "You are on question 2. Submit when ready."
- "Next: review the two mistakes before continuing."
- "I am waiting for your answer in the Web UI."
- "This session is idle; messages will be queued until I check pending messages."

Keep it short. If the content becomes a full explanation, create a page instead.

## Toast

Use `show_toast` for short events:

- saved;
- submitted;
- connection issue;
- action completed.

Do not use toast for explanations or next-step plans.

## Progress

Use `set_progress` only for the current Agent task. Do not use it as a grade, mastery score, or durable learning metric unless the user explicitly wants that representation.

## Dashboard

Use `update_dashboard` only when widgets add value. Avoid treating dashboard as a required part of every interaction.
