import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

let worker = null;
let categories = [];
const MAX_SLOTS = 10;
let logListeners = [];

// Enhanced log system with multi-line support for ReplyClient
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
    /Connecting\s*\(https?:\/\//i.test(text)
  );
}

function broadcastLog(rawMessage) {
  if (!rawMessage && rawMessage !== 0) return;
  let message = String(rawMessage);
  const lines = message.split(/\r?\n/);

  for (let line of lines) {
    if (!line || !line.trim()) continue;
    let clean = line;

    // 1) Basic sanitization
    clean = clean.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
    clean = clean.replace(/fnlb/gi, "");
    clean = clean.replace(/^\s*\[(LOG|INFO|ERROR)\]\s*/i, "");
    clean = clean.replace(/^\s*\[WARN\]\s*/i, "[WARN] ");

    // 2) Force ReplyClient lines (and their continuations) to pass
    const isReplyLine = /\[ReplyClient\]/i.test(clean);
    if (isReplyLine) {
      replyContinuation = REPLY_ALLOW_LINES;
      clean = clean.replace(/\[\s*✓\s*\]|\[\s*i\s*\]/gi, "").trim();
      const structured = clean.match(/^\s*\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)$/);
      if (structured) {
        const idOrName = structured[2].trim();
        let rest = structured[3].trim();
        rest = rest.replace(/\[\s*ReplyClient\s*\]/gi, "").trim();
        clean = `[${idOrName}] ${rest}`;
      } else {
        clean = clean.replace(/\[\s*ReplyClient\s*\]/gi, "").trim();
      }

      const out = `[${timestamp()}] ${clean}`;
      logListeners.forEach((res) => {
        try { res.write(`data: ${out}\n\n`); } catch {}
      });
      continue;
    }

    // 3) If we are in a ReplyClient continuation window, allow this line too
    if (replyContinuation > 0) {
      replyContinuation--;
      clean = clean.replace(/\[\s*✓\s*\]|\[\s*i\s*\]/gi, "").trim();
      const out = `[${timestamp()}] ${clean}`;
      logListeners.forEach((res) => {
        try { res.write(`data: ${out}\n\n`); } catch {}
      });
      continue;
    }

    // 4) Skip only very specific junk lines (everything else allowed)
    if (isJunkLine(clean)) {
      if (/\b(error|warn|!|\[!\])\b/i.test(clean)) {
        // show error/warn lines anyway
      } else {
        continue;
      }
    }

    // 5) Remove ✓ and [i], keep [!]
    clean = clean.replace(/\[\s*✓\s*\]|\[\s*i\s*\]/gi, "").trim();

    // 6) Structured logs parsing to format output
    const structured = clean.match(/^\s*\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)$/);
    if (structured) {
      const source = structured[1].trim();
      const idOrName = structured[2].trim();
      let rest = structured[3].trim();

      rest = rest.replace(/\[\s*(Bot|Client|Gateway|Shard|ShardingManager|ReplyClient)\s*\]/gi, "").trim();

      if (/^Bot$/i.test(source)) {
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
        if (/Starting shard with ID:/i.test(rest)) {
          const m = rest.match(/ID:\s*([^\s,]+)/i);
          clean = m ? `Starting bot with ID: [${m[1]}]` : rest;
        } else if (/Stopping shard with ID:/i.test(rest)) {
          const m = rest.match(/ID:\s*([^\s,]+)/i);
          clean = m ? `Stopping bot with ID: [${m[1]}]` : rest;
        } else if (/Stopping all active shards/i.test(rest)) {
          clean = `Stopping all active bots`;
        } else if (/Shard\s+([^\s]+)\s+stopped/i.test(rest)) {
          const m = rest.match(/Shard\s+([^\s]+)\s+stopped/i);
          clean = m ? `Bot ${m[1]} stopped` : rest;
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

// --- Worker functions with multi-category support ---
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
    try { await fnlb.stop(); } catch (e) { console.warn("fnlb stop error:", e); }
    await start();
  }

  await start();
  const interval = setInterval(restart, 3600000);
  worker = { fnlb, interval };
}

async function stopWorker() {
  if (worker) {
    clearInterval(worker.interval);
    try { await worker.fnlb.stop(); } catch (e) { console.warn("fnlb stop error:", e); }
    worker = null;
    categories = [];
    console.log("🛑 Worker stopped");
    return true;
  }
  return false;
}

// --- API endpoints with multi-category support ---
app.post("/start", async (req, res) => {
  const { category } = req.body;
  const token = process.env.API_TOKEN;

  if (!token) return res.status(500).json({ error: "API_TOKEN missing" });
  if (!category) return res.status(400).json({ error: "Category required" });

  if (categories.length >= MAX_SLOTS)
    return res.status(400).json({ error: "❌ Server full" });

  if (!categories.includes(category)) categories.push(category);

  if (!worker) {
    try {
      await startWorker(token);
      console.log(`✅ Worker started with category ${category}`);
      res.json({ success: true, categories });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to start worker" });
    }
  } else {
    // Restart worker with updated categories
    try {
      await stopWorker();
      await startWorker(token);
      console.log(`➕ Added category: ${category}`);
      res.json({ success: true, categories });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update categories" });
    }
  }
});

app.post("/stop", async (req, res) => {
  const stopped = await stopWorker();
  if (stopped) res.json({ success: true });
  else res.json({ success: false, message: "No worker running" });
});

app.get("/status", (req, res) => {
  res.json({
    running: !!worker,
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

// --- Start server ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
