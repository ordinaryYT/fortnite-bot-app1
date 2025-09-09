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
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Single worker reference
let worker = null;

async function startFNLBWorker(category, token) {
  const FNLB = await import('fnlb');
  const fnlb = new FNLB.default();

  async function start() {
    await fnlb.start({
      apiToken: token,
      numberOfShards: 1,
      botsPerShard: 1,
      categories: [category],
      logLevel: 'INFO'
    });
  }

  async function restart() {
    console.log(`Restarting FNLB...`);
    await fnlb.stop();
    await start();
  }

  await start();
  const interval = setInterval(restart, 3600000); // restart every hour

  worker = { fnlb, interval };
}

async function stopFNLBWorker() {
  if (worker) {
    clearInterval(worker.interval);
    await worker.fnlb.stop();
    worker = null;
    console.log(`Worker stopped`);
    return true;
  }
  return false;
}

// Start endpoint
app.post("/start", async (req, res) => {
  const { category } = req.body;
  const token = process.env.API_TOKEN;

  if (!category) return res.status(400).json({ error: "Category required" });
  if (!token) return res.status(500).json({ error: "API_TOKEN missing" });

  if (worker) await stopFNLBWorker();

  try {
    await startFNLBWorker(category, token);
    res.json({ message: `FNLB worker started in category ${category}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start FNLB worker" });
  }
});

// Stop endpoint
app.post("/stop", async (req, res) => {
  const stopped = await stopFNLBWorker();
  if (stopped) res.json({ message: `FNLB worker stopped` });
  else res.json({ message: `No active worker` });
});

// Status endpoint
app.get("/status", (req, res) => {
  res.json({ running: !!worker });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 FNLB Render server running on port ${PORT}`));
