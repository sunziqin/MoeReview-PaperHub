# Session and Connection Model

MoeReview has three separate actors:

- Hub: long-lived HTTP/WebSocket service and local data owner.
- Web UI: browser view into sessions and history.
- Agent conversation: the logical Codex/task/thread conversation doing learning work.
- Agent Adapter: temporary MCP process/connection for one Agent conversation.

Do not collapse these into one "current session" concept.

## Binding Model

MoeReview binds Agent conversations to frontend learning sessions:

```text
conversationKey <-> sessionId
```

`agentId` is only a temporary MCP connection id. It can disconnect, reconnect, or be replaced. Do not treat it as the durable identity.

## Routing Rules

- Agent tools operate on the session bound to the Agent conversation.
- Web currently viewed session is browser-local state.
- Web switching sessions should not automatically switch Agent work.
- New Agent conversation work should call `create_conversation_binding`.
- Existing Web session takeover should use a frontend claim code and `claim_session`.
- Do not silently bind to the most recent session.
- `bind_conversation` is an advanced/debug path for a known `conversationKey`, not the normal user flow.

## Recovery Rules

- If the Agent forgets context but the MCP connection remains alive, call `get_binding_status`; the Hub should still know the bound session.
- If the Agent is unbound after reconnect or compression, ask the user to generate a Web claim code and call `claim_session`.
- After `claim_session`, call `get_session_snapshot` before continuing.
- If a tool reports `this conversation has been replaced`, stop writing to that session and ask the user whether to create or claim another session.
- If a tool reports the bound session was deleted, do not recreate it. Ask the user to create or claim another session.

## Status Semantics

| Status | Meaning | Agent implication |
|---|---|---|
| `offline` | no Agent bound | Web cannot send work to an Agent |
| `unbound` | Adapter connected but no conversation/session binding | create or claim a binding before session work |
| `idle` | Agent adapter connected, no active wait | Web messages queue; they do not wake an ended turn |
| `waiting` | Agent is inside wait/standby | Web input can wake the Agent immediately |
| `working` | Agent is executing/generating/tooling | Web input queues |
| `disconnected` | heartbeat stale or adapter gone | reconnect Agent before real-time interaction |
| `replaced` | another Agent conversation took over the session | old Agent must stop writing and rebind/claim elsewhere |

## User-Facing Truthfulness

Say "I will see that when I next check pending messages" for idle/queued messages.

Say "send it in the Web UI now and it should wake me" only while the Agent has entered `waiting` through `wait_for_response`, `ask_choice`, or `enter_standby`.

If unsure, call `get_connection_status`.

## Hub Not Running

If tools report that MoeReview Hub is not running:

1. State the exact issue.
2. Tell the user to start the Hub from `mcp-server` with `npm run hub`.
3. Do not claim pages, guidance, or quiz UI were updated.
