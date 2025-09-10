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
