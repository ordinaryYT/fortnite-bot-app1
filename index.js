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
let usedSlots = 0;
const MAX_SLOTS = 10;

// --- LOG PATCH (filters + replaces text, keeps logs visible) ---
const originalLog = console.log;
console.log = (...args) => {
  const msg = args.join(" ");

  // skip spammy playlist logs
  if (msg.includes("playlist_")) return;

  // rename terms
  let formatted = msg
    .replace("Categories:", "Server:")
    .replace("Bots per Shard:", "Server Capacity:");

  originalLog(formatted);
};

// --- FNLB Worker ---
async function startFNLBWorker(category, token) {
  const FNLB = await import("fnlb");
  const fnlb = new FNLB.default();

  async function start() {
    await fnlb.start({
      apiToken: token,
      numberOfShards: 1,
      botsPerShard: 10, // 10 bots per shard
      categories: Array(MAX_SLOTS).fill(category), // fill with same category until full
      logLevel: "INFO",
    });
  }

  async function restart() {
    console.log("🔄 Restarting FNLB...");
    await fnlb.stop();
    await start();
  }

  await start();
  const interval = setInterval(restart, 3600000);

  worker = { fnlb, interval };
}

async function stopFNLBWorker() {
  if (worker) {
    clearInterval(worker.interval);
    await worker.fnlb.stop();
    worker = null;
    usedSlots = 0;
    console.log("🛑 Worker stopped");
    return true;
  }
  return false;
}

// --- API ROUTES ---

// Start (assigns one slot at a time until 10 reached)
app.post("/start", async (req, res) => {
  const token = process.env.API_TOKEN;
  const category = "default-category"; // static or you can swap later

  if (!token) return res.status(500).json({ error: "API_TOKEN missing" });

  if (usedSlots >= MAX_SLOTS) {
    return res.status(400).json({ error: "❌ Server is full (10/10 slots used)" });
  }

  if (!worker) {
    try {
      await startFNLBWorker(category, token);
      usedSlots = 1;
      return res.json({ message: `🚀 FNLB worker started (slot 1 of ${MAX_SLOTS})` });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to start FNLB worker" });
    }
  } else {
    usedSlots++;
    return res.json({ message: `✅ Slot ${usedSlots} of ${MAX_SLOTS} now in use` });
  }
});

// Stop (clears everything)
app.post("/stop", async (req, res) => {
  const stopped = await stopFNLBWorker();
  res.json({ message: stopped ? "🛑 FNLB worker stopped" : "No active worker" });
});

// Status
app.get("/status", (req, res) => {
  res.json({ running: !!worker, usedSlots, maxSlots: MAX_SLOTS });
});

// Serve frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// --- SERVER START ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ FNLB Render server running on port ${PORT}`));
