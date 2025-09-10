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

// --- LOG PATCH (filters + replaces text, keeps logs visible) ---
const originalLog = console.log;
console.log = (...args) => {
  const msg = args.join(" ");

  // 1. Skip spam logs like playlist_xxx
  if (msg.includes("playlist_")) return;

  // 2. Replace wording for cluster/server logs
  let formatted = msg
    .replace("Categories:", "Server:")
    .replace("Bots per Shard:", "Server Capacity:");

  // Always show in Render logs
  originalLog(formatted);
};

// --- FNLB Worker ---
async function startFNLBWorker(categories, token) {
  const FNLB = await import("fnlb");
  const fnlb = new FNLB.default();

  async function start() {
    await fnlb.start({
      apiToken: token,
      numberOfShards: 1,
      botsPerShard: 10, // 10 bots per shard
      categories: categories, // multiple categories
      logLevel: "INFO",
    });
  }

  async function restart() {
    console.log("🔄 Restarting FNLB...");
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
    console.log("🛑 Worker stopped");
    return true;
  }
  return false;
}

// --- API ROUTES ---

// Start FNLB
app.post("/start", async (req, res) => {
  const { categories } = req.body; // expect an array
  const token = process.env.API_TOKEN;

  if (!categories || !Array.isArray(categories)) {
    return res.status(400).json({ error: "Categories array required" });
  }
  if (!token) {
    return res.status(500).json({ error: "API_TOKEN missing" });
  }

  if (worker) await stopFNLBWorker();

  try {
    await startFNLBWorker(categories, token);
    res.json({ message: `🚀 FNLB worker started with servers: ${categories.join(", ")}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start FNLB worker" });
  }
});

// Stop FNLB
app.post("/stop", async (req, res) => {
  const stopped = await stopFNLBWorker();
  res.json({ message: stopped ? "🛑 FNLB worker stopped" : "No active worker" });
});

// Status check
app.get("/status", (req, res) => {
  res.json({ running: !!worker });
});

// Serve frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// --- SERVER START ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ FNLB Render server running on port ${PORT}`));
