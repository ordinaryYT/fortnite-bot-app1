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
const MAX_SLOTS = 10;
let categories = [];
let running = false;

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

    if (/playlist_/i.test(clean)) continue;
    if (/ua:/i.test(clean)) continue;
    if (/pb:/i.test(clean)) continue;
    if (/hotfix/i.test(clean)) continue;
    if (/netCL/i.test(clean)) continue;
    if (/Connecting \(http/i.test(clean)) continue;

    clean = clean.replace(
      /Starting shard with ID:\s*(.+)/i,
      "Starting OGbot with ID: $1"
    );
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

// ---- Wrap console + stdout ----
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

// ---- New Start/Stop routes ----
app.post("/start", (req, res) => {
  const { category } = req.body;
  if (!category) {
    console.log({ error: "user id required" });
    return res.status(400).json({ error: "user id required" });
  }

  if (categories.length >= MAX_SLOTS) {
    console.log({ error: "❌ Server full" });
    return res.status(400).json({ error: "❌ Server full" });
  }

  if (!categories.includes(category)) categories.push(category);
  running = true;

  console.log(`Starting OGbot with ID: ${category}`);
  res.json({ success: true, "user id": categories });
});

app.post("/stop", (req, res) => {
  running = false;
  categories = [];
  console.log("Worker stopped");
  res.json({ success: true, message: "Worker stopped" });
});

app.get("/status", (req, res) => {
  res.json({
    running,
    "user id": categories,
    slotsUsed: categories.length,
    slotsMax: MAX_SLOTS,
  });
});

// ---- Start server ----
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
