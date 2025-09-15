import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve HTML
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

let worker = null;
let categories = [];
const MAX_SLOTS = 10;
let logListeners = [];

// ---- Log capture & filtering ----
function timestamp() {
  return new Date().toISOString().split("T")[1].split(".")[0];
}

function broadcastLog(rawMessage) {
  if (!rawMessage && rawMessage !== 0) return;
  const lines = String(rawMessage).split(/\r?\n/);

  for (let line of lines) {
    if (!line.trim()) continue;

    // strip ANSI escape codes
    let clean = line.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").trim();

    // 🔥 remove ALL mentions of "fnlb"
    clean = clean.replace(/fnlb/gi, "");

    // 🕒 remove duplicate timestamps inside the message (like [10:45:24])
    clean = clean.replace(/\[\d{2}:\d{2}:\d{2}\]/g, "").trim();

    // --- Skip noisy logs you listed ---
    if (/\[Gateway]/i.test(clean) && /Connecting/i.test(clean)) continue;
    if (/ua:\s/i.test(clean)) continue;
    if (/pb:\s/i.test(clean)) continue;
    if (/hotfix/i.test(clean)) continue;
    if (/netCLOverride/i.test(clean)) continue;
    if (/netCL:/i.test(clean)) continue;
    if (/playlistRevisions/i.test(clean)) continue;

    // --- Replace lines you requested ---
    clean = clean.replace(/Starting shard with ID:.*/i, "Starting OGbot");
    clean = clean.replace(/categories:\s*/i, "User ID: ");

    if (!clean.trim()) continue; // skip if empty after cleaning

    const out = `[${timestamp()}] ${clean}`;
    logListeners.forEach(res => {
      try { res.write(`data: ${out}\n\n`); } catch {}
    });
  }
}

// Console wrappers
const original = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};
const originalWrite = process.stdout.write.bind(process.stdout);

function wrapConsole(method) {
  return (...args) => {
    const msg = args.map(a => {
      if (a instanceof Error) return a.stack || String(a);
      if (a && typeof a === "object") {
        try { return JSON.stringify(a); } catch { return String(a); }
      }
      return String(a);
    }).join(" ");
    original[method](...args);
    broadcastLog(msg);
  };
}

console.log = wrapConsole("log");
console.info = wrapConsole("info");
console.warn = wrapConsole("warn");
console.error = wrapConsole("error");

process.stdout.write = (chunk, encoding, callback) => {
  try { originalWrite(chunk, encoding, callback); } catch {}
  broadcastLog(chunk);
};

// ---- Worker management ----
async function startWorker(token) {
  try {
    const FNLB = await import("fnlb");
    const fnlb = new FNLB.default();

    async function start() {
      await fnlb.start({
        apiToken: token,
        numberOfShards: 1,
        botsPerShard: 10,
        categories,
        logLevel: "INFO",
      });
    }

    async function restart() {
      console.log("🔄 Restarting worker...");
      try { await fnlb.stop(); } catch (e) { console.warn("fnlb stop error:", e); }
      await start();
    }

    await start();
    const interval = setInterval(restart, 3600000);
    worker = { fnlb, interval };
    return true;
  } catch (error) {
    console.error("Failed to start worker:", error);
    return false;
  }
}

async function stopWorker() {
  if (worker) {
    clearInterval(worker.interval);
    try { await worker.fnlb.stop(); } catch (e) { console.warn("fnlb stop error:", e); }
    worker = null;
    categories = [];
    return true;
  }
  return false;
}

// ---- API endpoints ----
app.post("/start", async (req, res) => {
  const { category } = req.body;
  const token = process.env.API_TOKEN;

  if (!token) return res.status(500).json({ error: "API_TOKEN missing" });
  if (!category) return res.status(400).json({ error: "Category required" });

  if (categories.length >= MAX_SLOTS)
    return res.status(400).json({ error: "❌ Server full" });

  if (!categories.includes(category)) categories.push(category);

  if (!worker) {
    const started = await startWorker(token);
    if (started) res.json({ success: true, categories });
    else res.status(500).json({ error: "Failed to start worker" });
  } else {
    try {
      await stopWorker();
      await startWorker(token);
      res.json({ success: true, categories });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update categories" });
    }
  }
});

app.post("/stop", async (req, res) => {
  const stopped = await stopWorker();
  if (stopped) res.json({ success: true, message: "Worker stopped" });
  else res.json({ success: false, message: "No worker running" });
});

app.get("/status", (req, res) => {
  res.json({
    running: !!worker,
    categories,
    slotsUsed: categories.length,
    slotsMax: MAX_SLOTS,
  });
});

app.get("/logs", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  logListeners.push(res);
  req.on("close", () => {
    logListeners = logListeners.filter(r => r !== res);
  });
});

// ---- Start server ----
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
