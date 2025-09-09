import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

let worker = null;
let logListeners = [];

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

function shouldSkipDumpLine(text) {
  if (!text || !text.trim()) return true;

  // Keep anything with ReplyClient or Bot errors
  if (/ReplyClient/i.test(text)) return false;
  if (/\b(error|warn|!|\[!\])\b/i.test(text)) return false;

  // Skip junk debug dumps
  const dumpIndicators = [
    /^\s*[{[]/, // opening brace
    /^\s*[}\]]\s*,?$/, // closing brace/bracket
    /^\s*ua:/i,
    /^\s*pb:/i,
    /^\s*hotfix:/i,
    /^\s*netcl/i,
    /^\s*playlistRevisions:/i,
    /\bDownloaded metadata\b/i,
    /\bDownloaded \d+\s*BN\b/i,
    /\bShard bots:/i,
    /\bTotal Bots:/i,
    /\bTotal Categories:/i,
    /connecting\s*\(https?:\/\//i,
  ];
  if (dumpIndicators.some((rx) => rx.test(text))) return true;

  // Generic key:value lines like "foo: bar," (skip unless error/warn/ReplyClient)
  if (/^\s*[A-Za-z0-9_\-]+\s*:\s*.+[,}]?$/.test(text)) {
    return true;
  }

  return false;
}

function broadcastLog(rawMessage) {
  if (!rawMessage && rawMessage !== 0) return;
  let message = String(rawMessage);
  const lines = message.split(/\r?\n/);

  for (let line of lines) {
    if (!line || !line.trim()) continue;
    let clean = line;

    // Sanitize
    clean = clean.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ""); // ANSI
    clean = clean.replace(/fnlb/gi, "");
    clean = clean.replace(/^\s*\[(LOG|INFO|ERROR)\]\s*/i, "");
    clean = clean.replace(/^\s*\[WARN\]\s*/i, "[WARN] ");

    // Skip dumps unless they are ReplyClient/errors
    if (shouldSkipDumpLine(clean)) continue;

    // Remove ✓ and [i], keep [!]
    clean = clean.replace(/\[\s*✓\s*\]|\[\s*i\s*\]/gi, "").trim();

    // Structured logs
    const structured = clean.match(/^\s*\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)$/);
    if (structured) {
      const source = structured[1].trim();
      const idOrName = structured[2].trim();
      let rest = structured[3].trim();

      rest = rest.replace(/\[\s*(Bot|Client|Gateway|Shard|ShardingManager|ReplyClient)\s*\]/gi, "").trim();

      if (/^Bot$/i.test(source) || /^ReplyClient$/i.test(source)) {
        clean = `[${idOrName}] ${rest}`;

      } else if (/^Shard$/i.test(source) || /^Gateway$/i.test(source)) {
        clean = `[${idOrName}] ${rest}`;

      } else if (/^Client$/i.test(source)) {
        if (/setting up/i.test(rest)) {
          clean = `Setting up OGsbot...`;
        } else if (/finished setting up/i.test(rest)) {
          clean = `OGsbot ${rest.replace(/Client\s*/i, "").trim()}`;
        } else {
          clean = `OGsbot ${rest}`;
        }

      } else if (/^ShardingManager$/i.test(source)) {
        if (/Stopping all active shards/i.test(rest)) {
          clean = `Stopping all active bots`;
        } else if (/Stopping shard with ID:/i.test(rest)) {
          const m = rest.match(/ID:\s*([^\s]+)/i);
          if (m && m[1]) clean = `Stopping bot with ID: [${m[1]}]`;
        } else if (/Starting shard with ID:/i.test(rest)) {
          const m = rest.match(/ID:\s*([^\s]+)/i);
          if (m && m[1]) clean = `Starting bot with ID: [${m[1]}]`;
        } else if (/Shard\s+([^\s]+)\s+stopped/i.test(rest)) {
          const m = rest.match(/Shard\s+([^\s]+)\s+stopped/i);
          if (m && m[1]) clean = `Bot ${m[1]} stopped`;
        } else {
          clean = rest;
        }

      } else {
        clean = `[${idOrName}] ${rest}`;
      }
    } else {
      clean = clean.replace(/\[\s*(Bot|Client|Gateway|Shard|ShardingManager|ReplyClient)\s*\]/gi, "").trim();
      clean = clean.replace(/\[\s*✓\s*\]|\[\s*i\s*\]/gi, "").trim();
    }

    clean = clean.replace(/\s{2,}/g, " ").trim();
    if (!clean) continue;

    const out = `[${timestamp()}] ${clean}`;
    logListeners.forEach((res) => {
      try {
        res.write(`data: ${out}\n\n`);
      } catch {}
    });
  }
}

function wrapConsole(method) {
  return (...args) => {
    const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    original[method](...args);
    broadcastLog(msg);
  };
}

console.log = wrapConsole("log");
console.info = wrapConsole("info");
console.warn = wrapConsole("warn");
console.error = wrapConsole("error");

process.stdout.write = (chunk, encoding, callback) => {
  try { originalWrite(chunk, encoding, callback); } catch {}
  broadcastLog(chunk);
};

// Worker
async function startWorker(category, token) {
  const FNLB = await import("fnlb");
  const fnlb = new FNLB.default();

  async function start() {
    await fnlb.start({
      apiToken: token,
      numberOfShards: 1,
      botsPerShard: 1,
      categories: [category],
      logLevel: "INFO",
    });
  }

  async function restart() {
    console.log("Restarting worker...");
    try { await fnlb.stop(); } catch {}
    await start();
  }

  await start();
  const interval = setInterval(restart, 3600000);
  worker = { fnlb, interval };
}

async function stopWorker() {
  if (worker) {
    clearInterval(worker.interval);
    try { await worker.fnlb.stop(); } catch {}
    worker = null;
    console.log("Worker stopped");
    return true;
  }
  return false;
}

// API
app.post("/start", async (req, res) => {
  const { category } = req.body;
  const token = process.env.API_TOKEN;

  if (!category) return res.status(400).json({ error: "Category required" });
  if (!token) return res.status(500).json({ error: "API_TOKEN missing" });

  if (worker) await stopWorker();

  try {
    await startWorker(category, token);
    res.json({ message: `Worker started in category ${category}` });
    console.log(`Worker started in category ${category}`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start worker" });
    console.log("Error: failed to start worker");
  }
});

app.post("/stop", async (req, res) => {
  const stopped = await stopWorker();
  if (stopped) res.json({ message: "Worker stopped" });
  else res.json({ message: "No active worker" });
});

app.get("/status", (req, res) => {
  res.json({ running: !!worker });
});

app.get("/logs", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  logListeners.push(res);

  req.on("close", () => {
    logListeners = logListeners.filter((r) => r !== res);
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
