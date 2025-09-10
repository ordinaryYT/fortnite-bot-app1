import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

let worker = null;
let logListeners = [];
let runningBotsCount = 0; // track how many bots are active
const MAX_BOTS = 10;

// --- Logging system unchanged ---
const original = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};
const originalWrite = process.stdout.write.bind(process.stdout);

function timestamp() {
  return new Date().toISOString().split("T")[1].split(".")[0];
}

function broadcastLog(rawMessage) {
  if (!rawMessage && rawMessage !== 0) return;
  let message = String(rawMessage);
  const lines = message.split(/\r?\n/);

  for (let line of lines) {
    if (!line || !line.trim()) continue;
    const out = `[${timestamp()}] ${line.trim()}`;
    logListeners.forEach((res) => {
      try {
        res.write(`data: ${out}\n\n`);
      } catch {}
    });
  }
}

function wrapConsole(method) {
  return (...args) => {
    const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    original[method](...args);
    broadcastLog(msg);
  };
}

console.log = wrapConsole("log");
console.info = wrapConsole("info");
console.warn = wrapConsole("warn");
console.error = wrapConsole("error");

process.stdout.write = (chunk, encoding, callback) => {
  try {
    originalWrite(chunk, encoding, callback);
  } catch {}
  broadcastLog(chunk);
};

// --- Worker functions ---
async function startWorker(botId, token) {
  const FNLB = await import("fnlb");
  const fnlb = new FNLB.default();

  async function start() {
    await fnlb.start({
      apiToken: token,
      numberOfShards: 1,
      botsPerShard: 1,
      categories: [botId],
      logLevel: "INFO",
    });
  }

  await start();
  worker = { fnlb };
}

async function stopWorker() {
  if (worker) {
    try {
      await worker.fnlb.stop();
    } catch (e) {
      console.warn("fnlb stop error:", e);
    }
    worker = null;
    console.log("Worker stopped");
    return true;
  }
  return false;
}

// --- API endpoints ---
app.post("/start", async (req, res) => {
  const { botId } = req.body;
  const token = process.env.API_TOKEN;
  if (!botId) return res.status(400).json({ error: "Bot ID required" });
  if (!token) return res.status(500).json({ error: "API_TOKEN missing" });

  if (runningBotsCount >= MAX_BOTS) {
    return res.status(400).json({ error: "Max server capacity reached (10 bots)" });
  }

  try {
    await startWorker(botId, token);
    runningBotsCount++;
    res.json({ message: `Bot ${botId} started`, running: true, count: runningBotsCount });
    console.log(`Bot ${botId} started (now ${runningBotsCount}/${MAX_BOTS})`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start bot" });
  }
});

app.post("/stop", async (req, res) => {
  const stopped = await stopWorker();
  if (stopped) {
    runningBotsCount = Math.max(0, runningBotsCount - 1);
    res.json({ message: "Bot stopped", running: false, count: runningBotsCount });
  } else {
    res.json({ message: "No active worker", running: false, count: runningBotsCount });
  }
});

app.get("/status", (req, res) => {
  res.json({ running: runningBotsCount > 0, count: runningBotsCount });
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
