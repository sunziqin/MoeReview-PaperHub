const HUB_ORIGIN = "http://localhost:3456";

export type LearningIntent = "overview" | "chapter" | "cards" | "quiz-choice" | "quiz-short" | "ask";

async function readError(response: Response): Promise<string> {
  const data = await response.json().catch(() => ({})) as { error?: string };
  return data.error ?? `HTTP ${response.status}`;
}

export async function runLearningTurn(input: {
  sessionId: string;
  paperId?: string;
  intent: LearningIntent;
  prompt?: string;
  selectedPassage?: string;
  selectedSectionId?: string;
  selectedSectionTitle?: string;
}): Promise<void> {
  const response = await fetch(`${HUB_ORIGIN}/api/learning/sessions/${encodeURIComponent(input.sessionId)}/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await readError(response));
}
