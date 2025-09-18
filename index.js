import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import Discord from "discord.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

let logListeners = [];
let categories = [];
let worker = null;
const MAX_SLOTS = 10;

// Discord bot setup
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
let inboxMessages = [];

const client = new Discord.Client({
  intents: [
    Discord.GatewayIntentBits.Guilds,
    Discord.GatewayIntentBits.GuildMessages,
    Discord.GatewayIntentBits.MessageContent,
  ],
});

client.once("ready", () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== DISCORD_CHANNEL_ID) return;

  const content = message.content.toLowerCase();

  if (content.startsWith("approve ")) {
    const parts = message.content.split(" ");
    if (parts.length >= 2) {
      const userID = parts[1];
      inboxMessages.push({
        type: "user_id",
        message: `Your user ID has been approved: ${userID}`,
        date: new Date().toLocaleString(),
      });
      message.reply(`User ID ${userID} approved and added to inbox.`);
    }
  }

  if (content.startsWith("approve bot ")) {
    const parts = message.content.split(" ");
    if (parts.length >= 3) {
      const botName = parts[2];
      inboxMessages.push({
        type: "bot",
        message: `Your bot ${botName} has been approved.`,
        date: new Date().toLocaleString(),
      });
      message.reply(`Bot ${botName} approved and added to inbox.`);
    }
  }
});

if (DISCORD_TOKEN) {
  client.login(DISCORD_TOKEN);
} else {
  console.log("DISCORD_TOKEN not set, skipping bot login");
}

// ---- Timestamp helper ----
function timestamp() {
  return new Date().toISOString().split("T")[1].split(".")[0];
}

// ---- Send logs to frontend (with cleaning & replacements) ----
function sendToFrontendLogs(rawMessage) {
  if (!rawMessage && rawMessage !== 0) return;
  const lines = String(rawMessage).split(/\r?\n/);

  for (let line of lines) {
    if (!line.trim()) continue;

    // Clean version for frontend
    let clean = line.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").trim();

    // sanitize sensitive stuff
    clean = clean.replace(/fnlb/gi, ""); // hide fnlb
    clean = clean.replace(/\[\d{2}:\d{2}:\d{2}\]/g, "").trim();

    // filters
    if (/playlist_/i.test(clean)) continue;
    if (/ua:/i.test(clean)) continue;
    if (/pb:/i.test(clean)) continue;
    if (/hotfix/i.test(clean)) continue;
    if (/netCL/i.test(clean)) continue;
    if (/Connecting \(http/i.test(clean)) continue;

    // replacements
    clean = clean.replace(
      /Starting shard with ID:\s*(.+)/i,
      "Starting OGbot with ID: $1"
    );
    clean = clean.replace(/categories:\s*/gi, "User ID: ");

    if (/Cluster:.*User ID:/i.test(clean)) {
      const slotsUsed = categories.length;
      clean = `user id: ${slotsUsed}. server slots used: ${slotsUsed}/${MAX_SLOTS}`;
    }

    clean = clean.replace(/^\[[^\]]+\]\s*/g, "").trim();
    if (!clean.trim()) continue;

    const out = `[${timestamp()}] ${clean}`;
    logListeners.forEach((res) => {
      try {
        res.write(`data: ${out}\n\n`);
      } catch {}
    });
  }
}

// ---- Hook console logs + stdout (frontend sanitized, Render raw) ----
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
const originalWrite = process.stdout.write.bind(process.stdout);

// console.log
console.log = (...args) => {
  const msg = args
    .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
    .join(" ");
  sendToFrontendLogs(msg); // sanitized for website
  originalLog(...args); // raw for Render
};

// console.warn
console.warn = (...args) => {
  const msg = args
    .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
    .join(" ");
  sendToFrontendLogs("[WARN] " + msg);
  originalWarn(...args);
};

// console.error
console.error = (...args) => {
  const msg = args
    .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
    .join(" ");
  sendToFrontendLogs("[ERROR] " + msg);
  originalError(...args);
};

// stdout (fnlb + other libs write here)
process.stdout.write = (chunk, encoding, callback) => {
  try {
    sendToFrontendLogs(chunk); // sanitized copy to frontend
  } catch {}
  return originalWrite(chunk, encoding, callback); // raw to Render
};

// ---- fnlb worker logic ----
async function startWorker(token) {
  const FNLB = await import("fnlb");
  const fnlb = new FNLB.default();

  async function start() {
    await fnlb.start({
      apiToken: token,
      numberOfShards: 1,
      botsPerShard: 10,
      categories,
      logLevel: "INFO",
    });
  }

  async function restart() {
    console.log("🔄 Restarting worker...");
    try {
      await fnlb.stop();
    } catch {}
    await start();
  }

  await start();
  const interval = setInterval(restart, 3600000);
  worker = { fnlb, interval };
  return true;
}

async function stopWorker() {
  if (worker) {
    clearInterval(worker.interval);
    try {
      await worker.fnlb.stop();
    } catch {}
    worker = null;
    categories = [];
    return true;
  }
  return false;
}

// ---- Routes ----
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
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

app.post("/start", async (req, res) => {
  const { category } = req.body;
  const token = process.env.API_TOKEN;
  if (!token) return res.status(500).json({ error: "API_TOKEN missing" });
  if (!category) return res.status(400).json({ error: "user id required" });
  if (categories.length >= MAX_SLOTS)
    return res.status(400).json({ error: "❌ Server full" });

  if (!categories.includes(category)) categories.push(category);

  if (!worker) {
    const started = await startWorker(token);
    if (started) res.json({ success: true, "user id": categories });
    else res.status(500).json({ error: "Failed to start worker" });
  } else {
    try {
      await stopWorker();
      await startWorker(token);
      res.json({ success: true, "user id": categories });
    } catch {
      res.status(500).json({ error: "Failed to update categories" });
    }
  }
});

app.post("/stop", async (req, res) => {
  const stopped = await stopWorker();
  if (stopped) res.json({ success: true, message: "Worker stopped" });
  else res.json({ success: false, message: "No worker running" });
});

app.get("/status", (req, res) => {
  res.json({
    running: !!worker,
    "user id": categories,
    slotsUsed: categories.length,
    slotsMax: MAX_SLOTS,
  });
});

// New routes for Discord integration
app.get("/inbox", (req, res) => {
  res.json(inboxMessages);
});

app.post("/request-user-id", (req, res) => {
  const channel = client.channels.cache.get(DISCORD_CHANNEL_ID);
  if (channel) {
    channel.send("User requested a user ID.");
    res.json({
      success: true,
      message:
        "User ID request sent. It may take up to 24 hours to receive your ID.",
    });
  } else {
    res.status(500).json({ error: "Discord channel not found." });
  }
});

app.post("/create-bot", (req, res) => {
  const {
    fortniteName,
    autoAcceptInvites,
    autoAcceptFriends,
    startSkin,
    joinEmote,
    accountLevel,
  } = req.body;
  const channel = client.channels.cache.get(DISCORD_CHANNEL_ID);
  if (channel) {
    const message = `User requested bot creation:
Fortnite Name: ${fortniteName}
Auto Accept Invites: ${autoAcceptInvites}
Auto Accept Friends: ${autoAcceptFriends}
Start Skin: ${startSkin}
Join Emote: ${joinEmote}
Account Level: ${accountLevel}`;
    channel.send(message);
    res.json({
      success: true,
      message:
        "Bot creation request sent. It may take up to 24 hours to be approved.",
    });
  } else {
    res.status(500).json({ error: "Discord channel not found." });
  }
});

// ---- Start server ----
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
