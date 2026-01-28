import  childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import express from "express";
import httpProxy from "http-proxy";

console.log("[wrapper] Starting Molt.bot wrapper server...");
console.log("[wrapper] Node.js version:", process.version);

// Determine HTTP port - Railway may set PORT=22 for TCP proxy, so use HTTP_PORT or default to 8080
function getHttpPort() {
  const envHttpPort = process.env.HTTP_PORT;
  const envPort = process.env.PORT;
  
  console.log(`[wrapper] Environment HTTP_PORT=${envHttpPort}, PORT=${envPort}`);
  
  if (envHttpPort) {
    const port = Number.parseInt(envHttpPort, 10);
    console.log(`[wrapper] Using HTTP_PORT=${port}`);
    return port;
  }
  
  if (envPort) {
    const port = Number.parseInt(envPort, 10);
    // Railway sets PORT=22 for SSH TCP proxy - don't use it for HTTP
    if (port === 22) {
      console.log(`[wrapper] PORT=22 (TCP proxy for SSH), using default 8080 for HTTP`);
      return 8080;
    }
    console.log(`[wrapper] Using PORT=${port}`);
    return port;
  }
  
  console.log(`[wrapper] No PORT env vars, using default 8080`);
  return 8080;
}

const HTTP_PORT = getHttpPort();
const STATE_DIR = process.env.MOLTBOT_STATE_DIR?.trim() || "/data/.moltbot";
const WORKSPACE_DIR = process.env.MOLTBOT_WORKSPACE_DIR?.trim() || "/data/workspace";

// Setup password for /setup wizard
const SETUP_PASSWORD = process.env.SETUP_PASSWORD?.trim();

// Gateway token - must be stable across restarts
function resolveGatewayToken() {
  const envTok = process.env.MOLTBOT_GATEWAY_TOKEN?.trim();
  if (envTok) return envTok;

  const tokenPath = path.join(STATE_DIR, "gateway.token");
  try {
    const existing = fs.readFileSync(tokenPath, "utf8").trim();
    if (existing) return existing;
  } catch {
    // File doesn't exist yet
  }

  const generated = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(tokenPath, generated, { encoding: "utf8", mode: 0o600 });
  } catch (err) {
    console.warn("[wrapper] Could not persist gateway token:", err);
  }
  return generated;
}

const GATEWAY_TOKEN = resolveGatewayToken();
process.env.MOLTBOT_GATEWAY_TOKEN = GATEWAY_TOKEN;

// Internal gateway config
const GATEWAY_PORT = Number.parseInt(process.env.INTERNAL_GATEWAY_PORT ?? "18789", 10);
const GATEWAY_HOST = process.env.INTERNAL_GATEWAY_HOST ?? "127.0.0.1";
const GATEWAY_TARGET = `http://${GATEWAY_HOST}:${GATEWAY_PORT}`;

// Gateway mode - always use local mode (not remote)
const GATEWAY_MODE = "local";

// Moltbot CLI wrapper
const MOLTBOT_ENTRY = "/moltbot/dist/entry.js";
const MOLTBOT_NODE = "node";

function moltArgs(args) {
  return [MOLTBOT_ENTRY, ...args];
}

function configPath() {
  return process.env.MOLTBOT_CONFIG_PATH?.trim() || path.join(STATE_DIR, "moltbot.json");
}

function isConfigured() {
  try {
    return fs.existsSync(configPath());
  } catch {
    return false;
  }
}

