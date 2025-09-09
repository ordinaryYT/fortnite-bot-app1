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
  // If line looks like an object dump or a key:value debug line, return true,
  // unless it's an error/warn or contains important markers like "Error" or "[!]"
  if (!text || !text.trim()) return true;

  const lowered = text.toLowerCase();

  // Keep lines that are explicit errors or warnings
  if (/\berror\b|!\]|\[!\]|^\s*error:/i.test(text)) return false;
  if (/^\s*\[warn\]/i.test(text)) return false;

  // Indicators of dump/debug data to drop
  const dumpIndicators = [
    /^\s*[{[]/,              // starts with { or [
    /^\s*ua:/i,
    /^\s*pb:/i,
    /^\s*hotfix:/i,
    /\bplaylist_/i,
    /^\s*netcl/i,
    /^\s*playlists?revisions/i,
    /\bdownloaded metadata\b/i,
    /\bdownloaded \d+\s*bn\b/i,
    /\bshard bots:/i,
    /connecting\s*\(https?:\/\//i
  ];

  if (dumpIndicators.some((rx) => rx.test(text))) return true;

  // Also drop plain key:value lines (like "key: value,") except when they contain Error/WARN/!
  if (/^\s*[A-Za-z0-9_\-]+\s*:\s*.+[,}]?$/.test(text) && !/\b(error|warn|!|\[!\])\b/i.test(text)) {
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

    // 1) Basic sanitization
    clean = clean.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ""); // ANSI
    clean = clean.replace(/fnlb/gi, "");                // remove "fnlb" fragments
    // strip leading generic levels, but keep WARN
    clean = clean.replace(/^\s*\[(LOG|INFO|ERROR)\]\s*/i, "");
    clean = clean.replace(/^\s*\[WARN\]\s*/i, "[WARN] ");

    // 2) If the entire raw line looks like a dump, skip it early
    if (shouldSkipDumpLine(clean)) {
      // But ensure we don't skip lines that contain clear error/warn markers
      if (!(/\b(error|warn|!|\[!\])\b/i.test(clean))) continue;
    }

    // 3) Structured parse: "[Source] [IdOrName] rest..."
    const structured = clean.match(/^\s*\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)$/);
    if (structured) {
      const source = structured[1].trim();
      const idOrName = structured[2].trim();
      let rest = structured[3].trim();

      // remove internal micro-role tags if present
      rest = rest.replace(/\[\s*(Bot|Client|Gateway|Shard|ShardingManager|ReplyClient)\s*\]/gi, "").trim();
      // remove small markers ✓ and [i]
      rest = rest.replace(/\[\s*✓\s*\]|\[\s*i\s*\]/gi, "").trim();

      // If the rest looks like a dump, skip, unless it's an error/warn
      if (shouldSkipDumpLine(rest) && !(/\b(error|warn|!|\[!\])\b/i.test(rest))) {
        continue;
      }

      if (/^Bot$/i.test(source) || /^ReplyClient$/i.test(source)) {
        // Show name in brackets and keep the rest (do NOT strip the trailing bot name — user requested it)
        clean = `[${idOrName}] ${rest}`;

      } else if (/^Shard$/i.test(source) || /^Gateway$/i.test(source)) {
        // Keep ID in brackets and the rest
        clean = `[${idOrName}] ${rest}`;

      } else if (/^Client$/i.test(source)) {
        // Map client messages to OGsbot phrasing
        if (/setting up/i.test(rest) && /client/i.test(rest)) {
          clean = `Setting up OGsbot...`;
        } else if (/finished setting up/i.test(rest)) {
          const remainder = rest.replace(/Client\s*/i, "").trim();
          clean = `OGsbot ${remainder}`.trim();
        } else {
          clean = `OGsbot ${rest}`.trim();
        }

      } else if (/^ShardingManager$/i.test(source)) {
        // Normalize Start/Stop shard phrasing to bot phrasing
        // e.g. "Starting shard with ID: 5t8..." -> "Starting bot with ID: [5t8...]"
        const mId = rest.match(/ID:\s*([^\s,]+)/i);
        if (mId && mId[1]) {
          clean = rest.replace(/Starting shard with ID:/i, "Starting bot with ID:").replace(/ID:\s*([^\s,]+)/i, `ID: [${mId[1]}]`);
        } else {
          clean = rest;
        }

      } else {
        // default: show ID then rest
        clean = `[${idOrName}] ${rest}`;
      }
    } else {
      // Not structured. remove standalone role tags (if any) and small markers
      clean = clean.replace(/\[\s*(Bot|Client|Gateway|Shard|ShardingManager|ReplyClient)\s*\]/gi, "").trim();
      clean = clean.replace(/\[\s*✓\s*\]|\[\s*i\s*\]/gi, "").trim();

      // If this non-structured line now looks like a dump, skip it (unless it's an error/warn)
      if (shouldSkipDumpLine(clean) && !(/\b(error|warn|!|\[!\])\b/i.test(clean))) {
        continue;
      }
    }

    // 4) Specific phrase transforms related to "shard" -> "bot" for stop/start wording
    // Stopping all active shards -> Stopping all active bots
    clean = clean.replace(/\bStopping all active shards\b/ig, "Stopping all active bots");

    // Stopping shard with ID: 5t8... -> Stopping bot with ID: [5t8...]
    clean = clean.replace(/\bStopping shard with ID:\s*([^\s\]]+)/ig, (m, id) => `Stopping bot with ID: [${id}]`);

    // Starting shard with ID: 5t8... -> Starting bot with ID: [5t8...]
    clean = clean.replace(/\bStarting shard with ID:\s*([^\s\]]+)/ig, (m, id) => `Starting bot with ID: [${id}]`);

    // Shard <id> stopped. -> Bot <id> stopped.
    clean = clean.replace(/\bShard\s+([^\s,]+)\s+stopped\b/ig, (m, id) => `Bot ${id} stopped`);

    // 5) Additional targeted suppressions requested:
    // - "Downloaded X BN" lines & "Downloaded metadata" already caught, but double-ensure:
    if (/\bDownloaded \d+\s*BN\b/i.test(clean) || /\bDownloaded metadata\b/i.test(clean)) continue;

    // - "Shard bots: ..." lines
    if (/\bShard bots:/i.test(clean) || /\bTotal Bots:/i.test(clean) || /\bTotal Categories:/i.test(clean)) {
      // remove shard-bots summary lines
      continue;
    }

    // - "Connecting (https://...)" lines
    if (/Connecting\s*\(https?:\/\//i.test(clean)) continue;

    // 6) Final cleanups
    clean = clean.replace(/\s{2,}/g, " ").trim();
    if (!clean) continue;

    // Prepend timestamp and emit
    const out = `[${timestamp()}] ${clean}`;
    logListeners.forEach((res) => {
      try {
        res.write(`data: ${out}\n\n`);
      } catch (e) {
        // ignore write errors
      }
    });
  } // for each line
}

// console wrappers
function wrapConsole(method) {
  return (...args) => {
    const processed = args.map((a) => {
      if (a instanceof Error) return a.stack || String(a);
      if (a && typeof a === "object") {
        try { return JSON.stringify(a); } catch { return String(a); }
      }
      return String(a);
    }).join(" ");
    original[method](...args);
    broadcastLog(processed);
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
    try { await fnlb.stop(); } catch (e) { console.warn("Error stopping fnlb:", e); }
    await start();
  }

  await start();
  const interval = setInterval(restart, 3600000);
  worker = { fnlb, interval };
}

async function stopWorker() {
  if (worker) {
    clearInterval(worker.interval);
    try { await worker.fnlb.stop(); } catch (e) { console.warn("Error stopping worker:", e); }
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

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
