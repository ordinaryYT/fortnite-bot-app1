import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve HTML file directly
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

let bots = new Map(); // Map to store multiple bot instances by category
let categories = [];
const MAX_SLOTS = 10;
let logListeners = [];

// Enhanced log system with better organization
let replyContinuation = 0;
const REPLY_ALLOW_LINES = 12;

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

function isJunkLine(text) {
  return (
    /^\s*[{]/.test(text) ||
    /^\s*[}\]]\s*,?$/.test(text) ||
    /\bmmsTicketPlaylistHotfixIdOverrides:/i.test(text) ||
    /\bua:/i.test(text) ||
    /\bpb:/i.test(text) ||
    /\bhotfix:/i.test(text) ||
    /\bnetcl/i.test(text) ||
    /\bplaylistRevisions:/i.test(text) ||
    /\bDownloaded metadata\b/i.test(text) ||
    /\bDownloaded \d+\s*BN\b/i.test(text) ||
    /\bShard bots:/i.test(text) ||
    /\bTotal Bots:/i.test(text) ||
    /\bTotal Categories:/i.test(text) ||
    /Connecting\s*\(https?:\/\//i.test(text) ||
    /playlist_/i.test(text) ||
    /Checking for updates/i.test(text) ||
    /v\d+\.\d+\.\d+ is up to date/i.test(text) ||
    /Finished loading v\d+\.\d+\.\d+/i.test(text) ||
    /OGsbot Requesting bots/i.test(text) ||
    /Starting shard with ID:/i.test(text) ||
    /Stopping shard with ID:/i.test(text) ||
    /All shards stopped/i.test(text) ||
    /Shard .* stopped/i.test(text) ||
    /fnlb/gi.test(text) // Hide all fnlb references
  );
}

function broadcastLog(rawMessage) {
  if (!rawMessage && rawMessage !== 0) return;
  let message = String(rawMessage);
  const lines = message.split(/\r?\n/);

  for (let line of lines) {
    if (!line || !line.trim()) continue;
    let clean = line;

    // 1) Basic sanitization - remove all fnlb references
    clean = clean.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
    clean = clean.replace(/fnlb/gi, "OGsystem");
    clean = clean.replace(/^\s*\[(LOG|INFO|ERROR)\]\s*/i, "");
    clean = clean.replace(/^\s*\[WARN\]\s*/i, "[WARN] ");

    // 2) Skip duplicate lines (remove timestamps first for comparison)
    const cleanWithoutTime = clean.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "");
    
    // 3) Skip only very specific junk lines
    if (isJunkLine(cleanWithoutTime)) {
      if (/\b(error|warn|!|\[!\])\b/i.test(cleanWithoutTime)) {
        // show error/warn lines anyway
      } else {
        continue;
      }
    }

    // 4) Remove ✓ and [i], keep [!]
    clean = clean.replace(/\[\s*✓\s*\]|\[\s*i\s*\]/gi, "").trim();

    // 5) Apply specific text replacements
    clean = clean.replace(/Cluster:/gi, "User:");
    clean = clean.replace(/Categories: (\d+)/gi, "Server Space Usage: $1/10");
    clean = clean.replace(/Bots per Shard:/gi, "Server Capacity:");
    clean = clean.replace(/worker/gi, "bot"); // Replace worker with bot
    clean = clean.replace(/Worker/gi, "Bot"); // Replace Worker with Bot

    // 6) Remove duplicate timestamps from the message itself
    clean = clean.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "");

    // 7) Skip empty lines after processing
    if (!clean.trim()) continue;

    // 8) Add our own clean timestamp and format
    const out = `[${timestamp()}] ${clean}`;
    
    // 9) Send to all connected clients
    logListeners.forEach((res) => {
      try { res.write(`data: ${out}\n\n`); } catch {}
    });
  }
}

