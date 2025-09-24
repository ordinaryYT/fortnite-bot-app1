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

// Role IDs (replace with real role IDs or set via env)
const LOGS_ROLE_ID = process.env.LOGS_ROLE_ID || "123456789012345678";
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || "987654321098765432";

// Feature toggles
let logsEnabled = true;
let siteShutdown = false;

// Command queue for PC execution
let commandQueue = [];
const COMMAND_SECRET = process.env.COMMAND_SECRET || null;

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
  registerCommands();
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!DISCORD_CHANNEL_ID) return;
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

// ---------------------
// Slash command handling
// ---------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    // /logs action:on|off
    if (interaction.commandName === "logs") {
      const hasRole =
        interaction.member?.roles?.cache?.has(LOGS_ROLE_ID) || false;
      if (!hasRole) {
        return interaction.reply({ content: "You don't have permission to use this.", ephemeral: true });
      }
      const action = interaction.options.getString("action");
      logsEnabled = action === "on";
      return interaction.reply(`Logs have been turned ${logsEnabled ? "ON" : "OFF"}`);
    }

    // /shutdown
    if (interaction.commandName === "shutdown") {
      const hasRole =
        interaction.member?.roles?.cache?.has(ADMIN_ROLE_ID) || false;
      if (!hasRole) {
        return interaction.reply({ content: "You don't have permission to use this.", ephemeral: true });
      }
      siteShutdown = true;
      return interaction.reply("Shut down command received. The app is now marked as shutdown.");
    }

    // /turnon
    if (interaction.commandName === "turnon") {
      const hasRole =
        interaction.member?.roles?.cache?.has(ADMIN_ROLE_ID) || false;
      if (!hasRole) {
        return interaction.reply({ content: "You don't have permission to use this.", ephemeral: true });
      }
      siteShutdown = false;
      return interaction.reply("Turn on command received. The app is now back online.");
    }

    // /start
    if (interaction.commandName === "start") {
      const userId = interaction.options.getString("userid");
      // reply fast to avoid timeout
      await interaction.reply("Starting bot...");
      try {
        if (!userId) return interaction.followUp("user id required.");
        if (categories.length >= MAX_SLOTS) return interaction.followUp("Server full.");
        if (!categories.includes(userId)) categories.push(userId);

        if (!worker) {
          await startWorker(process.env.API_TOKEN);
        } else {
          await stopWorker();
          await startWorker(process.env.API_TOKEN);
        }
        return interaction.followUp({ content: `Started bot for User ID: ${userId}` });
      } catch (err) {
        console.error("Start error:", err);
        return interaction.followUp({ content: "Failed to start worker" });
      }
    }

    // /stop
    if (interaction.commandName === "stop") {
      await interaction.reply("Stopping worker...");
      try {
        const stopped = await stopWorker();
        return interaction.followUp(stopped ? "Worker stopped" : "No worker running");
      } catch (err) {
        console.error("Stop error:", err);
        return interaction.followUp("Failed to stop worker");
      }
    }

    // /command  (keeps your original name "command" and description)
    if (interaction.commandName === "command") {
      const cmd = interaction.options.getString("command");
      // immediate reply
      await interaction.reply(`Queued command: ${cmd}`);
      // queue it
      commandQueue.push({ id: Date.now(), command: cmd });
      console.log("Queued command:", cmd);
      return;
    }

    // /prefix-command  (this was "prefix command" in your original - Discord forbids spaces,
    // so we register "prefix-command" but keep your original description)
    if (interaction.commandName === "prefix-command") {
      const cmd = interaction.options.getString("command");
      await interaction.reply(`Queued prefix command: ${cmd}`);
      commandQueue.push({ id: Date.now(), command: cmd });
      console.log("Queued prefix command:", cmd);
      return;
    }

    // /chat
    if (interaction.commandName === "chat") {
      const msg = interaction.options.getString("message");
      await interaction.reply(`Queued chat: ${msg}`);
      const chatCmd = `CHAT:${msg}`;
      commandQueue.push({ id: Date.now(), command: chatCmd });
      console.log("Queued chat command:", chatCmd);
      return;
    }

    // /request-user-id
    if (interaction.commandName === "request-user-id") {
      await interaction.reply("Requesting user ID...");
      const channel = client.channels.cache.get(DISCORD_CHANNEL_ID);
      if (channel) {
        channel.send("User requested a user ID via the app.");
        return interaction.followUp("User ID request sent. It may take up to 24 hours.");
      } else {
        return interaction.followUp("Error: Discord channel not found.");
      }
    }

    // /create-bot
    if (interaction.commandName === "create-bot") {
      const fortniteName = interaction.options.getString("fortnitename");
      const autoAcceptInvites = interaction.options.getString("autoacceptinvites");
      const autoAcceptFriends = interaction.options.getString("autoacceptfriends");
      const startSkin = interaction.options.getString("startskin") || "";
      const joinEmote = interaction.options.getString("joinemote") || "";
      const accountLevel = interaction.options.getInteger("accountlevel") || "";

      await interaction.reply("Sending bot creation request...");
      const channel = client.channels.cache.get(DISCORD_CHANNEL_ID);
      if (channel) {
        const message = `User requested bot creation via the app:
Fortnite Name: ${fortniteName}
Auto Accept Invites: ${autoAcceptInvites}
Auto Accept Friends: ${autoAcceptFriends}
Start Skin: ${startSkin}
Join Emote: ${joinEmote}
Account Level: ${accountLevel}`;
        channel.send(message);
        return interaction.followUp("Bot creation request sent. It may take up to 24 hours to be approved.");
      } else {
        return interaction.followUp("Error: Discord channel not found.");
      }
    }

    // Fallback: unknown command
    return interaction.reply({ content: "Unknown command", ephemeral: true });
  } catch (err) {
    console.error("Interaction error:", err);
    if (!interaction.replied) {
      try { await interaction.reply("Something went wrong."); } catch {}
    }
  }
});

