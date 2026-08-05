const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = Number(process.env.MOEREVIEW_HUB_PORT || 3456);
const HUB_ORIGIN = `http://127.0.0.1:${PORT}`;
const isMcpMode = process.argv.includes("--mcp");
let hubProcess = null;
let mcpProcess = null;
let mainWindow = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function runtimeRoot() {
  return app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "..");
}

function runtimePaths() {
  const root = runtimeRoot();
  return {
    hub: path.join(root, "mcp-server", "dist", "hub.js"),
    adapter: path.join(root, "mcp-server", "dist", "index.js"),
    serverCwd: path.join(root, "mcp-server"),
  };
}

function spawnNode(entry, stdio) {
  const paths = runtimePaths();
  return spawn(process.execPath, [entry], {
    cwd: paths.serverCwd,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      MOEREVIEW_HUB_PORT: String(PORT),
    },
    stdio,
    windowsHide: true,
  });
}

async function isHubReady() {
  try {
    const response = await fetch(`${HUB_ORIGIN}/health`, { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHub(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHubReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`MoeReview Hub did not become ready on port ${PORT}.`);
}

async function startHub() {
  if (await isHubReady()) return;
  const { hub } = runtimePaths();
  hubProcess = spawnNode(hub, ["ignore", "pipe", "pipe"]);
  hubProcess.stderr.on("data", (data) => process.stderr.write(`[Hub] ${data}`));
  hubProcess.on("error", (error) => console.error("[MoeReview] Hub process error:", error));
  hubProcess.on("exit", (code) => {
    if (code && mainWindow && !mainWindow.isDestroyed()) {
      console.error(`[MoeReview] Hub exited with code ${code}.`);
    }
    hubProcess = null;
  });
  await waitForHub();
}

function stopHub() {
  if (!hubProcess || hubProcess.killed) return;
  hubProcess.kill();
  hubProcess = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#f6f7fb",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(HUB_ORIGIN)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(HUB_ORIGIN)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  void mainWindow.loadURL(`${HUB_ORIGIN}/discover`);
}

async function runMcpAdapter() {
  const { adapter } = runtimePaths();
  mcpProcess = spawnNode(adapter, "inherit");
  mcpProcess.on("exit", (code) => app.exit(code ?? 0));
  mcpProcess.on("error", (error) => {
    console.error("[MoeReview] MCP adapter error:", error);
    app.exit(1);
  });
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  if (isMcpMode) {
    await runMcpAdapter();
    return;
  }
  try {
    await startHub();
    createWindow();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("MoeReview 启动失败", `${message}\n\n请确认端口 ${PORT} 没有被其他程序占用。`);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (mcpProcess && !mcpProcess.killed) mcpProcess.kill();
  stopHub();
});
