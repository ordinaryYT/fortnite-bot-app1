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

// Simple helper to broadcast logs
function broadcastLog(message) {
  const clean = message.replace(/fnlb/gi, ""); // remove "fnlb"
  logListeners.forEach(res => res.write(`data: ${clean}\n\n`));
}

// Start worker
async function startWorker(category, token) {
  const FNLB = await import("fnlb");
  const fnlb = new FNLB.default();

  async function start() {
    await fnlb.start({
      apiToken: token,
      numberOfShards: 1,
      botsPerShard: 1,
      categories: [category],
      logLevel: "INFO"
    });
  }

  async function restart() {
    console.log("Restarting worker...");
    await fnlb.stop();
    await start();
  }

  // Forward logs from fnlb
  fnlb.on("log", (msg) => {
    console.log("Worker log:", msg);
    broadcastLog(msg);
  });

  await start();
  const interval = setInterval(restart, 3600000); // restart every hour
  worker = { fnlb, interval };
}

// Stop worker
async function stopWorker() {
  if (worker) {
    clearInterval(worker.interval);
    await worker.fnlb.stop();
    worker = null;
    broadcastLog("Worker stopped");
    return true;
  }
  return false;
}

// Start endpoint
app.post("/start", async (req, res) => {
  const { category } = req.body;
  const token = process.env.API_TOKEN;

  if (!category) return res.status(400).json({ error: "Category required" });
  if (!token) return res.status(500).json({ error: "API_TOKEN missing" });

  if (worker) await stopWorker();

  try {
    await startWorker(category, token);
    res.json({ message: `Worker started in category ${category}` });
    broadcastLog(`Worker started in category ${category}`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start worker" });
    broadcastLog("Error: failed to start worker");
  }
});

// Stop endpoint
app.post("/stop", async (req, res) => {
  const stopped = await stopWorker();
  if (stopped) res.json({ message: "Worker stopped" });
  else res.json({ message: "No active worker" });
});

// Status endpoint
app.get("/status", (req, res) => {
  res.json({ running: !!worker });
});

// Logs endpoint (SSE)
app.get("/logs", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  logListeners.push(res);

  req.on("close", () => {
    logListeners = logListeners.filter(r => r !== res);
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
