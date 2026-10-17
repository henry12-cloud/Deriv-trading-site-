
/* =========================================================
   TRADEDOLLARS — SCRIPT.JS
   Public market data + digit analysis + signal-only monitoring
   No orders are placed. Real-money trading remains disabled.
   ========================================================= */

"use strict";

/* ---------------- CONFIGURATION ---------------- */

// Public testing app ID for the legacy Deriv WebSocket API.
// This is NOT your OAuth client ID or trading authorization.
const PUBLIC_WS_URL =
  "wss://api.derivws.com/trading/v1/options/ws/public";

const DEFAULT_SYMBOL = "1HZ100V";
const DEFAULT_MARKET_NAME = "Volatility 100 (1s) Index";

const MAX_DIGIT_HISTORY = 2000;
const MAX_PRICE_HISTORY = 100;
const MAX_OBSERVATIONS = 100;

const state = {
  socket: null,
     tradingSocket: null,
  tradingConnecting: false,
  tradingConnected: false,
  reconnectTimer: null,
  responseTimer: null,
  requestId: 0,

  // Demo quote tracking — no purchases
  tradeRequestId: 0,
  pendingProposalReqId: null,
  latestProposal: null,

  connected: false,
  monitoring: true,
  subscribed: false,

  symbol: DEFAULT_SYMBOL,
  marketName: DEFAULT_MARKET_NAME,

  activeSymbols: [],
  ticks: 0,
  latestPrice: null,
  latestDigit: null,

  digitHistory: [],
  priceHistory: [],
  observations: []
};

/* ---------------- SAFE DOM HELPERS ---------------- */

function $(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = String(value);
}

function setStatus(id, message, color) {
  const element = $(id);
  if (!element) return;

  element.textContent = message;

  if (color) {
    element.style.color = color;
  }
}

function sendJson(socket, payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.warn("WebSocket is not open; request not sent.");
    return false;
  }

  socket.send(JSON.stringify(payload));
  return true;
}

/* ---------------- PUBLIC MARKET CONNECTION ---------------- */

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

  state.connected = false;
  state.subscribed = false;

  setStatus(
    "marketStatus",
    "Connecting to public market data...",
    "#f59e0b"
  );

  setStatus(
    "priceStatus",
    "Connecting to live market data...",
    "#f59e0b"
  );

  let socket;

  try {
    socket = new WebSocket(PUBLIC_WS_URL);
    state.socket = socket;
  } catch (error) {
    console.error("Could not create market WebSocket:", error);

    setStatus(
      "marketStatus",
      "Could not start market connection. Retrying...",
      "#ef4444"
    );

    scheduleReconnect();
    return;
  }

  state.responseTimer = setTimeout(() => {
    if (
      state.socket === socket &&
      socket.readyState === WebSocket.OPEN &&
      state.activeSymbols.length === 0
    ) {
      setStatus(
        "marketStatus",
        "Connected, but no market list received. Check console for errors.",
        "#ef4444"
      );

      console.warn(
        "No active_symbols response received within 12 seconds."
      );
    }
  }, 12000);

  socket.addEventListener("open", () => {
    if (state.socket !== socket) return;

    state.connected = true;

    setStatus(
      "marketStatus",
      "Connected. Loading available markets...",
      "#22c55e"
    );

sendJson(socket, {
  active_symbols: "brief",
  req_id: ++state.requestId
});
  });

  socket.addEventListener("message", event => {
    if (state.socket !== socket) return;

    let message;

    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.error("Invalid WebSocket response:", event.data);
      return;
    }

    if (message.error) {
      console.error("Deriv public response error:", message.error);

      const errorText =
        message.error.message ||
        message.error.code ||
        "Unknown market-data error";

      setStatus(
        "marketStatus",
        "Market API error: " + errorText,
        "#ef4444"
      );

      setStatus(
        "priceStatus",
        "Market data error. See console for details.",
        "#ef4444"
      );

      return;
    }

    if (message.msg_type === "active_symbols") {
      clearTimeout(state.responseTimer);

      processActiveSymbols(message.active_symbols);
      return;
    }

    if (message.msg_type === "tick" && message.tick) {
      processTick(message.tick);
      return;
    }

    if (message.subscription && message.msg_type === "forget") {
      console.log("Subscription ended:", message);
    }
  });

  socket.addEventListener("error", event => {
    console.error("Public market WebSocket error:", event);

    setStatus(
      "marketStatus",
      "Market connection error. Retrying if disconnected...",
      "#ef4444"
    );
  });

  socket.addEventListener("close", event => {
    if (state.socket !== socket) return;

    state.connected = false;
    state.subscribed = false;

    setStatus(
      "marketStatus",
      `Connection closed (${event.code}). Reconnecting...`,
      "#f59e0b"
    );

    setStatus(
      "priceStatus",
      "Market connection closed. Reconnecting...",
      "#f59e0b"
    );

    scheduleReconnect();
  });
}

