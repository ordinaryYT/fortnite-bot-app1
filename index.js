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
let categories = []; // dynamic slots
const MAX_SLOTS = 10;

// --- LOG PATCH ---
const originalLog = console.log;
console.log = (...args) => {
  const msg = args.join(" ");
  if (msg.includes("playlist_")) return; // filter playlist spam
  let formatted = msg
    .replace("Categories:", "Server:")
    .replace("Bots per Shard:", "Server Capacity:");
  originalLog(formatted);
};

// --- FNLB Worker ---
async function startFNLBWorker(token) {
  const FNLB = await import("fnlb");
  const fnlb = new FNLB.default();

  async function start() {
    await fnlb.start({
      apiToken: token,
      numberOfShards: 1,
      botsPerShard: 10,
      categories: categories, // dynamic array
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
    categories = [];
    console.log("🛑 Worker stopped");
    return true;
  }
  return false;
}

// --- API ROUTES ---

// Start: add a new category (slot)
app.post("/start", async (req, res) => {
  const { category } = req.body;
  const token = process.env.API_TOKEN;

  if (!token) return res.status(500).json({ error: "API_TOKEN missing" });
  if (!category) return res.status(400).json({ error: "Category ID required" });

  if (categories.length >= MAX_SLOTS) {
    return res.status(400).json({ error: `❌ Server full (${MAX_SLOTS}/${MAX_SLOTS} slots used)` });
  }

  categories.push(category);

  if (!worker) {
    try {
      await startFNLBWorker(token);
      return res.json({ message: `🚀 FNLB started with category ${category} (slot 1 of ${MAX_SLOTS})` });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to start FNLB worker" });
    }
  } else {
    return res.json({ message: `✅ Category ${category} added (slot ${categories.length} of ${MAX_SLOTS})` });
  }
});

// Stop worker (reset all slots)
app.post("/stop", async (req, res) => {
  const stopped = await stopFNLBWorker();
  res.json({ message: stopped ? "🛑 FNLB worker stopped" : "No active worker" });
});

// Status
app.get("/status", (req, res) => {
  res.json({ running: !!worker, usedSlots: categories.length, maxSlots: MAX_SLOTS, categories });
});

// Serve frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// --- SERVER START ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ FNLB Render server running on port ${PORT}`));
