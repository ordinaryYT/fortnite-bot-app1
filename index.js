const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

let logs = [];
let running = false;
let runningBotsCount = 0; // keep track of how many bots are running
const MAX_BOTS = 10;

function addLog(message) {
  const time = new Date().toLocaleTimeString();
  const entry = `[${time}] ${message}`;
  logs.push(entry);
  if (logs.length > 500) logs.shift();
  logClients.forEach((res) => res.write(`data: ${entry}\n\n`));
}

let logClients = [];

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// SSE log stream
app.get("/logs", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  logs.forEach((log) => res.write(`data: ${log}\n\n`));
  logClients.push(res);

  req.on("close", () => {
    logClients = logClients.filter((c) => c !== res);
  });
});

// Start bot(s)
app.post("/start", (req, res) => {
  if (runningBotsCount >= MAX_BOTS) {
    return res.json({ success: false, message: "Max capacity reached (10 bots)." });
  }
  const { botId } = req.body;
  running = true;
  runningBotsCount++;
  addLog(`Started bot ${botId || "unknown"} (Total running: ${runningBotsCount})`);
  res.json({ success: true, running, count: runningBotsCount });
});

// Stop bot(s)
app.post("/stop", (req, res) => {
  if (runningBotsCount > 0) {
    runningBotsCount--;
    addLog(`Stopped a bot (Total running: ${runningBotsCount})`);
  }
  if (runningBotsCount === 0) running = false;
  res.json({ success: true, running, count: runningBotsCount });
});

// Status
app.get("/status", (req, res) => {
  res.json({ running, count: runningBotsCount });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 OGbots server running on port ${PORT}`);
});
