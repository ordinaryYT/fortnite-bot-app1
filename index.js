import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Worker + log streaming
let worker = null;
let logListeners = [];

// --- Log interception ---
const original = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};
const originalWrite = process.stdout.write.bind(process.stdout);

function timestamp() {
  return new Date().toISOString().split("T")[1].split(".")[0]; // HH:MM:SS
}

function broadcastLog(message) {
  if (!message || !message.trim()) return;

  let clean = message;

  // Remove "fnlb"
  clean = clean.replace(/fnlb/gi, "");

  // Remove standard log tags
  clean = clean.replace(/^\[(LOG|INFO|WARN|ERROR)\]\s*/i, "");

  // Remove [Bot] [something] [✓]
  clean = clean.replace(/\[Bot\]\s*\[[^\]]+\]\s*\[✓\]\s*/gi, "");

  // Remove client/replyclient/cosmetic manager tags but keep message
  clean = clean.replace(/\b(client|replyclient|cosmetic manager)\b/gi, "");

  // Cleanup extra spaces
  clean = clean.trim();
  if (!clean) return;

  const line = `[${timestamp()}] ${clean}`;
  logListeners.forEach((res) => res.write(`data: ${line}\n\n`));
}

function wrapConsole(method) {
  return (...args) => {
    const msg = args.join(" ");
    original[method](msg);
    broadcastLog(`[${method.toUpperCase()}] ${msg}`);
  };
}

// Replace console methods
console.log = wrapConsole("log");
console.info = wrapConsole("info");
console.warn = wrapConsole("warn");
console.error = wrapConsole("error");

// Intercept stdout writes (catches anything FNLB might print directly)
process.stdout.write = (chunk, encoding, callback) => {
  const msg = chunk.toString();
  originalWrite(chunk, encoding, callback);
  broadcastLog(msg);
};

// --- Worker functions ---
async function startWorker(category, token) {
  const FNLB = await import("fnlb");
  const fnlb = new FNLB.default();

  async function start() {
    await fnlb.start({
      apiToken: token,
      numberOfShards: 1,
      botsPerShard: 1,
      categories: [category],
      logLevel: "INFO",
    });
  }

  async function restart() {
    console.log("Restarting worker...");
    await fnlb.stop();
    await start();
  }

  await start();
  const interval = setInterval(restart, 3600000); // restart every hour
  worker = { fnlb, interval };
}

async function stopWorker() {
  if (worker) {
    clearInterval(worker.interval);
    await worker.fnlb.stop();
    worker = null;
    console.log("Worker stopped");
    return true;
  }
  return false;
}

// --- API endpoints ---
app.post("/start", async (req, res) => {
  const { category } = req.body;
  const token = process.env.API_TOKEN;

  if (!category) return res.status(400).json({ error: "Category required" });
  if (!token) return res.status(500).json({ error: "API_TOKEN missing" });

  if (worker) await stopWorker();

  try {
    await startWorker(category, token);
    res.json({ message: `Worker started in category ${category}` });
    console.log(`Worker started in category ${category}`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start worker" });
    console.log("Error: failed to start worker");
  }
});

app.post("/stop", async (req, res) => {
  const stopped = await stopWorker();
  if (stopped) res.json({ message: "Worker stopped" });
  else res.json({ message: "No active worker" });
});

app.get("/status", (req, res) => {
  res.json({ running: !!worker });
});

app.get("/logs", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  logListeners.push(res);

  req.on("close", () => {
    logListeners = logListeners.filter((r) => r !== res);
  });
});

// --- Start server ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
