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

// serve frontend
app.use(express.static(path.join(__dirname, "public")));

let OGbotClient = null;
let categories = [];
const MAX_SLOTS = 10;

// --- LOG SYSTEM (filter + replacements + broadcast) ---
const clients = new Set();
const origLog = console.log;
console.log = (...args) => {
  const msg = args.join(" ");
  if (msg.includes("playlist_")) return; // filter playlists
  let formatted = msg
    .replace("Categories:", "Server:")
    .replace("Bots per Shard:", "Server Capacity:");
  origLog(formatted);
  clients.forEach(ws => ws.send(formatted));
};

// --- Worker (OGbot client) ---
async function startOGbotClient(token) {
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

// --- API routes ---
app.post("/start", async (req, res) => {
  const { category } = req.body;
  const token = process.env.API_TOKEN;

  if (!token) return res.status(500).json({ error: "API_TOKEN missing" });
  if (!category) return res.status(400).json({ error: "Category required" });

  if (categories.length >= MAX_SLOTS)
    return res.status(400).json({ error: "❌ Server full" });

  if (!categories.includes(category)) categories.push(category);

  if (!OGbotClient) {
    await startOGbotClient(token);
    console.log(`✅ OGbot client started with category ${category}`);
  } else {
    console.log(`➕ Added category: ${category}`);
  }

  res.json({ success: true, categories });
});

app.post("/stop", async (req, res) => {
  const stopped = await stopOGbotClient();
  if (stopped) res.json({ success: true });
  else res.json({ success: false, message: "No client running" });
});

app.get("/status", (req, res) => {
  res.json({
    running: !!OGbotClient,
    categories,
    slotsUsed: categories.length,
    slotsMax: MAX_SLOTS,
  });
});

// --- WebSocket for live logs ---
const wss = new WebSocketServer({ noServer: true });
wss.on("connection", ws => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
});

// integrate WS with HTTP server
const server = app.listen(3000, () => {
  console.log("🚀 Server running on port 3000");
});
server.on("upgrade", (req, socket, head) => {
  if (req.url === "/logs") {
    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit("connection", ws, req);
    });
  }
});
