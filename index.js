import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

let logListeners = [];
let categories = [];
let worker = null;
const MAX_SLOTS = 10;

// ---- Timestamp helper ----
function timestamp() {
  return new Date().toISOString().split("T")[1].split(".")[0];
}

// ---- Core log system (old filters) ----
function broadcastLog(rawMessage) {
  if (!rawMessage && rawMessage !== 0) return;
  const lines = String(rawMessage).split(/\r?\n/);

  for (let line of lines) {
    if (!line.trim()) continue;

    let clean = line.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").trim();
    clean = clean.replace(/fnlb/gi, "");
    clean = clean.replace(/\[\d{2}:\d{2}:\d{2}\]/g, "").trim();

    // filters
    if (/playlist_/i.test(clean)) continue;
    if (/ua:/i.test(clean)) continue;
    if (/pb:/i.test(clean)) continue;
    if (/hotfix/i.test(clean)) continue;
    if (/netCL/i.test(clean)) continue;
    if (/Connecting \(http/i.test(clean)) continue;

    // replacements
    clean = clean.replace(/Starting shard with ID:\s*(.+)/i, "Starting OGbot with ID: $1");
    clean = clean.replace(/categories:\s*/gi, "User ID: ");

    if (/Cluster:.*User ID:/i.test(clean)) {
      const slotsUsed = categories.length;
      clean = `user id: ${slotsUsed}. server slots used: ${slotsUsed}/${MAX_SLOTS}`;
    }

    clean = clean.replace(/^\[[^\]]+\]\s*/g, "").trim();
    if (!clean.trim()) continue;

    const out = `[${timestamp()}] ${clean}`;
    logListeners.forEach(res => {
      try { res.write(`data: ${out}\n\n`); } catch {}
    });
  }
}

// ---- Console + stdout hooks ----
const originalLog = console.log;
console.log = (...args) => {
  const msg = args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  originalLog(...args);
  broadcastLog(msg);
};
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, encoding, callback) => {
  try { originalWrite(chunk, encoding, callback); } catch {}
  broadcastLog(chunk);
};

// ---- fnlb worker logic ----
async function startWorker(token) {
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
    try { await fnlb.stop(); } catch {}
    await start();
  }

  await start();
  const interval = setInterval(restart, 3600000);
  worker = { fnlb, interval };
  return true;
}

async function stopWorker() {
  if (worker) {
    clearInterval(worker.interval);
    try { await worker.fnlb.stop(); } catch {}
    worker = null;
    categories = [];
    return true;
  }
  return false;
}

// ---- Routes ----
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
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

app.post("/start", async (req, res) => {
  const { category } = req.body;
  const token = process.env.API_TOKEN;
  if (!token) return res.status(500).json({ error: "API_TOKEN missing" });
  if (!category) return res.status(400).json({ error: "user id required" });
  if (categories.length >= MAX_SLOTS) return res.status(400).json({ error: "❌ Server full" });

  if (!categories.includes(category)) categories.push(category);

  if (!worker) {
    const started = await startWorker(token);
    if (started) res.json({ success: true, "user id": categories });
    else res.status(500).json({ error: "Failed to start worker" });
  } else {
    try {
      await stopWorker();
      await startWorker(token);
      res.json({ success: true, "user id": categories });
    } catch {
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
    "user id": categories,
    slotsUsed: categories.length,
    slotsMax: MAX_SLOTS,
  });
});

// ---- Start server ----
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