function scheduleReconnect() {
  clearTimeout(state.reconnectTimer);

  state.reconnectTimer = setTimeout(() => {
    if (!state.connected) {
      connectPublicSocket();
    }
  }, 3000);
}

/* ---------------- MARKET LIST ---------------- */

function processActiveSymbols(symbols) {
  if (!Array.isArray(symbols)) {
    console.error("Invalid active-symbols response:", symbols);

    setStatus(
      "marketStatus",
      "Invalid market list response.",
      "#ef4444"
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

  console.log(
    "Available markets received:",
    state.activeSymbols.length
  );

  setText(
    "marketCount",
    state.activeSymbols.length
  );

  setStatus(
    "marketStatus",
    state.activeSymbols.length
      ? `${state.activeSymbols.length} markets loaded`
      : "Connected, but no markets were returned.",
    state.activeSymbols.length ? "#22c55e" : "#ef4444"
  );

  const marketSelect = $("marketSelect");

  if (marketSelect && state.activeSymbols.length) {
    const previousSymbol = state.symbol;

    marketSelect.innerHTML = "";

    state.activeSymbols.forEach(market => {
      const option = document.createElement("option");
      option.value = market.symbol;
      option.textContent = market.name;
      marketSelect.appendChild(option);
    });

    const preferredMarket = state.activeSymbols.find(
      market => market.symbol === previousSymbol
    );

    const firstMarket = state.activeSymbols[0];

    const chosenMarket = preferredMarket || firstMarket;

    marketSelect.value = chosenMarket.symbol;

    state.symbol = chosenMarket.symbol;
    state.marketName = chosenMarket.name;

    updateSelectedMarket();
  }

  if (state.activeSymbols.length) {
    subscribeToTicks();
  } else {
    setStatus(
      "priceStatus",
      "No available markets to subscribe to.",
      "#ef4444"
    );
  }
}

/* ---------------- TICK SUBSCRIPTION ---------------- */

function subscribeToTicks() {
  const socket = state.socket;

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  state.subscribed = false;

  const sent = sendJson(socket, {
    ticks: state.symbol,
    subscribe: 1,
    req_id: ++state.requestId
  });

  if (sent) {
    setStatus(
      "priceStatus",
      `Subscribing to ${state.marketName}...`,
      "#f59e0b"
    );
  }
}

function changeMarket(symbol) {
  const market = state.activeSymbols.find(
    item => item.symbol === symbol
  );

  if (!market) {
    console.warn("Selected market was not found:", symbol);
    return;
  }

  state.symbol = market.symbol;
  state.marketName = market.name;

  state.ticks = 0;
  state.latestPrice = null;
  state.latestDigit = null;
  state.digitHistory = [];
  state.priceHistory = [];

  updateSelectedMarket();
  renderDigitHistory();
  renderDigitAnalysis();
  renderChart();
  updateSignal();

  setText("tickCount", 0);
  setText("livePrice", "Waiting...");
  setText("liveDigit", "—");

  const socket = state.socket;

  if (socket && socket.readyState === WebSocket.OPEN) {
    sendJson(socket, {
      forget_all: "ticks",
      req_id: ++state.requestId
    });

    subscribeToTicks();
  }
}

function updateSelectedMarket() {
  setText("selectedMarket", state.marketName);
  setText("marketName", state.marketName);
}

/* ---------------- PROCESS LIVE TICKS ---------------- */

function processTick(tick) {
  if (!tick || tick.quote === undefined) return;

  const price = Number(tick.quote);

  if (!Number.isFinite(price)) return;

  const pipSize = Number.isInteger(Number(tick.pip_size))
    ? Number(tick.pip_size)
    : 2;

  const formattedPrice = price.toFixed(pipSize);
  const lastCharacter = formattedPrice.slice(-1);
  const digit = Number(lastCharacter);

  if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
    console.warn("Could not extract final price digit:", formattedPrice);
    return;
  }

  state.connected = true;
  state.subscribed = true;
  state.ticks += 1;

  state.latestPrice = price;
  state.latestDigit = digit;

  state.digitHistory.unshift(digit);

  if (state.digitHistory.length > MAX_DIGIT_HISTORY) {
    state.digitHistory.length = MAX_DIGIT_HISTORY;
  }

  state.priceHistory.push({
    price,
    time: Date.now()
  });

  if (state.priceHistory.length > MAX_PRICE_HISTORY) {
    state.priceHistory.shift();
  }

  setText("livePrice", formattedPrice);
  setText("latestPrice", formattedPrice);
  setText("liveDigit", digit);
  setText("latestDigit", digit);
  setText("tickCount", state.ticks);
  setText("ticksReceived", state.ticks);

  setStatus(
    "priceStatus",
    `Live data received — ${state.marketName}`,
    "#22c55e"
  );

  setStatus(
    "marketStatus",
    `${state.activeSymbols.length} markets loaded · Live`,
    "#22c55e"
  );

  renderDigitHistory();
  renderDigitAnalysis();
  renderChart();
  updateSignal();
}

/* ---------------- DIGIT HISTORY ---------------- */

function renderDigitHistory() {
  const container =
    $("digitHistory") ||
    $("recentDigits");

  if (!container) return;

  container.innerHTML = "";

  if (!state.digitHistory.length) {
    container.textContent = "Waiting for live digits...";
    return;
  }

  state.digitHistory.slice(0, 50).forEach(digit => {
    const item = document.createElement("span");

    item.textContent = digit;
    item.style.display = "inline-flex";
    item.style.alignItems = "center";
    item.style.justifyContent = "center";
    item.style.minWidth = "28px";
    item.style.minHeight = "28px";
    item.style.margin = "3px";
    item.style.borderRadius = "6px";
    item.style.fontWeight = "700";
    item.style.background =
      digit % 2 === 0 ? "#173b32" : "#3b2340";
    item.style.color =
      digit % 2 === 0 ? "#86efac" : "#e9a8ff";

    container.appendChild(item);
  });
}

/* ---------------- DIGIT ANALYSIS ---------------- */


function renderDigitAnalysis() {
  const digits = state.digitHistory;
  const sampleSize = digits.length;

  setText("sampleSize", sampleSize);

  if (sampleSize === 0) {
    setText("mostDigit", "--");
    setText("evenOdd", "--");
    setText("overUnder", "--");

    setStatus(
      "analysisStatus",
      "Waiting for ticks to begin analysis.",
      "#f59e0b"
    );
    return;
  }

  const counts = Array(10).fill(0);
  let evenCount = 0;
  let oddCount = 0;
  let overFiveCount = 0;
  let underFiveCount = 0;
  let equalFiveCount = 0;

  digits.forEach(digit => {
    counts[digit]++;

    if (digit % 2 === 0) {
      evenCount++;
    } else {
      oddCount++;
    }

    if (digit > 5) overFiveCount++;
    else if (digit < 5) underFiveCount++;
    else equalFiveCount++;
  });

  const percent = count =>
    ((count / sampleSize) * 100).toFixed(1) + "%";

  const maxCount = Math.max(...counts);

  const mostDigits = counts
    .map((count, digit) => ({ count, digit }))
    .filter(item => item.count === maxCount)
    .map(item => item.digit)
    .join(", ");

  setText("mostDigit", mostDigits);

  setText(
    "evenOdd",
    `${percent(evenCount)} / ${percent(oddCount)}`
  );

  setText(
    "overUnder",
    `${percent(overFiveCount)} / ${percent(underFiveCount)}`
  );

  setStatus(
    "analysisStatus",
    `Based on ${sampleSize} observed ticks. Digit 5 occurred ${equalFiveCount} times and is excluded from both Over 5 and Under 5. These statistics do not predict the next digit.`,
    "#94a3b8"
  );
}

      
/* ---------------- SIGNAL MONITOR ---------------- */

function updateSignal() {
  setText("signal", "WAIT");
  setText("signalValue", "WAIT");

  setText(
    "signalReason",
    state.digitHistory.length < 50
      ? `Collecting data: ${state.digitHistory.length}/50 ticks. No order will be placed.`
      : "Observation only. Digit frequencies do not reliably predict the next outcome. No order will be placed."
  );

  setStatus(
    "botStatus",
    state.monitoring
      ? "SIGNAL-ONLY · MONITORING"
      : "MONITORING PAUSED",
    state.monitoring ? "#22c55e" : "#f59e0b"
  );

  const buyButton = $("confirmBuy");

  if (buyButton) {
    buyButton.disabled = true;
    buyButton.textContent = "CONFIRM BUY — DISABLED";
    buyButton.title =
      "Trading orders are disabled in this signal-only version.";
  }
}

/* ---------------- LIVE PRICE CHART ---------------- */

function renderChart() {
  const canvas =
    $("priceChart") ||
    $("chartCanvas") ||
    $("liveChart");

  if (!canvas || typeof canvas.getContext !== "function") {
    return;
  }

  const context = canvas.getContext("2d");
  if (!context) return;

  const width = canvas.clientWidth || 600;
  const height = canvas.clientHeight || 220;
  const ratio = window.devicePixelRatio || 1;

  if (
    canvas.width !== Math.round(width * ratio) ||
    canvas.height !== Math.round(height * ratio)
  ) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  context.fillStyle = "#0b1220";
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "#243247";
  context.lineWidth = 1;

  for (let i = 1; i < 4; i += 1) {
    const y = (height / 4) * i;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  if (state.priceHistory.length < 2) {
    context.fillStyle = "#94a3b8";
    context.font = "13px sans-serif";
    context.fillText("Waiting for price data...", 12, 24);
    return;
  }

  const prices = state.priceHistory.map(item => item.price);
  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  const range = maximum - minimum || 1;
  const padding = 12;

  context.strokeStyle = "#38bdf8";
  context.lineWidth = 2;
  context.beginPath();

  prices.forEach((price, index) => {
    const x =
      padding +
      (index / (prices.length - 1)) * (width - padding * 2);

    const y =
      height -
      padding -
      ((price - minimum) / range) * (height - padding * 2);

    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });

  context.stroke();

  context.fillStyle = "#94a3b8";
  context.font = "11px sans-serif";

  context.fillText(maximum.toFixed(2), 8, 13);
  context.fillText(minimum.toFixed(2), 8, height - 4);
}

/* ---------------- OBSERVATION JOURNAL ---------------- */

function recordObservation(note) {
  const observation = {
    time: new Date().toLocaleString(),
    symbol: state.symbol,
    price: state.latestPrice,
    digit: state.latestDigit,
    ticks: state.ticks,
    note
  };

  state.observations.unshift(observation);

  if (state.observations.length > MAX_OBSERVATIONS) {
    state.observations.length = MAX_OBSERVATIONS;
  }

  renderObservations();
}

function renderObservations() {
  const container =
$("observationHistory");

  if (!container) return;

  container.innerHTML = "";

  if (!state.observations.length) {
    container.textContent = "No observations recorded yet.";
    return;
  }

  state.observations.forEach(item => {
    const row = document.createElement("div");

    row.style.padding = "8px";
    row.style.marginBottom = "6px";
    row.style.borderBottom = "1px solid #263449";

    const line = document.createElement("div");
    line.textContent =
      `${item.time} · ${item.symbol} · Price: ${
        item.price === null ? "—" : item.price
      } · Digit: ${
        item.digit === null ? "—" : item.digit
      } · Ticks: ${item.ticks}`;

    const note = document.createElement("div");
    note.textContent = item.note;
    note.style.color = "#94a3b8";

    row.appendChild(line);
    row.appendChild(note);
    container.appendChild(row);
  });
}

/* ---------------- DEMO TRADING SOCKET ---------------- */

async function connectTradingSocket() {
  const existing = state.tradingSocket;

  if (
    existing &&
    (
      existing.readyState === WebSocket.OPEN ||
      existing.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  if (state.tradingConnecting) return;

  state.tradingConnecting = true;

  try {
    const response = await fetch("/api/trading-connection", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" }
    });

    const data = await response.json();

    if (!response.ok || !data.connected) {
      throw new Error(
        data.error || "Could not obtain demo connection."
      );
    }

    // Accept only the exact authenticated demo endpoint.
    const url = new URL(data.ws_url);

    if (
      data.account_type !== "demo" ||
      data.real_trading_enabled !== false ||
      url.protocol !== "wss:" ||
      url.hostname !== "api.derivws.com" ||
      url.pathname !== "/trading/v1/options/ws/demo" ||
      !url.searchParams.has("otp")
    ) {
      throw new Error(
        "Demo-only connection verification failed."
      );
    }

    const socket = new WebSocket(data.ws_url);
    state.tradingSocket = socket;

    socket.addEventListener("open", () => {
      if (state.tradingSocket !== socket) return;

      state.tradingConnected = true;
      state.tradingConnecting = false;

      setStatus(
        "accountStatus",
        "Demo account connected · trading socket ready",
        "#22c55e"
      );

      console.log("Authenticated demo trading socket connected.");
    });

    socket.addEventListener("message", event => {
      if (state.tradingSocket !== socket) return;

      try {
        const message = JSON.parse(event.data);

        // Connection test only: do not send orders.
        if (message.error) {
          console.warn(
            "Demo trading socket response error:",
            message.error.message || message.error.code
          );
        } else {
          console.log(
            "Demo trading socket message:",
            message.msg_type || "response received"
          );
        }
      } catch {
        console.warn("Received an unreadable socket response.");
      }
    });

    socket.addEventListener("error", () => {
      console.warn("Demo trading socket connection error.");
    });

    socket.addEventListener("close", () => {
      if (state.tradingSocket !== socket) return;

      state.tradingSocket = null;
      state.tradingConnected = false;
      state.tradingConnecting = false;

      console.warn("Demo trading socket closed.");
    });

  } catch (error) {
    state.tradingConnected = false;
    state.tradingSocket = null;

    console.warn(
      "Demo trading connection unavailable:",
      error.message
    );
  } finally {
    state.tradingConnecting = false;
  }
}

/* ---------------- ACCOUNT STATUS ---------------- */

async function refreshAccount() {
  setStatus(
    "accountStatus",
    "Checking account status...",
    "#f59e0b"
  );

  try {
    const response = await fetch("/api/account", {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json"
      }
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      setStatus(
        "accountStatus",
        "Unavailable — login required or account check failed.",
        "#f59e0b"
      );

      console.warn("Account check response:", data);
      return;
    }

    setStatus(
      "accountStatus",
      "Demo account connected",
      "#22c55e"
    );

    const account =
      data.account ||
      data.data ||
      data;
if (account.account_type === "demo") {
  connectTradingSocket();
}
    setText(
      "accountId",
      account.account_id ||
      account.loginid ||
      account.id ||
      "Connected"
    );

    const balance =
      account.balance &&
      typeof account.balance === "object"
        ? account.balance.balance
        : account.balance;

    if (balance !== undefined && balance !== null) {
      setText("accountBalance", balance);
      setText("balance", balance);
    }
  } catch (error) {
    console.warn("Account request failed:", error);

    setStatus(
      "accountStatus",
      "Account unavailable. Public market monitoring can work independently.",
      "#f59e0b"
    );
  }
}

/* ---------------- BUTTONS AND EVENTS ---------------- */

function initialise() {
  const marketSelect = $("marketSelect");

  if (marketSelect) {
    marketSelect.addEventListener("change", event => {
      changeMarket(event.target.value);
    });
  }

  const loginButton = $("loginButton");

  if (loginButton) {
    loginButton.addEventListener("click", () => {
      window.location.href = "/login";
    });
  }

  const openDeriv = $("openDeriv");

  if (openDeriv) {
    openDeriv.addEventListener("click", () => {
      window.open(
        "https://deriv.com/",
        "_blank",
        "noopener,noreferrer"
      );
    });
  }

  const startButton = $("startMonitor");

  if (startButton) {
    startButton.addEventListener("click", () => {
      state.monitoring = true;
      updateSignal();


      recordObservation(
        "Signal monitoring started. No orders placed."
      );
    });
  }

  const stopButton = $("stopMonitor");

  if (stopButton) {
    stopButton.addEventListener("click", () => {
      state.monitoring = false;
      updateSignal();

      recordObservation(
        "Signal monitoring paused. No orders placed."
      );
    });
  }

  const confirmBuy = $("confirmBuy");

  if (confirmBuy) {
    confirmBuy.disabled = true;
    confirmBuy.textContent = "CONFIRM BUY — DISABLED";

    confirmBuy.addEventListener("click", event => {
      event.preventDefault();

      recordObservation(
        "Order attempt blocked: trading is disabled in this version."
      );
    });
  }

  const refreshButton = $("refreshAccount");

  if (refreshButton) {
    refreshButton.addEventListener("click", refreshAccount);
  }

  const recordButton = $("recordObservation");

  if (recordButton) {
    recordButton.addEventListener("click", () => {
      const strategy = $("testStrategy");
      const notes = $("testNotes");
      const recordStatus = $("recordStatus");

      const strategyName = strategy
        ? strategy.options[strategy.selectedIndex].text
        : "Unspecified strategy";

      const noteText = notes
        ? notes.value.trim()
        : "";

      if (!noteText) {
        if (recordStatus) {
          recordStatus.textContent =
            "Please enter your observation notes first.";
        }
        return;
      }

      recordObservation(
        strategyName + ": " + noteText
      );

      if (notes) notes.value = "";

      if (recordStatus) {
        recordStatus.textContent =
          "Observation recorded for this session.";
      }
    });
}
                                 
  window.addEventListener("resize", renderChart);

  renderChart();
  renderDigitHistory();
  renderDigitAnalysis();
  renderObservations();
  updateSignal();

  refreshAccount();
  connectPublicSocket();

const appStatus = $("appStatus");

if (appStatus) {
  appStatus.textContent = "Application running";
         }
                                  
  console.log("Tradedollars signal-only script initialized.");
  console.log("Real-money trading: DISABLED.");
  console.log("Automatic order placement: DISABLED.");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialise);
} else {
  initialise();
}

  
