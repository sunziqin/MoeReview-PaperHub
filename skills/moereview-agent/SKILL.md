---
name: moereview-agent
description: Use for any MoeReview-backed study, review, tutoring, quiz, grading, or learning-workspace session, especially when the user wants substantive learning output rendered through MoeReview Hub/MCP. Follow session, page, guidance, waiting, quiz, result, and connection contracts; author cognitively structured extended Markdown with semantic blocks, KaTeX, Mermaid, or isolated HTML previews when useful. Constrain interface correctness and presentation choices without imposing a fixed teaching method, pacing, tone, or curriculum.
---

# MoeReview Agent

Use MoeReview as the primary learning workspace interface, not as a teaching-method prompt. Preserve the Agent's original tutoring ability and any other teaching skills the user installed. This skill defines how to route work into MoeReview's Hub, sessions, pages, side guidance, waits, and message queues, and it strongly prefers Web UI output over Agent-chat output for substantive learning content.

## Operating Rules

1. Start each Agent turn by calling `prepare_turn` when available. It replaces separate `get_binding_status`, `get_pending_messages`, and light snapshot reads.
2. Bind the Agent conversation before doing session work. If unbound, use `create_conversation_binding` for new work, or `claim_session` when the user gives a MoeReview claim code.
3. After `claim_session`, call `get_session_snapshot` before continuing so the Agent can recover context from pages, wrong answers, favorites, QA history, and activity.
4. Treat Web, Agent conversation, MCP connection, and Hub state as separate. The Web page a user is viewing is not automatically the Agent conversation's bound session.
5. Web-first rule: put substantive explanations, summaries, quizzes, grading, correction, plans, and review artifacts into MoeReview pages or guidance. Keep Agent-chat replies short: status, tool failure details, or a pointer that the Web UI was updated.
6. Do not answer a learning request only in Agent chat when MoeReview is healthy and bound. If the answer is worth reading, reviewing, practicing, or grading, render it through MoeReview.
7. Route output by weight: use `update_workspace.guidance` for short answers, current status, next steps, and lightweight reminders; use `update_workspace.pages` for durable explanations, summaries, plans, mistake reviews, and materials worth revisiting.
8. Use Agent chat as a full-answer fallback only when MoeReview is unavailable, unbound and cannot be bound, the user explicitly asks for chat-only output, or the same relevant tool path fails repeatedly.
9. Do not claim that the Web UI can wake an ended or idle Agent turn. Only `waiting` state created by `wait_for_response`, `ask_choice`, or `enter_standby` can be woken immediately.
10. Use `enter_standby` when the user should be able to continue from the Web UI during this Agent turn. Each wait is capped at 280 seconds; if it returns `shouldContinueWaiting: true` and live input is still needed, call `enter_standby` again immediately.
11. Complete quiz loops once started: render quiz, wait/standby for answers, evaluate, then show structured results with per-question verdicts or scores.
12. Never pass natural-language grading lists as `show_result.results`; use `summary.feedback` or `summary.grading_notes` for narrative feedback.
13. Use `correct_result` or `supersede_page` only with a concrete reason when previously published durable content is materially wrong.
14. Do not write low-value chatter into pages. Keep acknowledgements, "I am working on it", and brief navigation hints out of the learning timeline.
15. If Hub or connection state is unhealthy, report it plainly and do not pretend the browser was updated.
16. Before authoring substantive pages, read `references/content-authoring.md` and choose the smallest format that improves understanding or recall.

## Standard Turn Pattern

Use this as an interface pattern, not as a teaching strategy:

```text
1. prepare_turn
2. if unbound: create_conversation_binding for new work, or claim_session when the user provides a claim code
3. if just claimed an existing session: get_session_snapshot
4. handle `prepare_turn.pending.messages` if present
5. inspect context/history only if useful for the user's request
6. perform the requested teaching/review/answering work using the user's preferred method
7. render normal non-quiz output with update_workspace whenever possible
8. keep Agent-chat text minimal unless MoeReview is unavailable or the user explicitly asks for chat-only output
9. use show_quiz/show_result for quiz loops and structured grading
10. write durable artifacts to pages only when justified
11. if expecting Web UI input, enter_standby with `timeoutSeconds <= 280` and `continueOnTimeout: true`
12. if standby returns `shouldContinueWaiting: true`, call enter_standby again unless the task no longer needs live input
13. after receiving input, handle it and either continue, show result, or stand by again
```

## What to Read Next

- Read `references/interface-contract.md` when choosing which MCP tool to call.
- Read `references/session-and-connection.md` when session routing, Hub state, or Agent status matters.
- Read `references/standby-workflow.md` before relying on frontend messages or waiting for user input.
- Read `references/page-authoring-rules.md` before creating multiple pages or deciding whether content deserves a page.
- Read `references/content-authoring.md` before writing durable explanations, summaries, visualizations, formulas, memory cards, or other rich page content.
- Read `references/optional-ui-surfaces.md` when deciding between pages, side guidance, toast, progress, and dashboard widgets.

## Non-Goals

Do not use this skill to decide:

- whether to teach Socratically or directly;
- lesson pacing;
- difficulty progression;
- motivational style;
- curriculum design;
- what counts as a good explanation outside MoeReview UI constraints.

Those choices belong to the user, normal model reasoning, or other skills.