// Console wrappers
function wrapConsole(method) {
  return (...args) => {
    const msg = args.map((a) => {
      if (a instanceof Error) return a.stack || String(a);
      if (a && typeof a === "object") {
        try { return JSON.stringify(a); } catch { return String(a); }
      }
      return String(a);
    }).join(" ");
    original[method](...args);
    
    // Don't broadcast duplicates
    const currentTime = new Date().toISOString().split("T")[1].split(".")[0];
    const timePattern = /\[\d{2}:\d{2}:\d{2}\]/;
    if (!timePattern.test(msg)) {
      broadcastLog(msg);
    }
  };
}

console.log = wrapConsole("log");
console.info = wrapConsole("info");
console.warn = wrapConsole("warn");
console.error = wrapConsole("error");

process.stdout.write = (chunk, encoding, callback) => {
  try { originalWrite(chunk, encoding, callback); } catch {}
  // Don't broadcast raw stdout writes to avoid duplicates
};

// --- Bot functions with proper multi-category support ---
async function startBotForCategory(category, token) {
  try {
    const FNLB = await import("fnlb");
    const fnlb = new FNLB.default();

    async function start() {
      await fnlb.start({
        apiToken: token,
        numberOfShards: 1,
        botsPerShard: 10,
        categories: [category], // Single category per bot
        logLevel: "INFO",
      });
    }

    async function restart() {
      console.log(`🔄 Restarting bot for category ${category}...`);
      try { await fnlb.stop(); } catch (e) { console.warn(`OGsystem stop error for ${category}:`, e); }
      await start();
    }

    await start();
    const interval = setInterval(restart, 3600000);
    bots.set(category, { fnlb, interval });
    return true;
  } catch (error) {
    console.error(`Failed to start bot for category ${category}:`, error);
    return false;
  }
}

async function stopBotForCategory(category) {
  const bot = bots.get(category);
  if (bot) {
    clearInterval(bot.interval);
    try { 
      await bot.fnlb.stop(); 
      console.log(`🛑 Bot stopped for category ${category}`);
    } catch (e) { 
      console.warn(`OGsystem stop error for ${category}:`, e); 
    }
    bots.delete(category);
    return true;
  }
  return false;
}

async function stopAllBots() {
  const stopPromises = [];
  for (const [category] of bots) {
    stopPromises.push(stopBotForCategory(category));
  }
  await Promise.all(stopPromises);
  categories = [];
}

// --- API endpoints with proper multi-category support ---
app.post("/start", async (req, res) => {
  const { category } = req.body;
  const token = process.env.API_TOKEN;

  if (!token) return res.status(500).json({ error: "API_TOKEN missing" });
  if (!category) return res.status(400).json({ error: "Category required" });

  if (categories.length >= MAX_SLOTS)
    return res.status(500).json({ error: "❌ Server full" });

  if (!categories.includes(category)) {
    categories.push(category);
  }

  try {
    const started = await startBotForCategory(category, token);
    if (started) {
      console.log(`✅ Bot started with category ${category}`);
      res.json({ success: true, categories, message: `Category ${category} started` });
    } else {
      res.status(500).json({ error: "Failed to start bot" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start bot" });
  }
});

app.post("/stop", async (req, res) => {
  const { category } = req.body;
  
  if (category) {
    // Stop specific category
    const stopped = await stopBotForCategory(category);
    if (stopped) {
      categories = categories.filter(c => c !== category);
      res.json({ success: true, message: `Bot stopped for category ${category}`, categories });
    } else {
      res.json({ success: false, message: `No bot running for category ${category}` });
    }
  } else {
    // Stop all bots
    await stopAllBots();
    res.json({ success: true, message: "All bots stopped", categories: [] });
  }
});

app.get("/status", (req, res) => {
  res.json({
    running: bots.size > 0,
    categories,
    slotsUsed: categories.length,
    slotsMax: MAX_SLOTS,
    activeBots: bots.size
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

// --- Start server ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 OGsbots server running on port ${PORT}`));
