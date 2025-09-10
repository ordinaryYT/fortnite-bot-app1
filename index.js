// View switching
function showView(view) {
  document.getElementById("public-view").classList.add("hidden");
  document.getElementById("mybots-view").classList.add("hidden");
  document.getElementById("account-view").classList.add("hidden");
  document.getElementById(view + "-view").classList.remove("hidden");

  document.querySelectorAll(".tabs button").forEach(btn => btn.classList.remove("active"));
  document.getElementById("tab-" + view).classList.add("active");
}

// Logs
function appendLog(data) {
  const output = document.getElementById("output");
  output.textContent += data + "\n";
  output.scrollTop = output.scrollHeight;
}

// Backend calls
async function start() {
  const category = document.getElementById("category").value;
  if (!category) {
    alert("Enter a category ID");
    return;
  }
  const res = await fetch("/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category })
  });
  const data = await res.json();
  appendLog(JSON.stringify(data, null, 2));
  updateStatus();
}

async function stop() {
  const res = await fetch("/stop", { method: "POST" });
  const data = await res.json();
  appendLog(JSON.stringify(data, null, 2));
  updateStatus();
}

async function status() {
  const res = await fetch("/status");
  const data = await res.json();
  appendLog(JSON.stringify(data, null, 2));
  updateStatus();
}

async function updateStatus() {
  const res = await fetch("/status");
  const data = await res.json();
  const display = document.getElementById("statusDisplay");
  const dot = document.getElementById("statusDot");
  display.textContent = data.running ? "Status: Running" : "Status: Stopped";
  if (data.running) {
    display.style.color = "#21c974";
    dot.classList.add("running");
  } else {
    display.style.color = "#ff4365";
    dot.classList.remove("running");
  }
}

// Public bots
function buildPublicBots() {
  const container = document.getElementById("botList");
  for (let i = 1; i <= 75; i++) {
    const div = document.createElement("div");
    div.className = "bot-item";
    div.innerHTML = `OGsbot${i} - <span class="running">Running</span>`;
    container.appendChild(div);
  }
}

// Live log stream from backend
function initLogStream() {
  const source = new EventSource("/logs");
  source.onmessage = (event) => {
    appendLog(event.data);
  };
}

// Log filtering function
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

    // 2) Filter out unwanted lines
    if (isJunkLine(clean)) {
      // Allow specific lines that contain important info
      if (/\b(error|warn|!|\[!\])\b/i.test(clean)) {
        // fall through and show it
      } else {
        continue;
      }
    }

    // 3) Format specific log patterns
    if (/Starting shard with ID:/i.test(clean)) {
      const m = clean.match(/ID:\s*([^\s,]+)/i);
      clean = m ? `Starting bot with ID: [${m[1]}]` : clean;
    } else if (/User:\s*([^\s]+) has logged in current server compacity:/i.test(clean)) {
      // Extract the username from the log and display it
      const m = clean.match(/User:\s*([^\s]+) has logged in current server compacity:/i);
      const username = m ? m[1] : "UNKNOWN";
      clean = `User: ${username} has logged in current server compacity: 1. Bots`;
      
      // Update the UI with the username
      updateUsername(username);
    } else if (/Shard v\d+\.\d+\.\d+ \(Node/i.test(clean)) {
      clean = clean.replace(/Shard/, "OGsbot");
    } else if (/Cluster:\s*([^\s.]+). Categories:/i.test(clean)) {
      // Extract the cluster name from the log and display it
      const m = clean.match(/Cluster:\s*([^\s.]+). Categories:/i);
      const clusterName = m ? m[1] : "UNKNOWN";
      clean = `User: ${clusterName} has logged in current server compacity: 1. Bots`;
      
      // Update the UI with the cluster name
      updateUsername(clusterName);
    } else if (/Adding \d+ shard bots to Client/i.test(clean)) {
      clean = clean.replace("shard bots", "bots").replace("Client", "OG Client");
    } else if (/Bot added to system:/i.test(clean)) {
      clean = clean.replace("Bot added to system", "Added Bot to system");
    } else if (/Downloading cosmetics for all required languages/i.test(clean)) {
      clean = clean.replace("required", "supported");
    }

    // 4) Remove unnecessary markers
    clean = clean.replace(/\[\s*✓\s*\]|\[\s*i\s*\]/gi, "").trim();

    // 5) Final cleanup
    clean = clean.replace(/\s{2,}/g, " ").trim();
    if (!clean) continue;

    const out = `[${timestamp()}] ${clean}`;
    logListeners.forEach((res) => {
      try { res.write(`data: ${out}\n\n`); } catch {}
    });
  }
}

// Update username in the UI
function updateUsername(username) {
  const usernameElement = document.getElementById("username-display");
  if (usernameElement) {
    usernameElement.textContent = username;
  }
  
  // Also update the user info in the header
  const userInfoElement = document.getElementById("user-info-name");
  if (userInfoElement && username !== "UNKNOWN") {
    userInfoElement.textContent = username;
  }
}

// Helper function to check for junk lines
function isJunkLine(text) {
  return (
    /^\s*[{]/.test(text) ||                   // starting JSON object/dump
    /^\s*[}\]]\s*,?$/.test(text) ||           // closing brace/bracket lines
    /\bmmsTicketPlaylistHotfixIdOverrides:/i.test(text) ||
    (/\bplaylist_/i.test(text) && !/\[ReplyClient\]/i.test(text)) ||
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

// Timestamp function
function timestamp() {
  return new Date().toISOString().split('T')[1].split('.')[0];
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

// Initialize console wrapping
const original = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};
const originalWrite = process.stdout.write.bind(process.stdout);

console.log = wrapConsole("log");
console.info = wrapConsole("info");
console.warn = wrapConsole("warn");
console.error = wrapConsole("error");

process.stdout.write = (chunk, encoding, callback) => {
  try { originalWrite(chunk, encoding, callback); } catch {}
  broadcastLog(chunk);
};

// Worker functions
let worker = null;
let logListeners = [];

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

// API endpoints
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

// Initialize the application
function init() {
  buildPublicBots();
  updateStatus();
  setInterval(updateStatus, 5000);
  initLogStream();
  showView("public");
}

// Start the application when the DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
