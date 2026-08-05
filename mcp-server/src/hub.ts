import { initStorage } from "./state/persistence.js";
import { initSessions } from "./state/sessions.js";
import { startHttpWsServer } from "./ws/server.js";

async function main(): Promise<void> {
  await initSessions();
  await initStorage();
  await startHttpWsServer();
}

main().catch((error) => {
  console.error("[moereview] Hub fatal:", error);
  process.exit(1);
});
