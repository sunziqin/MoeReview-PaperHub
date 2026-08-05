const HUB_URL = process.env.MOEREVIEW_HUB_URL ?? "http://localhost:3456";

export interface AgentRegistration {
  agentId: string;
  conversationKey?: string;
  boundSessionId?: string;
}

export class HubHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = "HubHttpError";
  }
}

export class HubConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubConnectionError";
  }
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  errorMessage = "MoeReview Hub is not running",
): Promise<T> {
  try {
    const response = await fetch(`${HUB_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) {
      throw new HubHttpError(data.error ?? `${response.status} ${response.statusText}`, response.status, path);
    }
    return data as T;
  } catch (error) {
    if (error instanceof HubHttpError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new HubConnectionError(`${errorMessage}: ${detail}`);
  }
}

export async function registerAgent(clientName = "MCP Agent"): Promise<AgentRegistration> {
  const conversationKey = process.env.MOEREVIEW_CONVERSATION_KEY;
  return requestJson<AgentRegistration>(
    "/api/agent-connections",
    {
      method: "POST",
      body: JSON.stringify({ clientName, conversationKey }),
    },
  );
}

export async function heartbeatAgent(agentId: string): Promise<void> {
  await requestJson<{ ok: boolean }>(
    `/api/agent-connections/${encodeURIComponent(agentId)}/heartbeat`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export async function callHubTool(
  agentId: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>(
    `/api/agent-connections/${encodeURIComponent(agentId)}/tools`,
    {
      method: "POST",
      body: JSON.stringify({ tool, args }),
    },
  );
}
