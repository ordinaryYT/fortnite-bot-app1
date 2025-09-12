function showView(view) {
  document.querySelectorAll("main section").forEach(s => s.classList.add("hidden"));
  document.getElementById(view+"-view").classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach(i=>i.classList.remove("active"));
  document.querySelector(`.nav-item[onclick="showView('${view}')"]`).classList.add("active");

  if(view === "mybots") updateStatus();
  if(view === "public") buildPublicBots();
}

function appendLog(data) {
  const output = document.getElementById("output");
  output.textContent += data + "\n";
  output.scrollTop = output.scrollHeight;
}

async function start() {
  const userId = document.getElementById("userId").value;
  const username = document.getElementById("username").value || "OGprivatebot";
  if(!userId){alert("Enter a User ID");return;}

  const res = await fetch("/start", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ category: userId })
  });
  const data = await res.json();
  appendLog(JSON.stringify(data));
  updateStatus(username);
}

async function stop() {
  const res = await fetch("/stop", {method: "POST"});
  const data = await res.json();
  appendLog(JSON.stringify(data));
  updateStatus();
}

async function status() {
  const res = await fetch("/status");
  const data = await res.json();
  appendLog(JSON.stringify(data));
  updateStatus();
}

async function updateStatus(username) {
  try {
    const res = await fetch("/status");
    const data = await res.json();
    const display = document.getElementById("statusDisplay");
    const dot = document.getElementById("statusDot");
    const slots = document.getElementById("slotsDisplay");
    
    display.textContent = data.running ? "Status: Running" : "Status: Stopped";
    slots.textContent = `Slots: ${data.slotsUsed}/${data.slotsMax}`;
    
    if(data.running) {
      dot.classList.add("running");
    } else {
      dot.classList.remove("running");
    }
    
    const categoryList = document.getElementById("categoryList");
    categoryList.innerHTML = "";
    
    if (data.categories && data.categories.length > 0) {
      const title = document.createElement("div");
      title.textContent = "Active User IDs:";
      title.style.marginBottom = "0.5rem";
      title.style.fontWeight = "bold";
      categoryList.appendChild(title);
      
      data.categories.forEach(cat => {
        const item = document.createElement("div");
        item.className = "category-item";
        item.textContent = cat;
        categoryList.appendChild(item);
      });
    }
    
    renderMyBots(data.slotsUsed, username);
  } catch (error) {
    console.error("Failed to update status:", error);
  }
}

function renderMyBots(count, username){
  const container = document.getElementById("myBotsList");
  container.innerHTML = "";
  const name = username || (document.getElementById("username").value || "OGprivatebot");
  for(let i = 1; i <= count; i++){
    const div = document.createElement("div");
    div.className = "bot-card";
    div.innerHTML = `<div class="bot-header"><div class="bot-name">${name}${i}</div><div class="bot-status">Running</div></div>`;
    container.appendChild(div);
  }
  document.getElementById("myBotsCount").textContent = `Running: ${count}/10`;
}

function buildPublicBots(){
  const container = document.getElementById("publicBotsList");
  container.innerHTML = "";
  for(let i = 1; i <= 75; i++){
    const div = document.createElement("div");
    div.className = "bot-card";
    div.innerHTML = `<div class="bot-header"><div class="bot-name">OGsbot${i}</div><div class="bot-status">Running</div></div>`;
    container.appendChild(div);
  }
}

function requestPublicBot(){
  const container = document.getElementById("publicBotsList");
  const div = document.createElement("div");
  div.className = "bot-card";
  div.innerHTML = `<div class="bot-header"><div class="bot-name">Public Bot</div><div class="bot-status">Running</div></div><p>ID: 67c2fd571906bd75e5239684</p>`;
  container.appendChild(div);
}

function initLogStream(){
  const source = new EventSource("/logs");
  source.onmessage = (event) => appendLog(event.data);
  source.onerror = (error) => {
    console.error("SSE connection error:", error);
    setTimeout(initLogStream, 5000); // Reconnect after 5 seconds
  };
}

// Init
updateStatus();
setInterval(updateStatus, 5000);
initLogStream();
