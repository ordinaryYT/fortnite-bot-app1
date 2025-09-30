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

const LOGS_ROLE_ID = process.env.LOGS_ROLE_ID || "123456789012345678";
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || "987654321098765432";

let logsEnabled = true;
let siteShutdown = false;

let commandQueue = [];
const COMMAND_SECRET = process.env.COMMAND_SECRET || null;

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

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    // === logs / shutdown / turnon / start / stop unchanged ===

    // /command (new system with botname + command)
    if (interaction.commandName === "command") {
      const botname = interaction.options.getString("botname");
      const cmdText = interaction.options.getString("command");

      if (/\d/.test(botname)) {
        await interaction.reply({
          content: "❌ Botname cannot contain numbers.",
          ephemeral: true,
        });
        return;
      }

      await interaction.reply(
        `🕒 Queued for bot \`${botname}\` with command \`${cmdText}\``
      );

      commandQueue.push({ id: Date.now(), botname, command: cmdText });
      console.log("Queued command:", botname, cmdText);
      return;
    }

    // === prefix-command / chat / request-user-id / create-bot unchanged ===
  } catch (err) {
    console.error("Interaction error:", err);
    if (!interaction.replied) {
      try {
        await interaction.reply("Something went wrong.");
      } catch {}
    }
  }
});

// ----------------------
// Slash command register
// ----------------------
async function registerCommands() {
  if (!DISCORD_TOKEN) {
    console.log("DISCORD_TOKEN not set, skipping command register");
    return;
  }
  const rest = new Discord.REST({ version: "10" }).setToken(DISCORD_TOKEN);

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
      description: "Send a command to AutoHotkey",
      options: [
        {
          type: 3,
          name: "botname",
          description: "The bot name (no numbers allowed)",
          required: true,
        },
        {
          type: 3,
          name: "command",
          description: "The command text to run",
          required: true,
        },
      ],
    },
    {
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
        {
          type: 3,
          name: "fortnitename",
          description: "Fortnite name",
          required: true,
        },
        {
          type: 3,
          name: "autoacceptinvites",
          description: "yes or no",
          required: true,
          choices: [
            { name: "yes", value: "yes" },
            { name: "no", value: "no" },
          ],
        },
        {
          type: 3,
          name: "autoacceptfriends",
          description: "yes or no",
          required: true,
          choices: [
            { name: "yes", value: "yes" },
            { name: "no", value: "no" },
          ],
        },
        {
          type: 3,
          name: "startskin",
          description: "Starting skin",
          required: false,
        },
        {
          type: 3,
          name: "joinemote",
          description: "Join emote",
          required: false,
        },
        {
          type: 4,
          name: "accountlevel",
          description: "Account level (number)",
          required: false,
        },
      ],
    },
  ];

  try {
    await rest.put(Discord.Routes.applicationCommands(client.user.id), {
      body: commands,
    });
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

// === Express routes unchanged (execute-command, fetch-command, etc) ===
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
