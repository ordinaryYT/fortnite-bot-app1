import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

let worker = null;

async function startFNLBWorker(category, token) {
  const FNLB = await import("fnlb");
  const fnlb = new FNLB.default();

  // --- LOG PATCH ---
  const originalLog = console.log;
  console.log = (...args) => {
    const msg = args.join(" ");

    // 1. Skip spam logs like playlist_xxx
    if (msg.includes("playlist_")) return;

    // 2. Replace words in cluster/server logs
    let formatted = msg
      .replace("Categories:", "Server:")
      .replace("Bots per Shard:", "Server Capacity:");

    originalLog(formatted);
  };

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
    console.log("Restarting FNLB...");
    await fnlb.stop();
    await start();
  }

  await start();
  const interval = setInterval(restart, 3600000); // restart every hour

  worker = { fnlb, interval };
}

async function stopFNLBWorker() {
  if (worker) {
    clearInterval(worker.interval);
    await worker.fnlb.stop();
    worker = null;
    console.log("Worker stopped");
    return true;
  }
  return false;
}

// --- API ROUTES ---

// Start FNLB
app.post("/start", async (req, res) => {
  const { category } = req.body;
  const token = process.env.API_TOKEN;

  if (!category) return res.status(400).json({ error: "Category required" });
  if (!token) return res.status(500).json({ error: "API_TOKEN missing" });

  if (worker) await stopFNLBWorker();

  try {
    await startFNLBWorker(category, token);
    res.json({ message: `FNLB worker started in server ${category}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start FNLB worker" });
  }
});

// Stop FNLB
app.post("/stop", async (req, res) => {
  const stopped = await stopFNLBWorker();
  res.json({ message: stopped ? "FNLB worker stopped" : "No active worker" });
});

// Status check
app.get("/status", (req, res) => {
  res.json({ running: !!worker });
});

// Serve frontend (index.html)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// --- SERVER START ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 FNLB Render server running on port ${PORT}`));
