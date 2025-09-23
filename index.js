const express = require("express");
const { Client, GatewayIntentBits } = require("discord.js");
const bodyParser = require("body-parser");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

// ✅ Command queue for your PC
let commandQueue = [];
const COMMAND_SECRET = process.env.COMMAND_SECRET || null;

// Middleware to check secret if set
function checkSecret(req, res, next) {
  if (COMMAND_SECRET) {
    const token = req.headers["x-command-secret"];
    if (token !== COMMAND_SECRET) {
      return res.status(403).json({ error: "Forbidden: invalid secret" });
    }
  }
  next();
}

// === Existing routes (keep your original ones) ===
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/create-bot", (req, res) => {
  const { fortniteName } = req.body;
  console.log("Bot creation requested:", fortniteName);
  res.json({ success: true, message: "Bot creation request sent" });
});

app.post("/request-user-id", (req, res) => {
  const { name } = req.body;
  console.log("User ID request from:", name);
  res.json({ success: true, message: "User ID request logged" });
});

// === New: queue an execute command ===
app.post("/execute-command", checkSecret, (req, res) => {
  const { command } = req.body;
  if (!command) {
    return res.status(400).json({ success: false, error: "Missing command" });
  }

  // Push into queue
  commandQueue.push({ id: Date.now(), command });

  console.log("Queued command:", command);
  res.json({ success: true, message: "Command queued", queueLength: commandQueue.length });
});

// === PC polling routes ===

// Fetch the next command from queue
app.get("/fetch-command", checkSecret, (req, res) => {
  if (commandQueue.length === 0) {
    return res.json({}); // 🔹 flatten empty response
  }
  const next = commandQueue[0];
  // 🔹 Flatten so AHK gets {"id":123, "command":"text"}
  res.json(next);
});

// Acknowledge command (remove from queue once executed)
app.post("/ack-command", checkSecret, (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ success: false, error: "Missing id" });
  }
  commandQueue = commandQueue.filter(cmd => cmd.id !== id);
  res.json({ success: true, message: "Command acknowledged" });
});

// === Discord client login ===
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

if (DISCORD_TOKEN) {
  client.login(DISCORD_TOKEN).catch(err => {
    console.error("Failed to login to Discord:", err.message);
  });
} else {
  console.warn("⚠️ No DISCORD_TOKEN provided, Discord features disabled.");
}

// === Start server ===
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