let gatewayProc = null;
let gatewayStarting = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForGatewayReady(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${GATEWAY_TARGET}/`, { method: "GET" });
      if (res) return true;
    } catch {
      // not ready
    }
    await sleep(500);
  }
  return false;
}

async function startGateway() {
  if (gatewayProc) return;
  if (!isConfigured()) throw new Error("Gateway cannot start: not configured");

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  const args = [
    "gateway",
    "run",
    "--bind",
    "loopback",
    "--port",
    String(GATEWAY_PORT),
    "--auth",
    "token",
    "--token",
    GATEWAY_TOKEN,
  ];

  console.log(`[gateway] Starting moltbot gateway (loopback:${GATEWAY_PORT})...`);
  
  gatewayProc = childProcess.spawn(MOLTBOT_NODE, moltArgs(args), {
    stdio: "inherit",
    env: {
      ...process.env,
      MOLTBOT_STATE_DIR: STATE_DIR,
      MOLTBOT_WORKSPACE_DIR: WORKSPACE_DIR,
    },
  });

  gatewayProc.on("error", (err) => {
    console.error(`[gateway] spawn error: ${String(err)}`);
    gatewayProc = null;
  });

  gatewayProc.on("exit", (code, signal) => {
    console.error(`[gateway] exited code=${code} signal=${signal}`);
    gatewayProc = null;
  });
}

async function ensureGatewayRunning() {
  if (!isConfigured()) return { ok: false, reason: "not configured" };
  if (gatewayProc) return { ok: true };
  
  if (!gatewayStarting) {
    gatewayStarting = (async () => {
      await startGateway();
      const ready = await waitForGatewayReady({ timeoutMs: 30_000 });
      if (!ready) {
        throw new Error("Gateway did not become ready in time");
      }
    })().finally(() => {
      gatewayStarting = null;
    });
  }
  
  await gatewayStarting;
  return { ok: true };
}

async function restartGateway() {
  if (gatewayProc) {
    try {
      gatewayProc.kill("SIGTERM");
    } catch {
      // ignore
    }
    await sleep(1000);
    gatewayProc = null;
  }
  return ensureGatewayRunning();
}

function requireSetupAuth(req, res, next) {
  if (!SETUP_PASSWORD) {
    return res
      .status(500)
      .type("text/plain")
      .send("SETUP_PASSWORD not set. Configure it in Railway Variables.");
  }

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) {
    res.set("WWW-Authenticate", 'Basic realm="Moltbot Setup"');
    return res.status(401).send("Auth required");
  }
  
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  const password = idx >= 0 ? decoded.slice(idx + 1) : "";
  
  if (password !== SETUP_PASSWORD) {
    res.set("WWW-Authenticate", 'Basic realm="Moltbot Setup"');
    return res.status(401).send("Invalid password");
  }
  
  return next();
}

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const proc = childProcess.spawn(cmd, args, {
      ...opts,
      env: {
        ...process.env,
        MOLTBOT_STATE_DIR: STATE_DIR,
        MOLTBOT_WORKSPACE_DIR: WORKSPACE_DIR,
      },
    });

    let out = "";
    proc.stdout?.on("data", (d) => (out += d.toString("utf8")));
    proc.stderr?.on("data", (d) => (out += d.toString("utf8")));

    proc.on("error", (err) => {
      out += `\n[spawn error] ${String(err)}\n`;
      resolve({ code: 127, output: out });
    });

    proc.on("close", (code) => resolve({ code: code ?? 0, output: out }));
  });
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

// Health check for Railway
app.get("/healthz", (_req, res) => res.json({ ok: true, configured: isConfigured() }));

// Setup wizard
app.get("/setup", requireSetupAuth, (_req, res) => {
  res.type("html").send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Molt.bot Setup</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 2rem; max-width: 800px; }
    .card { border: 1px solid #ddd; border-radius: 8px; padding: 1.5rem; margin: 1rem 0; }
    label { display: block; margin-top: 0.75rem; font-weight: 600; }
    input, select, textarea { width: 100%; padding: 0.5rem; margin-top: 0.25rem; }
    button { padding: 0.75rem 1.5rem; background: #111; color: #fff; border: 0; border-radius: 6px; cursor: pointer; }
    button:hover { background: #333; }
    pre { background: #f5f5f5; padding: 1rem; overflow-x: auto; white-space: pre-wrap; }
    .status { padding: 1rem; background: #e3f2fd; border-radius: 6px; margin: 1rem 0; }
  </style>
</head>
<body>
  <h1>🦞 Molt.bot Setup</h1>
  <div class="status" id="status">Loading...</div>
  
  <div class="card">
    <h2>Quick Setup</h2>
    <p>Run the molt.bot onboarding wizard:</p>
    <button onclick="runOnboard()">Run Setup Wizard</button>
    <pre id="log"></pre>
  </div>

  <div class="card">
    <h2>Advanced: Manual Configuration</h2>
    <label>API Provider</label>
    <select id="provider">
      <option value="">Choose provider...</option>
      <option value="anthropic">Anthropic (Claude)</option>
      <option value="openai">OpenAI (GPT)</option>
      <option value="google">Google (Gemini)</option>
    </select>
    
    <label>API Key</label>
    <input id="apiKey" type="password" placeholder="Your API key" />
    
    <button onclick="configureManual()" style="margin-top: 1rem">Configure</button>
  </div>

  <div class="card">
    <h2>After Setup</h2>
    <p>Once configured, access your molt.bot gateway at:</p>
    <p><a href="/" target="_blank">Open Molt.bot Dashboard</a></p>
  </div>

  <script>
    const log = document.getElementById('log');
    const status = document.getElementById('status');
    
    async function checkStatus() {
      try {
        const res = await fetch('/setup/api/status');
        const data = await res.json();
        status.textContent = data.configured ? '✓ Configured' : '⚠ Not configured';
      } catch (e) {
        status.textContent = 'Error: ' + e.message;
      }
    }
    
    async function runOnboard() {
      log.textContent = 'Running onboarding wizard...\\n';
      try {
        const res = await fetch('/setup/api/onboard', { method: 'POST' });
        const data = await res.json();
        log.textContent += data.output || JSON.stringify(data);
        await checkStatus();
      } catch (e) {
        log.textContent += 'Error: ' + e.message;
      }
    }
    
    async function configureManual() {
      const provider = document.getElementById('provider').value;
      const apiKey = document.getElementById('apiKey').value;
      
      if (!provider || !apiKey) {
        alert('Please select a provider and enter an API key');
        return;
      }
      
      log.textContent = 'Configuring...\\n';
      try {
        const res = await fetch('/setup/api/configure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, apiKey })
        });
        const data = await res.json();
        log.textContent += data.output || JSON.stringify(data);
        await checkStatus();
      } catch (e) {
        log.textContent += 'Error: ' + e.message;
      }
    }
    
    checkStatus();
  </script>
</body>
</html>`);
});

