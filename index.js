import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// serve index.html directly
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const workers = {}; // userId -> worker session

// Dummy worker class (replace with your own library logic)
class Worker {
  constructor(userId, category, token) {
    this.userId = userId;
    this.category = category;
    this.token = token;
    this.interval = null;
  }

  async start() {
    console.log(`▶️ Worker for ${this.userId} started (category: ${this.category}) with token ${this.token.slice(0,6)}...`);
    this.interval = setInterval(() => {
      console.log(`[${this.userId}] still running in category ${this.category}`);
    }, 10000);
  }

  async stop() {
    if (this.interval) {
      clearInterval(this.interval);
      console.log(`⏹️ Worker for ${this.userId} stopped`);
    }
  }
}

app.post("/start", async (req, res) => {
  const { userId, category } = req.body;
  if (!userId || !category) {
    return res.status(400).json({ error: "userId and category are required" });
  }

  const token = process.env.API_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "API_TOKEN not set" });
  }

  if (workers[userId]) {
    await workers[userId].stop();
    delete workers[userId];
  }

  const worker = new Worker(userId, category, token);
  await worker.start();
  workers[userId] = worker;

  res.json({ message: `Worker started for ${userId}`, category });
});

app.post("/stop", async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  if (workers[userId]) {
    await workers[userId].stop();
    delete workers[userId];
    return res.json({ message: `Worker stopped for ${userId}` });
  } else {
    return res.json({ message: `No active worker for ${userId}` });
  }
});

app.get("/status/:userId", (req, res) => {
  const { userId } = req.params;
  if (workers[userId]) {
    res.json({ running: true, category: workers[userId].category });
  } else {
    res.json({ running: false });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
