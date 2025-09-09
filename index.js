import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// Store per-user workers
const workers = {};

/**
 * Starts the FNLB worker for a user.
 * Stores stop function to allow stopping later.
 */
async function startFNLBWorker(userId, category, token) {
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
    console.log(`[${userId}] Restarting FNLB...`);
    await fnlb.stop();
    await start();
  }

  await start();
  const interval = setInterval(restart, 3600000); // restart every hour

  // Save references for stopping
  workers[userId] = {
    fnlb,
    interval
  };
}

// Stop FNLB worker
async function stopFNLBWorker(userId) {
  const w = workers[userId];
  if (w) {
    clearInterval(w.interval);
    await w.fnlb.stop();
    delete workers[userId];
    console.log(`[${userId}] Worker stopped`);
    return true;
  }
  return false;
}

// Start endpoint
app.post("/start", async (req, res) => {
  const { userId, category } = req.body;
  const token = process.env.API_TOKEN;

  if (!userId || !category) return res.status(400).json({ error: "userId and category are required" });
  if (!token) return res.status(500).json({ error: "API_TOKEN missing on server" });

  // Stop existing worker if running
  if (workers[userId]) await stopFNLBWorker(userId);

  try {
    await startFNLBWorker(userId, category, token);
    res.json({ message: `FNLB worker started for ${userId}`, category });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start FNLB worker" });
  }
});

// Stop endpoint
app.post("/stop", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId is required" });

  const stopped = await stopFNLBWorker(userId);
  if (stopped) res.json({ message: `FNLB worker stopped for ${userId}` });
  else res.json({ message: `No active worker for ${userId}` });
});

// Status endpoint
app.get("/status/:userId", (req, res) => {
  const { userId } = req.params;
  if (workers[userId]) res.json({ running: true });
  else res.json({ running: false });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 FNLB Render server running on port ${PORT}`));