app.get("/setup/api/status", requireSetupAuth, async (_req, res) => {
  res.json({
    configured: isConfigured(),
    gatewayTarget: GATEWAY_TARGET,
    stateDir: STATE_DIR,
    workspaceDir: WORKSPACE_DIR,
  });
});

app.post("/setup/api/onboard", requireSetupAuth, async (_req, res) => {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

    const args = [
      "onboard",
      "--non-interactive",
      "--no-install-daemon",
      "--workspace",
      WORKSPACE_DIR,
    ];

    const result = await runCmd(MOLTBOT_NODE, moltArgs(args));
    
    // FIX: Set both gateway.auth.token AND gateway.remote.token to the same value
    // This fixes the "unauthorized: gateway token missing" error
    await runCmd(MOLTBOT_NODE, moltArgs(["config", "set", "gateway.auth.mode", "token"]));
    await runCmd(MOLTBOT_NODE, moltArgs(["config", "set", "gateway.auth.token", GATEWAY_TOKEN]));
    await runCmd(MOLTBOT_NODE, moltArgs(["config", "set", "gateway.remote.token", GATEWAY_TOKEN]));
    await runCmd(MOLTBOT_NODE, moltArgs(["config", "set", "gateway.bind", "loopback"]));
    await runCmd(MOLTBOT_NODE, moltArgs(["config", "set", "gateway.port", String(GATEWAY_PORT)]));

    if (result.code === 0) {
      await restartGateway();
    }

    res.json({
      ok: result.code === 0,
      output: result.output,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      output: String(err),
    });
  }
});

