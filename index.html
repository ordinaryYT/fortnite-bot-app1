<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>OGbot Control Panel</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    header {
      background: #161b22;
      padding: 1rem;
      text-align: center;
      font-size: 1.4rem;
      font-weight: bold;
      color: #58a6ff;
    }
    main {
      flex: 1;
      display: grid;
      grid-template-columns: 1fr 2fr;
      gap: 1rem;
      padding: 1rem;
    }
    .panel {
      background: #161b22;
      border-radius: 8px;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      box-shadow: 0 0 8px rgba(0,0,0,0.3);
    }
    .logs {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 0.5rem;
      height: 100%;
      overflow-y: auto;
      font-family: monospace;
      font-size: 0.9rem;
      white-space: pre-wrap;
    }
    button {
      background: #238636;
      border: none;
      color: #fff;
      padding: 0.6rem 1rem;
      border-radius: 6px;
      cursor: pointer;
      font-weight: bold;
    }
    button:hover {
      background: #2ea043;
    }
    button.stop {
      background: #da3633;
    }
    button.stop:hover {
      background: #f85149;
    }
    input {
      padding: 0.6rem;
      border: 1px solid #30363d;
      border-radius: 6px;
      background: #0d1117;
      color: #c9d1d9;
      font-size: 1rem;
    }
    .status-box {
      font-size: 0.9rem;
      padding: 0.5rem;
      background: #21262d;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <header>⚡ OGbot Control Panel</header>
  <main>
    <div class="panel">
      <h2>Controls</h2>
      <label for="category">Category ID:</label>
      <input type="text" id="category" placeholder="Enter category ID..." />
      <button onclick="start()">Start</button>
      <button class="stop" onclick="stop()">Stop</button>
      <button onclick="status()">Check Status</button>
      <div class="status-box" id="statusBox">Status: Unknown</div>
    </div>

    <div class="panel">
      <h2>Logs</h2>
      <div id="logs" class="logs"></div>
    </div>
  </main>

  <script>
    const logsEl = document.getElementById("logs");
    const statusBox = document.getElementById("statusBox");

    // Connect to backend WebSocket for logs
    const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(wsProtocol + "://" + location.host);

    ws.onmessage = (event) => {
      const msg = event.data;
      const div = document.createElement("div");
      div.textContent = msg;
      logsEl.appendChild(div);
      logsEl.scrollTop = logsEl.scrollHeight;
    };

    async function start() {
      const category = document.getElementById("category").value.trim();
      if (!category) {
        alert("Please enter a category ID");
        return;
      }
      try {
        const res = await fetch("/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category })
        });
        const data = await res.json();
        alert(data.message || data.error);
      } catch (err) {
        alert("Error starting bot");
      }
    }

    async function stop() {
      try {
        const res = await fetch("/stop", { method: "POST" });
        const data = await res.json();
        alert(data.message);
      } catch (err) {
        alert("Error stopping bot");
      }
    }

    async function status() {
      try {
        const res = await fetch("/status");
        const data = await res.json();
        statusBox.textContent =
          `Running: ${data.running} | Slots: ${data.usedSlots}/${data.maxSlots} | Categories: ${data.categories.join(", ")}`;
      } catch (err) {
        statusBox.textContent = "Error fetching status";
      }
    }
  </script>
</body>
</html>
