import { renderTools } from "./render.js";
import { interactionTools } from "./interaction.js";
import { dataTools } from "./data.js";
import { executionTools } from "./execution.js";
import { controlTools } from "./control.js";

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  show_card: "Append a durable extended-Markdown knowledge page. Content may use semantic directives, KaTeX, Mermaid, and isolated HTML/CSS/JavaScript previews when they improve learning.",
  clear_board: "Append a new-stage marker to the bound MoeReview session.",
  show_quiz: "Render quiz questions to the bound MoeReview session.",
  show_result: "Render structured quiz results to the bound MoeReview session. Each item must include correct, verdict, or score/maxScore.",
  correct_result: "Revise a previously published result page with structured corrected grading. Requires a concrete audit reason.",
  supersede_page: "Mark a materially wrong page as superseded without deleting history. Requires a concrete audit reason.",
  update_dashboard: "Update optional dashboard widgets for connected web clients.",
  set_progress: "Set transient Agent task progress.",
  set_session_title: "Rename the bound MoeReview session.",
  show_toast: "Show a lightweight toast notification.",
  set_guidance_panel: "Update the session side guidance panel for transient status, brief suggestions, or next steps without appending a learning page.",
  create_pages: "Append multiple durable extended-Markdown learning pages. Content must be plain strings and may use semantic directives, KaTeX, Mermaid, or isolated HTML previews.",
  update_workspace: "Batch non-quiz page, guidance, progress, toast, and dashboard updates. Page content must be plain extended-Markdown strings, never JSON wrappers.",
  wait_for_response: "Wait for user events from the bound session only. Single calls are clamped to 280 seconds; if timed out and live input is still needed, call again.",
  ask_choice: "Ask the user to choose an option in the bound session. Single waits are clamped to 280 seconds; repeat if the user still needs time.",
  get_wrong_answers: "Read wrong answers from the bound session.",
  get_history: "Read recent learning history from the bound session.",
  get_qa_history: "Read direct-QA history from the bound session.",
  get_pages: "Read learning pages from the bound session.",
  get_activity_log: "Read passive frontend activity logs from the bound session.",
  get_session_snapshot: "Read a compact recovery snapshot for the bound session after claiming or reconnecting.",
  run_code: "Execute code in the local sandbox.",
  create_conversation_binding: "Create a one-to-one MoeReview conversation binding and attach this MCP connection.",
  bind_conversation: "Attach this MCP connection to an existing MoeReview conversation binding.",
  claim_session: "Claim a frontend session with a short one-time code and attach this MCP connection.",
  get_binding_status: "Inspect this Agent connection's MoeReview conversation binding.",
  bind_session: "Bind this Agent connection to an existing or new session.",
  list_sessions: "List local MoeReview sessions.",
  get_connection_status: "Inspect Hub, Agent, web-client, and queue status.",
  prepare_turn: "Prepare an Agent turn in one call: binding status, pending Web messages, and optional compact session snapshot.",
  handoff_session: "Switch this Agent connection to another session and notify web clients.",
  append_system_event: "Append an Agent lifecycle event into the bound session timeline.",
  get_pending_messages: "Drain web messages queued while the Agent was not actively waiting.",
  enter_standby: "Enter a bounded live waiting state so the web UI can wake this Agent turn. Single waits are clamped to 280 seconds; if shouldContinueWaiting is true, call enter_standby again.",
};

export const allTools = {
  ...renderTools,
  ...interactionTools,
  ...dataTools,
  ...executionTools,
  ...controlTools,
};
