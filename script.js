
"use strict";

/* =====================================================
   TRADEDOLLARS — CLEAN SIGNAL-ONLY FOUNDATION
   Public market data and descriptive digit analysis.
   No orders are placed.
   ===================================================== */

const APP_ID = "34qPaViEQZZw84Mc5thoO";
const PUBLIC_WS_URL =
  `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

const state = {
  socket: null,
  reconnectTimer: null,
  responseTimer: null,
  requestId: 0,
  connected: false,
  monitoring: false,
  symbol: "1HZ100V",
  marketName: "Volatility 100 (1s) Index",
  activeSymbols: [],
  ticks: 0,
  latestPrice: null,
  latestDigit: null,
  digitHistory: [],
  priceHistory: [],
  observations: []
};

const $ = id => document.getElementById(id);

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function setStatus(id, message, color) {
  const element = $(id);
  if (!element) return;

  element.textContent = message;

  if (color) element.style.color = color;
}

function formatPrice(value, decimals = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(decimals) : "--";
}

function getLastDigit(price, pipSize) {
  const decimals = Math.max(
    0,
    Math.min(10, Number(pipSize) || 0)
  );

  const formatted = Number(price).toFixed(decimals);
  const digits = formatted.replace(/\D/g, "");

  return digits.length
    ? Number(digits[digits.length - 1])
    : null;
}

function connectPublicSocket() {
  clearTimeout(state.reconnectTimer);
  clearTimeout(state.responseTimer);

  if (
    state.socket &&
    (
      state.socket.readyState === WebSocket.OPEN ||
      state.socket.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  setStatus(
    "marketStatus",
    "Opening public market connection...",
    "#ffcc66"
  );

  setStatus(
    "priceStatus",
    "Connecting to live market data...",
    "#ffcc66"
  );

  let socket;

  try {
    socket = new WebSocket(PUBLIC_WS_URL);
  } catch (error) {
    console.error("WebSocket creation failed:", error);

    setStatus(
      "marketStatus",
      "Could not create market connection.",
      "#ff687b"
    );

    scheduleReconnect();
    return;
  }

  state.socket = socket;
  state.connected = false;

  state.responseTimer = setTimeout(() => {
    if (state.socket !== socket) return;

    if (!state.connected) {
      setStatus(
        "marketStatus",
        "Connection timed out before opening. Check network access.",
        "#ff687b"
      );
      return;
    }

    if (!state.activeSymbols.length) {
      setStatus(
        "marketStatus",
        "Connected, but no market list response arrived.",
        "#ff687b"
      );
    } else if (state.ticks === 0) {
      setStatus(
        "priceStatus",
        "Market list loaded; waiting for the first tick.",
        "#ffcc66"
      );
    }
  }, 12000);

  socket.addEventListener("open", () => {
    if (state.socket !== socket) return;

    state.connected = true;

    console.log("Tradedollars public WebSocket opened.");

    setStatus(
      "marketStatus",
      "Connected. Requesting available markets...",
      "#25d695"
    );

    socket.send(JSON.stringify({
      active_symbols: "brief",
      req_id: ++state.requestId
    }));
  });

  socket.addEventListener("message", event => {
    if (state.socket !== socket) return;

    let message;

    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.error("Could not parse market response:", error);
      setStatus(
        "marketStatus",
        "Received an unreadable market response.",
        "#ff687b"
      );
      return;
    }

    console.log("Deriv public response:", message);

    if (message.error) {
      const description =
        message.error.message || "Market service error";

      setStatus("marketStatus", description, "#ff687b");

      if (message.msg_type === "tick") {
        setStatus("priceStatus", description, "#ff687b");
      }

      return;
    }

    if (Array.isArray(message.active_symbols)) {
      clearTimeout(state.responseTimer);
      processActiveSymbols(message.active_symbols);
      return;
    }

    if (message.tick) {
      processTick(message.tick);
    }
  });

  socket.addEventListener("error", event => {
    if (state.socket !== socket) return;

    console.error("Public WebSocket error:", event);

    setStatus(
      "marketStatus",
      "WebSocket error. Check connection or network access.",
      "#ff687b"
    );
  });

  socket.addEventListener("close", event => {
    if (state.socket !== socket) return;

    console.warn(
      "Public WebSocket closed:",
      event.code,
      event.reason
    );

    state.connected = false;
    clearTimeout(state.responseTimer);

    setStatus(
      "marketStatus",
      `Connection closed (${event.code}). Reconnecting...`,
      "#ffcc66"
    );

    setStatus(
      "priceStatus",
      "Market connection closed. Reconnecting...",
      "#ffcc66"
    );

    scheduleReconnect();
  });
}

function scheduleReconnect() {
  clearTimeout(state.reconnectTimer);

  state.reconnectTimer = setTimeout(() => {
    connectPublicSocket();
  }, 4000);
}

function processActiveSymbols(symbols) {
  if (!Array.isArray(symbols)) {
    setStatus(
      "marketStatus",
      "Invalid market list response.",
      "#ff687b"
    );
    return;
  }

  state.activeSymbols = symbols
    .map(item => ({
      symbol: item.underlying_symbol || item.symbol,
      name:
        item.underlying_symbol_name ||
        item.display_name ||
        item.name ||
        item.underlying_symbol ||
        item.symbol
    }))
    .filter(item => item.symbol && item.name);

  const select = $("marketSelect");

  if (select && state.activeSymbols.length) {
    select.innerHTML = "";

    state.activeSymbols.forEach(item => {
      const option = document.createElement("option");
      option.value = item.symbol;
      option.textContent = item.name;
      select.appendChild(option);
    });

    const preferred = state.activeSymbols.find(
      item => item.symbol === state.symbol
    );

    const selected = preferred || state.activeSymbols[0];

    state.symbol = selected.symbol;
    state.marketName = selected.name;
    select.value = state.symbol;
  }

  setStatus(
    "marketStatus",
    state.activeSymbols.length
      ? `${state.activeSymbols.length} markets loaded`
      : "The service returned an empty market list.",
    state.activeSymbols.length ? "#25d695" : "#ff687b"
  );

  setText("selectedMarket", state.marketName);

  if (state.activeSymbols.length) {
    subscribeToTicks();
  }
}

function subscribeToTicks() {
  const socket = state.socket;

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify({
    ticks: state.symbol,
    subscribe: 1,
    req_id: ++state.requestId
  }));

  setStatus(
    "priceStatus",
    `Subscribing to ${state.marketName}...`,
    "#ffcc66"
  );
}

function processTick(tick) {
  if (!tick || tick.quote === undefined) return;

  if (tick.symbol && tick.symbol !== state.symbol) {
    return;
  }

  const price = Number(tick.quote);

  if (!Number.isFinite(price)) return;

  const pipSize = Number.isFinite(Number(tick.pip_size))
    ? Number(tick.pip_size)
    : 2;

  const digit = getLastDigit(price, pipSize);

  state.ticks += 1;
  state.latestPrice = price;
  state.latestDigit = digit;

  state.priceHistory.push(price);

  if (state.priceHistory.length > 100) {
    state.priceHistory.shift();
  }

  if (digit !== null) {
    state.digitHistory.push(digit);

    if (state.digitHistory.length > 2000) {
      state.digitHistory.shift();
    }
  }

  setText("livePrice", formatPrice(price, pipSize));
  setText("liveDigit", digit === null ? "--" : String(digit));
  setText("tickCount", state.ticks.toLocaleString());
  setText("botStatus", state.monitoring ? "Running" : "Stopped");

  setStatus(
    "priceStatus",
    `Live data received for ${state.marketName}`,
    "#25d695"
  );

  setStatus(
    "tickStatus",
    `Received ${state.ticks.toLocaleString()} ticks this session.`,
    "#25d695"
  );

  renderDigitHistory();
  renderChart();
  renderDigitAnalysis();
  updateSignal();
}

function renderDigitHistory() {
  const container = $("digitHistory");
  if (!container) return;

  container.innerHTML = "";

  const recent = state.digitHistory.slice(-30).reverse();

  if (!recent.length) {
    container.textContent = "Waiting for data...";
    return;
  }

  recent.forEach(digit => {
    const item = document.createElement("span");
    item.className = "digit";
    item.textContent = String(digit);
    container.appendChild(item);
  });
}

function renderDigitAnalysis() {
  const digits = state.digitHistory;
  const size = digits.length;

  setText("sampleSize", size.toLocaleString());

  if (!size) {
    setText("mostDigit", "--");
    setText("evenOdd", "--");
    setText("overUnder", "--");

    setStatus(
      "analysisStatus",
      "Waiting for digit data...",
      "#ffcc66"
    );
    return;
  }

  const counts = Array(10).fill(0);
  digits.forEach(digit => counts[digit]++);

  const maximum = Math.max(...counts);

  const most = counts
    .map((count, digit) => ({ count, digit }))
    .filter(item => item.count === maximum)
    .map(item => item.digit)
    .join(", ");

  const even = digits.filter(d => d % 2 === 0).length;
  const odd = size - even;
  const over = digits.filter(d => d > 5).length;
  const under = digits.filter(d => d < 5).length;

  const percent = count =>
    `${(count * 100 / size).toFixed(1)}%`;

  setText("mostDigit", `${most} (${percent(maximum)})`);
  setText("evenOdd", `Even ${percent(even)} / Odd ${percent(odd)}`);
  setText(
    "overUnder",
    `Over 5: ${percent(over)} / Under 5: ${percent(under)}`
  );

  setStatus(
    "analysisStatus",
    `Descriptive statistics from ${size} digits. Historical frequencies do not predict the next digit.`,
    "#9cafc6"
  );
}

function renderChart() {
  const canvas = $("priceChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#091626";
  ctx.fillRect(0, 0, width, height);

  const prices = state.priceHistory;

  if (prices.length < 2) {
    ctx.fillStyle = "#9cafc6";
    ctx.font = "16px Arial";
    ctx.fillText("Waiting for price history...", 20, 35);
    return;
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const pad = 18;

  ctx.strokeStyle = "#25d695";
  ctx.lineWidth = 2;
  ctx.beginPath();

  prices.forEach((price, index) => {
    const x = pad +
      index * (width - 2 * pad) / (prices.length - 1);

    const y = height - pad -
      ((price - min) / range) * (height - 2 * pad);

    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();
}

function updateSignal() {
  const signal = $("signal");
  if (!signal) return;

  setText("signal", "WAIT");

  if (!state.monitoring) {
    setStatus(
      "signalReason",
      "Signal monitor stopped. No orders are placed.",
      "#9cafc6"
    );
    return;
  }

  const sample = state.digitHistory.slice(-100);

  if (sample.length < 50) {
    setStatus(
      "signalReason",
      `Collecting data: ${sample.length}/50 digits. Signal remains WAIT.`,
      "#ffcc66"
    );
    return;
  }

  const strategy = $("testStrategy")?.value || "overunder";

  const first = strategy === "evenodd"
    ? sample.filter(d => d % 2 === 0).length
    : sample.filter(d => d > 5).length;

  const second = strategy === "evenodd"
    ? sample.length - first
    : sample.filter(d => d < 5).length;

  const firstName = strategy === "evenodd" ? "EVEN" : "OVER 5";
  const secondName = strategy === "evenodd" ? "ODD" : "UNDER 5";

  setStatus(
    "signalReason",
    `${firstName}: ${(first * 100 / sample.length).toFixed(1)}%; ` +
    `${secondName}: ${(second * 100 / sample.length).toFixed(1)}%. ` +
    `Historical statistics only. No predictive signal is generated.`,
    "#ffcc66"
  );
}

async function refreshAccount() {
  setText("accountStatus", "Checking...");
  setStatus("accountMessage", "Checking demo account status...", "#ffcc66");

  try {
    const response = await fetch("/api/account", {
      credentials: "include",
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error(`Account request returned ${response.status}`);
    }

    const data = await response.json();

    if (data.connected && data.account) {
      setText("accountStatus", "Demo connected");
      setText("accountId", data.account.id || "--");
      setText(
        "accountBalance",
        `${data.account.currency || "USD"} ${formatPrice(data.account.balance)}`
      );

      setStatus(
        "accountMessage",
        "Demo account connected. Real-money trading remains disabled.",
        "#25d695"
      );
    } else {
      setText("accountStatus", "Not connected");
      setText("accountId", "--");
      setText("accountBalance", "--");

      setStatus(
        "accountMessage",
        "Log in with Deriv to view your demo account.",
        "#ffcc66"
      );
    }
  } catch (error) {
    console.error("Account check failed:", error);
    setText("accountStatus", "Unavailable");

    setStatus(
      "accountMessage",
      "Account check failed. Public market monitoring can work independently.",
      "#ff687b"
    );
  }
}

function handleMarketChange() {
  const select = $("marketSelect");
  if (!select || !select.value) return;

  state.symbol = select.value;

  const selected = state.activeSymbols.find(
    item => item.symbol === state.symbol
  );

  state.marketName = selected ? selected.name : state.symbol;

  state.ticks = 0;
  state.latestPrice = null;
  state.latestDigit = null;
  state.digitHistory = [];
  state.priceHistory = [];

  setText("selectedMarket", state.marketName);
  setText("livePrice", "--");
  setText("liveDigit", "--");
  setText("tickCount", "0");
  setText("tickStatus", "Waiting for ticks.");

  renderDigitHistory();
  renderChart();
  renderDigitAnalysis();
  updateSignal();
  subscribeToTicks();
}

function recordObservation() {
  const strategy = $("testStrategy")?.value || "overunder";
  const notes = ($("testNotes")?.value || "").trim();

  const observation = {
    time: new Date().toLocaleString(),
    strategy,
    sample: state.digitHistory.length,
    price: state.latestPrice,
    digit: state.latestDigit,
    notes: notes || "No notes provided."
  };

  state.observations.unshift(observation);

  if (state.observations.length > 50) {
    state.observations.pop();
  }

  setText("recordStatus", `Recorded at ${observation.time}.`);

  const container = $("observationHistory");
  if (!container) return;

  container.innerHTML = "";

  state.observations.forEach(item => {
    const card = document.createElement("div");
    card.className = "status";

    const heading = document.createElement("strong");
    heading.textContent =
      `${item.time} — ${item.strategy === "evenodd" ? "Even/Odd" : "Over/Under"}`;

    const details = document.createElement("p");
    details.textContent =
      `Sample: ${item.sample}; price: ${item.price ?? "--"}; ` +
      `last digit: ${item.digit ?? "--"}. Notes: ${item.notes}`;

    card.append(heading, details);
    container.appendChild(card);
  });
}

function startMonitor() {
  state.monitoring = true;
  setText("botStatus", "Running");

  setStatus(
    "appStatus",
    "Application running — signal-only mode; real-money trading disabled.",
    "#25d695"
  );

  updateSignal();
}

function stopMonitor() {
  state.monitoring = false;
  setText("botStatus", "Stopped");

  setStatus(
    "appStatus",
    "Signal monitor stopped — real-money trading disabled.",
    "#ffcc66"
  );

  updateSignal();
}

function initialise() {
  setStatus(
    "appStatus",
    "Application running — signal-only mode; real-money trading disabled.",
    "#25d695"
  );

  $("refreshAccount")?.addEventListener("click", refreshAccount);
  $("marketSelect")?.addEventListener("change", handleMarketChange);
  $("startMonitor")?.addEventListener("click", startMonitor);
  $("stopMonitor")?.addEventListener("click", stopMonitor);
  $("recordObservation")?.addEventListener("click", recordObservation);
  $("testStrategy")?.addEventListener("change", updateSignal);

  $("loginButton")?.addEventListener("click", () => {
    window.location.href = "/auth/deriv";
  });

  $("openDeriv")?.addEventListener("click", () => {
    window.open("https://deriv.com/", "_blank", "noopener");
  });

  renderChart();
  renderDigitHistory();
  renderDigitAnalysis();
  updateSignal();
  refreshAccount();
  connectPublicSocket();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialise, { once: true });
} else {
  initialise();
     }
   
