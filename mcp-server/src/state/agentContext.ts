import { AsyncLocalStorage } from "node:async_hooks";

export interface AgentRequestContext {
  agentId: string;
  conversationKey?: string;
  boundSessionId?: string;
}

const agentContext = new AsyncLocalStorage<AgentRequestContext>();

export function withAgentContext<T>(
  context: AgentRequestContext,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return agentContext.run(context, fn);
}

export function getAgentContext(): AgentRequestContext | null {
  return agentContext.getStore() ?? null;
}