// Register slash commands
async function registerCommands() {
  if (!DISCORD_TOKEN) {
    console.log("DISCORD_TOKEN not set, skipping command register");
    return;
  }
  const rest = new Discord.REST({ version: "10" }).setToken(DISCORD_TOKEN);

  // NOTE: kept your original command names and descriptions.
  // The only forced change is "prefix command" -> "prefix-command" (no space allowed).
  const commands = [
    {
      name: "logs",
      description: "Turn logs on or off",
      options: [
        {
          type: 3,
          name: "action",
          description: "on or off",
          required: true,
          choices: [
            { name: "on", value: "on" },
            { name: "off", value: "off" },
          ],
        },
      ],
    },
    { name: "shutdown", description: "Shut down the app" },
    { name: "turnon", description: "Bring the app back online" },
    {
      name: "start",
      description: "Start a bot",
      options: [
        { type: 3, name: "userid", description: "User ID", required: true },
      ],
    },
    { name: "stop", description: "Stop the bot " },
    {
      name: "command",
      description: "perform a command",
      options: [
        {
          type: 3,
          name: "command",
          description: "command the bot runs",
          required: true,
        },
      ],
    },
    {
      // original name had a space "prefix command" — Discord forbids spaces.
      // We must register it as "prefix-command" but keep your description unchanged.
      name: "prefix-command",
      description: "this is currently having issues",
      options: [
        {
          type: 3,
          name: "command",
          description: "command the bot runs",
          required: true,
        },
      ],
    },
    { name: "request-user-id", description: "Request a new user ID" },
    {
      name: "create-bot",
      description: "create a new bot",
      options: [
        { type: 3, name: "fortnitename", description: "Fortnite name", required: true },
        { type: 3, name: "autoacceptinvites", description: "yes or no", required: true, choices: [
          { name: "yes", value: "yes" }, { name: "no", value: "no" }
        ] },
        { type: 3, name: "autoacceptfriends", description: "yes or no", required: true, choices: [
          { name: "yes", value: "yes" }, { name: "no", value: "no" }
        ] },
        { type: 3, name: "startskin", description: "Starting skin", required: false },
        { type: 3, name: "joinemote", description: "Join emote", required: false },
        { type: 4, name: "accountlevel", description: "Account level (number)", required: false },
      ],
    },
  ];

  try {
    await rest.put(Discord.Routes.applicationCommands(client.user.id), { body: commands });
    console.log("Slash commands registered.");
  } catch (err) {
    console.error("Failed to register slash commands:", err);
  }
}

