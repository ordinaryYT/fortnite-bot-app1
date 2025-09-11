import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

let OGbotClient = null;
let categories = [];       // currently active categories
let history = [];          // all categories ever used
const MAX_SLOTS = 10;

// --- Server + WebSocket for logs ---
const server = app.listen(process.env.PORT || 10000, () =>
  console.log(`✅ OGbot Control Server running on port ${process.env.PORT || 10000}`)
);
const wss = new WebSocketServer({ server });

// --- Log patch ---
const originalLog = console.log;
console.log = (...args) => {
  const msg = args.join(" ");

  // filter spammy playlist logs
  if (msg.includes("playlist_")) return;

  let formatted = msg
    .replace("Categories:", "Server:")
    .replace("Bots per Shard:", "Server Capacity:");

  originalLog(formatted);

  // broadcast to frontend
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(formatted);
    }
  });
};

// --- OGbot Client ---
async function startOGbotClient(token) {
  const FNLB = await import("fnlb");
  const fnlb = new FNLB.default();

  async function start() {
    await fnlb.start({
      apiToken: token,
      numberOfShards: 1,
      botsPerShard: 10,
      categories: categories,
      logLevel: "INFO",
    });
  }

  async function restart() {
    console.log("🔄 Restarting OGbot client...");
    await fnlb.stop();
    await start();
  }

  await start();
  const interval = setInterval(restart, 3600000);
  OGbotClient = { fnlb, interval };
}

async function stopOGbotClient() {
  if (OGbotClient) {
    clearInterval(OGbotClient.interval);
    await OGbotClient.fnlb.stop();
    OGbotClient = null;
    categories = [];
    console.log("🛑 OGbot client stopped");
    return true;
  }
  return false;
}

// --- API ROUTES ---

// Start a bot slot
app.post("/start", async (req, res) => {
  const { category } = req.body;
  const token = process.env.API_TOKEN;

  if (!token) return res.status(500).json({ error: "API_TOKEN missing" });
  if (!category) return res.status(400).json({ error: "Category ID required" });

  if (categories.length >= MAX_SLOTS) {
    return res.status(400).json({ error: `❌ Server full (${MAX_SLOTS}/${MAX_SLOTS} slots used)` });
  }

  if (categories.includes(category)) {
    return res.status(400).json({ error: `⚠️ Category ${category} already in use` });
  }

  categories.push(category);
  if (!history.includes(category)) history.push(category);

  if (!OGbotClient) {
    try {
      await startOGbotClient(token);
      return res.json({ message: `🚀 OGbot client started with category ${category} (slot 1 of ${MAX_SLOTS})` });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to start OGbot client" });
    }
  } else {
    return res.json({ message: `✅ Category ${category} added (slot ${categories.length} of ${MAX_SLOTS})` });
  }
});

// Stop
app.post("/stop", async (req, res) => {
  const stopped = await stopOGbotClient();
  res.json({ message: stopped ? "🛑 OGbot client stopped" : "No active client" });
});

// Status
app.get("/status", (req, res) => {
  res.json({
    running: !!OGbotClient,
    usedSlots: categories.length,
    maxSlots: MAX_SLOTS,
    runningCategories: categories,
    history,
  });
});

// Public bots list
app.get("/public-bots", (req, res) => {
  const bots = Array.from({ length: 75 }, (_, i) => `OGsbot${i + 1}`);
  res.json({ bots });
});

// Serve frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