app.post("/setup/api/configure", requireSetupAuth, async (req, res) => {
  try {
    const { provider, apiKey } = req.body || {};
    
    if (!provider || !apiKey) {
      return res.status(400).json({ ok: false, error: "Missing provider or apiKey" });
    }

    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

    let result;
    if (provider === "anthropic") {
      result = await runCmd(MOLTBOT_NODE, moltArgs([
        "config", "set", "anthropic.apiKey", apiKey
      ]));
    } else if (provider === "openai") {
      result = await runCmd(MOLTBOT_NODE, moltArgs([
        "config", "set", "openai.apiKey", apiKey
      ]));
    } else if (provider === "google") {
      result = await runCmd(MOLTBOT_NODE, moltArgs([
        "config", "set", "google.apiKey", apiKey
      ]));
    }

    // Set both gateway.auth.token AND gateway.remote.token to fix auth issue
    await runCmd(MOLTBOT_NODE, moltArgs(["config", "set", "gateway.auth.mode", "token"]));
    await runCmd(MOLTBOT_NODE, moltArgs(["config", "set", "gateway.auth.token", GATEWAY_TOKEN]));
    await runCmd(MOLTBOT_NODE, moltArgs(["config", "set", "gateway.remote.token", GATEWAY_TOKEN]));
    await runCmd(MOLTBOT_NODE, moltArgs(["config", "set", "gateway.bind", "loopback"]));
    await runCmd(MOLTBOT_NODE, moltArgs(["config", "set", "gateway.port", String(GATEWAY_PORT)]));

    // Create minimal config if it doesn't exist
    if (!isConfigured()) {
      const minimalConfig = {
        gateway: {
          bind: "loopback",
          port: GATEWAY_PORT,
          auth: {
            mode: "token",
            token: GATEWAY_TOKEN,
          },
          remote: {
            token: GATEWAY_TOKEN,
          },
        },
      };
      fs.writeFileSync(configPath(), JSON.stringify(minimalConfig, null, 2));
    }

    await restartGateway();

    res.json({
      ok: result?.code === 0,
      output: result?.output || "Configuration saved",
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      output: String(err),
    });
  }
});

// Proxy everything else to the gateway
const proxy = httpProxy.createProxyServer({
  target: GATEWAY_TARGET,
  ws: true,
  xfwd: true,
});

proxy.on("error", (err, _req, res) => {
  console.error("[proxy]", err);
  if (res && !res.headersSent) {
    res.status(502).send("Gateway not available");
  }
});

app.use(async (req, res) => {
  if (!isConfigured() && !req.path.startsWith("/setup")) {
    return res.redirect("/setup");
  }

  if (isConfigured()) {
    try {
      await ensureGatewayRunning();
    } catch (err) {
      return res.status(503).send(`Gateway not ready: ${String(err)}`);
    }
  }

  return proxy.web(req, res, { target: GATEWAY_TARGET });
});

const server = app.listen(HTTP_PORT, "0.0.0.0", () => {
  console.log(`[wrapper] listening on :${HTTP_PORT}`);
  console.log(`[wrapper] gateway bind: loopback`);
  console.log(`[wrapper] state dir: ${STATE_DIR}`);
  console.log(`[wrapper] workspace dir: ${WORKSPACE_DIR}`);
  console.log(`[wrapper] gateway token: ${GATEWAY_TOKEN ? "(set)" : "(missing)"}`);
  console.log(`[wrapper] gateway target: ${GATEWAY_TARGET}`);
});

// WebSocket upgrade for gateway connections
server.on("upgrade", async (req, socket, head) => {
  if (!isConfigured()) {
    socket.destroy();
    return;
  }
  
  try {
    await ensureGatewayRunning();
  } catch {
    socket.destroy();
    return;
  }
  
  proxy.ws(req, socket, head, { target: GATEWAY_TARGET });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[wrapper] SIGTERM received, shutting down...");
  try {
    if (gatewayProc) gatewayProc.kill("SIGTERM");
  } catch {
    // ignore
  }
  process.exit(0);
});
