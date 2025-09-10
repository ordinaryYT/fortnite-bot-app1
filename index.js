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

// Keep a short-lived state so multi-line ReplyClient messages aren't lost
let replyContinuation = 0; // number of following lines to allow after a ReplyClient line
const REPLY_ALLOW_LINES = 6; // tune if needed

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
  // Only the specific junk you asked to remove
  return (
    /^\s*[{]/.test(text) ||                   // starting JSON object/dump
    /^\s*[}\]]\s*,?$/.test(text) ||           // closing brace/bracket lines
    /\bmmsTicketPlaylistHotfixIdOverrides:/i.test(text) ||
    (/\bplaylist_/i.test(text)) ||            // we'll allow playlist_* when it's part of ReplyClient due to replyContinuation logic
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
    clean = clean.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ""); // strip ANSI
    clean = clean.replace(/fnlb/gi, "");                // remove fnlb fragments
    clean = clean.replace(/^\s*\[(LOG|INFO|ERROR)\]\s*/i, ""); // strip generic level tags
    clean = clean.replace(/^\s*\[WARN\]\s*/i, "[WARN] ");     // keep WARN readable

    // 2) Force ReplyClient lines (and their continuations) to pass
    const isReplyLine = /\[ReplyClient\]/i.test(clean);
    if (isReplyLine) {
      // grant continuation allowance for the following lines (they may be wrapped)
      replyContinuation = REPLY_ALLOW_LINES;
      // clean small markers and format
      clean = clean.replace(/\[\s*✓\s*\]|\[\s*i\s*\]/gi, "").trim();
      const structured = clean.match(/^\s*\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)$/);
      if (structured) {
        const idOrName = structured[2].trim();
        let rest = structured[3].trim();
        // remove redundant ReplyClient label in the text
        rest = rest.replace(/\[\s*ReplyClient\s*\]/gi, "").trim();
        clean = `[${idOrName}] ${rest}`;
      } else {
        // fallback: just remove the role tag and keep whole line
        clean = clean.replace(/\[\s*ReplyClient\s*\]/gi, "").trim();
      }

      // output and continue
      const out = `[${timestamp()}] ${clean}`;
      logListeners.forEach((res) => {
        try { res.write(`data: ${out}\n\n`); } catch {}
      });
      continue;
    }

    // 3) If we are in a ReplyClient continuation window, allow this line too
    if (replyContinuation > 0) {
      replyContinuation--;
      // treat as normal (don't apply junk skipping). Clean small markers.
      clean = clean.replace(/\[\s*✓\s*\]|\[\s*i\s*\]/gi, "").trim();
      const out = `[${timestamp()}] ${clean}`;
      logListeners.forEach((res) => {
        try { res.write(`data: ${out}\n\n`); } catch {}
      });
      continue;
    }

    // 4) Skip only very specific junk lines (everything else allowed)
    if (isJunkLine(clean)) {
      // allow if the line actually contains an explicit Error/Warning marker
      if (/\b(error|warn|!|\[!\])\b/i.test(clean)) {
        // fall through and show it
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
        // transform start/stop shard wording to bot wording
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
      // Unstructured: remove role tags if present
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

// --- Worker functions ---
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
    console.log("Worker stopped");
    return true;
  }
  return false;
}

// --- API endpoints ---
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

// --- Start server ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
