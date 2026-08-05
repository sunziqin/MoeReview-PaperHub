# Standby and Pending Message Workflow

MoeReview cannot reverse-wake an Agent turn that already ended. Standby is the supported live-interaction mechanism.

## Start-of-Turn Inbox

At the start of each turn:

```text
get_pending_messages
```

Handle all relevant messages for the bound session before creating new pages or asking new questions.

## Live Waiting

Use `enter_standby` when the user should continue from the Web UI during this same Agent turn.

Codex may time out a single MCP tool call around 300 seconds. MoeReview clamps each blocking wait to 280 seconds. For longer live waits, loop in bounded segments instead of asking one tool call to wait too long.

Recommended single-call timeouts:

- quick choice or confirmation: 120-180 seconds;
- normal quiz or answer entry: 240-280 seconds;
- longer live practice wait: repeat `enter_standby` at 280 seconds per call.

When `enter_standby` returns:

```json
{ "reason": "timeout", "shouldContinueWaiting": true }
```

and the task still needs live frontend input, immediately call `enter_standby` again. Stop the loop only when:

- frontend messages arrive;
- the user changes the task in Agent chat;
- the task no longer needs live input;
- you have reached a reasonable total wait for the activity.

Avoid infinite loops with no purpose. For active quiz/practice sessions, repeated standby is appropriate. For passive reading, prefer writing guidance and ending the turn.

## Quiz Loop

For quizzes:

```text
show_quiz
enter_standby(timeoutSeconds <= 280, continueOnTimeout: true)
repeat enter_standby while shouldContinueWaiting is true and the quiz still needs answers
evaluate answers
show_result
optionally set_guidance_panel with next steps
```

Do not abandon a quiz after rendering it if answers arrive.

## Pending vs Waiting

- `get_pending_messages` drains queued input from previous idle/working periods.
- `enter_standby` waits for new input in this current Agent turn.
- `wait_for_response` and `ask_choice` also place the session in waiting state.

## Handling Multiple Messages

When multiple messages arrive:

1. Preserve user intent order.
2. Ignore stale UI noise unless useful.
3. If messages conflict, ask for clarification or handle the latest explicit user instruction.
4. Do not consume messages from other sessions.
