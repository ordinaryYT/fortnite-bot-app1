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

let commandQueue = []; // holds queued commands

// --- Discord setup ---
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
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

      const queued = { id: Date.now(), botname, command: cmdText };
      commandQueue.push(queued);

      console.log("Queued command:", queued);

      await interaction.reply(
        `🕒 Queued for bot \`${botname}\` with command \`${cmdText}\``
      );
      return;
    }
  } catch (err) {
    console.error("Interaction error:", err);
    if (!interaction.replied) {
      try {
        await interaction.reply("Something went wrong.");
      } catch {}
    }
  }
});

// --- Register Discord commands ---
async function registerCommands() {
  if (!DISCORD_TOKEN) {
    console.log("DISCORD_TOKEN not set, skipping command register");
    return;
  }
  const rest = new Discord.REST({ version: "10" }).setToken(DISCORD_TOKEN);

  const commands = [
    {
      name: "command",
      description: "Send a command",
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

// --- Express routes ---

// Serve frontend (index.html)
app.use(express.static(path.join(__dirname)));

// Fetch next command for AHK
app.get("/fetch-command", (req, res) => {
  if (commandQueue.length > 0) {
    const next = commandQueue.shift();
    res.json(next);
  } else {
    res.json({});
  }
});

// Acknowledge a completed command
app.post("/ack-command", (req, res) => {
  res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
