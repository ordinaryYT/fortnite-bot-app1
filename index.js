import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve HTML
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

let bots = new Map();
let categories = [];
const MAX_SLOTS = 10;
let logListeners = [];

// ========== EXISTING FNLB BOT FUNCTIONS ==========
async function startBotForCategory(category, token) {
  try {
    const FNLB = await import("fnlb");
    const fnlb = new FNLB.default();
    await fnlb.start({
      apiToken: token,
      numberOfShards: 1,
      botsPerShard: 10,
      categories: [category],
      logLevel: "INFO",
    });
    bots.set(category, { fnlb });
    return true;
  } catch (error) {
    console.error("Failed to start bot:", error);
    return false;
  }
}

async function stopBotForCategory(category) {
  const bot = bots.get(category);
  if (bot) {
    try { await bot.fnlb.stop(); } catch {}
    bots.delete(category);
    return true;
  }
  return false;
}

async function stopAllBots() {
  for (const [category] of bots) {
    await stopBotForCategory(category);
  }
  categories = [];
}

// ========== API ROUTES ==========
app.post("/start", async (req, res) => {
  const { category } = req.body;
  const token = process.env.API_TOKEN;
  if (!token) return res.status(500).json({ error: "API_TOKEN missing" });
  if (!category) return res.status(400).json({ error: "Category required" });
  if (categories.length >= MAX_SLOTS) return res.status(500).json({ error: "Server full" });

  if (!categories.includes(category)) categories.push(category);
  const started = await startBotForCategory(category, token);
  if (started) res.json({ success: true, categories });
  else res.status(500).json({ error: "Failed to start bot" });
});

app.post("/stop", async (req, res) => {
  const { category } = req.body;
  if (category) {
    const stopped = await stopBotForCategory(category);
    categories = categories.filter(c => c !== category);
    res.json({ success: stopped, categories });
  } else {
    await stopAllBots();
    res.json({ success: true, categories: [] });
  }
});

app.get("/status", (req, res) => {
  res.json({
    running: bots.size > 0,
    categories,
    slotsUsed: categories.length,
    slotsMax: MAX_SLOTS,
  });
});

app.get("/logs", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  logListeners.push(res);
  req.on("close", () => {
    logListeners = logListeners.filter((r) => r !== res);
  });
});

// NEW CHATBOX ENDPOINT
app.post("/command", (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: "Command required" });
  console.log(`💬 New command: ${command}`);
  logListeners.forEach((r) => {
    try { r.write(`data:COMMAND:${command}\n\n`); } catch {}
  });
  res.json({ success: true, command });
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 OGbots server running on port ${PORT}`));