if (DISCORD_TOKEN) {
  client.login(DISCORD_TOKEN);
} else {
  console.log("DISCORD_TOKEN not set, skipping bot login");
}

// ---- Timestamp helper ----
function timestamp() {
  return new Date().toISOString().split("T")[1].split(".")[0];
}

// ---- Send only FNLB logs to frontend ----
function sendToFrontendLogs(rawMessage) {
  if (!rawMessage && rawMessage !== 0) return;
  if (!logsEnabled) return;

  const messageStr = String(rawMessage);
  
  if (!messageStr.includes("fnlb") && !messageStr.includes("Starting shard") && 
      !messageStr.includes("categories:") && !messageStr.includes("Cluster:")) {
    return;
  }

  const lines = messageStr.split(/\r?\n/);

  for (let line of lines) {
    if (!line.trim()) continue;

    let clean = line.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").trim();

    clean = clean.replace(/fnlb/gi, "");
    clean = clean.replace(/\[\d{2}:\d{2}:\d{2}\]/g, "").trim();

    if (/playlist_/i.test(clean)) continue;
    if (/ua:/i.test(clean)) continue;
    if (/pb:/i.test(clean)) continue;
    if (/hotfix/i.test(clean)) continue;
    if (/netCL/i.test(clean)) continue;
    if (/Connecting \(http/i.test(clean)) continue;

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

// ---- Hook only FNLB-related console output ----
const originalLog = console.log;

console.log = (...args) => {
  const msg = args
    .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
    .join(" ");
  
  if (msg.includes("fnlb") || msg.includes("Starting shard") || 
      msg.includes("categories:") || msg.includes("Cluster:")) {
    sendToFrontendLogs(msg);
  }
  
  originalLog(...args);
};

// Middleware to check command secret
function checkSecret(req, res, next) {
  if (COMMAND_SECRET) {
    const token = req.headers["x-command-secret"];
    if (token !== COMMAND_SECRET) {
      return res.status(403).json({ error: "Forbidden: invalid secret" });
    }
  }
  next();
}

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
    console.log("Restarting worker...");
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

app.get("/site-status", (req, res) => {
  res.json({ shutdown: siteShutdown });
});

app.get("/logs", (req, res) => {
  if (!logsEnabled) {
    return res.status(403).end("Logs are currently disabled by moderators.");
  }
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
    return res.status(400).json({ error: "Server full" });

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

// Command execution routes
app.post("/execute-command", checkSecret, (req, res) => {
  const { command } = req.body;
  if (!command) {
    return res.status(400).json({ success: false, error: "Missing command" });
  }

  commandQueue.push({ id: Date.now(), command });
  console.log("Queued command:", command);
  res.json({ success: true, message: "Command queued", queueLength: commandQueue.length });
});

app.get("/fetch-command", checkSecret, (req, res) => {
  if (commandQueue.length === 0) {
    return res.json({});
  }
  const next = commandQueue[0];
  res.json(next);
});

app.post("/ack-command", checkSecret, (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ success: false, error: "Missing id" });
  }
  commandQueue = commandQueue.filter(cmd => cmd.id !== id);
  res.json({ success: true, message: "Command acknowledged" });
});

// Discord integration routes
app.get("/inbox", (req, res) => {
  res.json(inboxMessages);
});

app.post("/request-user-id", (req, res) => {
  const channel = client.channels.cache.get(DISCORD_CHANNEL_ID);
  if (channel) {
    channel.send("User requested a user ID via the app.");
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
    const message = `User requested bot creation via the app:
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
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
