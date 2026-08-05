#!/usr/bin/env node
/**
 * MCP Agent Adapter.
 *
 * This process speaks MCP over stdio and proxies every tool call to the
 * long-lived MoeReview Hub. It intentionally does not host the web UI and does
 * not kill any existing process or port owner.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { allTools, TOOL_DESCRIPTIONS } from "./tools/registry.js";
import { HubHttpError, callHubTool, heartbeatAgent, registerAgent } from "./hub/client.js";

function isAgentNotFound(error: unknown): boolean {
  return (
    (error instanceof HubHttpError && error.status === 404 && error.message.includes("agent not found")) ||
    (error instanceof Error && error.message.includes("agent not found"))
  );
}

async function main(): Promise<void> {
  let agentId: string | null = null;
  const clientName = process.env.MOEREVIEW_AGENT_NAME ?? "MCP Agent";

  async function connectAgent(): Promise<string | null> {
    try {
      const registration = await registerAgent(clientName);
      agentId = registration.agentId;
      console.error(
        registration.boundSessionId
          ? `[moereview] Connected to Hub as ${registration.agentId}, bound session ${registration.boundSessionId}.`
          : `[moereview] Connected to Hub as ${registration.agentId}, currently unbound. Use create_conversation_binding or claim_session.`,
      );
      return agentId;
    } catch (error) {
      agentId = null;
      console.error(
        `[moereview] MoeReview Hub is not running. Start the Hub first with "npm run hub". ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  async function ensureAgent(): Promise<string | null> {
    if (agentId) return agentId;
    return connectAgent();
  }

  async function callToolWithReconnect(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const currentAgentId = await ensureAgent();
    if (!currentAgentId) {
      return {
        ok: false,
        error: "MoeReview Hub is not running. Start it with `npm run hub` in mcp-server.",
      };
    }

    try {
      return await callHubTool(currentAgentId, name, args);
    } catch (error) {
      if (!isAgentNotFound(error)) throw error;
      agentId = null;
      console.error("[moereview] Hub forgot this Agent connection; re-registering and retrying tool call.");
      const nextAgentId = await connectAgent();
      if (!nextAgentId) {
        return {
          ok: false,
          error: "MoeReview Hub is not running. Start it with `npm run hub` in mcp-server.",
        };
      }
      try {
        return await callHubTool(nextAgentId, name, args);
      } catch (retryError) {
        if (isAgentNotFound(retryError)) {
          agentId = null;
          return {
            ok: false,
            error: "MoeReview Agent connection was lost during reconnect. The adapter will re-register on the next tool call; retry the MoeReview tool once.",
          };
        }
        throw retryError;
      }
    }
  }

  try {
    const registration = await registerAgent(clientName);
    agentId = registration.agentId;
    console.error(
      registration.boundSessionId
        ? `[moereview] Connected to Hub as ${registration.agentId}, bound session ${registration.boundSessionId}.`
        : `[moereview] Connected to Hub as ${registration.agentId}, currently unbound. Use create_conversation_binding or claim_session.`,
    );
  } catch (error) {
    console.error(
      `[moereview] MoeReview Hub is not running. Start the Hub first with "npm run hub". ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  setInterval(() => {
    void ensureAgent()
      .then((currentAgentId) => {
        if (!currentAgentId) return;
        return heartbeatAgent(currentAgentId).catch((error) => {
          if (isAgentNotFound(error)) {
            agentId = null;
            console.error("[moereview] Hub heartbeat lost Agent registration; will re-register.");
            void connectAgent();
            return;
          }
          console.error(`[moereview] Hub heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      })
      .catch((error) => {
        console.error(`[moereview] Hub heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
      });
  }, 10_000).unref();

  const server = new McpServer({
    name: "moereview-agent-adapter",
    version: "0.2.0",
  });

  for (const [name, def] of Object.entries(allTools)) {
    const description = TOOL_DESCRIPTIONS[name] ?? `${name} tool.`;
    server.registerTool(
      name,
      { description, inputSchema: def.schema } as never,
      (async (args: Record<string, unknown>) => {
        const result = await callToolWithReconnect(name, args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      }) as never,
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[moereview] MCP adapter ready. ${Object.keys(allTools).length} tools registered.`);
}

main().catch((err) => {
  console.error("[moereview] Fatal:", err);
  process.exit(1);
});
