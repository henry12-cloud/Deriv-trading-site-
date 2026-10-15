
"use strict";

/* =====================================================
   TRADEDOLLARS
   Live public market data + digit analysis
   Signal-only mode: no orders are placed.
   Real-money trading remains disabled.
   ===================================================== */

const APP_ID = "34qPaViEQZZw84Mc5thoO";
const PUBLIC_WS_URL =
  `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

const state = {
  socket: null,
  reconnectTimer: null,
  reconnectDelay: 2000,
  connected: false,
  monitoring: true,
  symbol: "1HZ100V",
  marketName: "Volatility 100 (1s) Index",
  ticks: 0,
  latestPrice: null,
  latestDigit: null,
  digitHistory: [],
  priceHistory: [],
  observations: [],
  activeSymbols: [],
  requestId: 0
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
  const decimals = Math.max(0, Math.min(10, Number(pipSize) || 0));
  const formatted = Number(price).toFixed(decimals);
  const digits = formatted.replace(/\D/g, "");
  return digits.length ? Number(digits[digits.length - 1]) : null;
}

function connectPublicSocket() {
  if (
    state.socket &&
    (state.socket.readyState === WebSocket.OPEN ||
     state.socket.readyState === WebSocket.CONNECTING)
  ) return;

  clearTimeout(state.reconnectTimer);
  setStatus("priceStatus", "Connecting to live market data...", "#ffcc66");
  setStatus("marketStatus", "Connecting to market service...", "#ffcc66");

  let socket;
  try {
    socket = new WebSocket(PUBLIC_WS_URL);
  } catch (error) {
    setStatus("priceStatus", "Could not create market connection.", "#ff687b");
    scheduleReconnect();
    return;
  }

  state.socket = socket;

  socket.addEventListener("open", () => {
    state.connected = true;
    state.reconnectDelay = 2000;
    setStatus("priceStatus", "Connected. Requesting market list...", "#25d695");

   socket.send(JSON.stringify({
  active_symbols: "brief",
  req_id: ++state.requestId
}));

  socket.addEventListener("message", event => {
     console.log("DERIV MARKET RESPONSE:", event.data);
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.error("Invalid market response:", error);
      return;
    }

    if (message.error) {
      console.error("Market API error:", message.error);
      const errorText = message.error.message || "Market service returned an error.";
      setStatus("marketStatus", errorText, "#ff687b");
      if (message.echo_req && message.echo_req.ticks) {
        setStatus("priceStatus", errorText, "#ff687b");
      }
      return;
    }

    if (message.active_symbols) {
      processActiveSymbols(message.active_symbols);
      return;
    }

    if (message.tick) {
      processTick(message.tick);
    }
  });

  socket.addEventListener("error", error => {
    console.error("Market WebSocket error:", error);
    setStatus("priceStatus", "Market connection error. Retrying...", "#ff687b");
  });

  socket.addEventListener("close", () => {
    state.connected = false;
    setStatus("priceStatus", "Market connection closed. Reconnecting...", "#ffcc66");
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = setTimeout(() => {
    state.reconnectDelay = Math.min(state.reconnectDelay * 1.5, 15000);
    connectPublicSocket();
  }, state.reconnectDelay);
}

function processActiveSymbols(symbols) {
  if (!Array.isArray(symbols)) {
    setStatus("marketStatus", "Invalid market list received.", "#ff687b");
    return;
  }

  state.activeSymbols = symbols.map(item => ({
    ...item,
    symbol: item.underlying_symbol || item.symbol,
    display_name:
      item.underlying_symbol_name ||
      item.display_name ||
      item.name ||
      item.symbol
  })).filter(item => item.symbol && item.display_name);

  const select = $("marketSelect");
  if (select && state.activeSymbols.length) {
    const previous = state.symbol;
    select.innerHTML = "";

    state.activeSymbols.forEach(item => {
      const option = document.createElement("option");
      option.value = item.symbol;
      option.textContent = item.display_name;
      select.appendChild(option);
    });

    const previousExists = state.activeSymbols.some(
      item => item.symbol === previous
    );

    state.symbol = previousExists
      ? previous
      : (state.activeSymbols.some(item => item.symbol === "1HZ100V")
          ? "1HZ100V"
          : state.activeSymbols[0].symbol);

    select.value = state.symbol;
    const selected = state.activeSymbols.find(
      item => item.symbol === state.symbol
    );
    state.marketName = selected ? selected.display_name : state.symbol;
  }

  setStatus(
    "marketStatus",
    state.activeSymbols.length
      ? `${state.activeSymbols.length} markets loaded`
      : "No markets returned by the service.",
    state.activeSymbols.length ? "#25d695" : "#ff687b"
  );

  setText("selectedMarket", state.marketName);
  subscribeToTicks();
}

function subscribeToTicks() {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;

  state.socket.send(JSON.stringify({
    forget_all: "ticks",
    req_id: ++state.requestId
  }));

  state.socket.send(JSON.stringify({
    ticks: state.symbol,
    subscribe: 1,
    req_id: ++state.requestId
  }));

  setStatus("priceStatus", `Subscribing to ${state.marketName}...`, "#ffcc66");
}

function processTick(tick) {
  if (!tick || tick.quote === undefined) return;
  if (tick.symbol && tick.symbol !== state.symbol) return;

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
  if (state.priceHistory.length > 100) state.priceHistory.shift();

  if (digit !== null) {
    state.digitHistory.push(digit);
    if (state.digitHistory.length > 2000) state.digitHistory.shift();
  }

  setText("livePrice", formatPrice(price, pipSize));
  setText("liveDigit", digit === null ? "--" : String(digit));
  setText("tickCount", state.ticks.toLocaleString());
  setStatus("priceStatus", `Live data received for ${state.marketName}`, "#25d695");
  setStatus("tickStatus", `Received ${state.ticks.toLocaleString()} ticks this session.`, "#25d695");

  renderDigitHistory();
  renderChart();
  renderDigitAnalysis();
  updateSignal();
}

function renderDigitHistory() {
  const container = $("digitHistory");
  if (!container) return;

  const recent = state.digitHistory.slice(-30).reverse();
  container.innerHTML = "";

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
  const sampleSize = digits.length;

  setText("sampleSize", sampleSize.toLocaleString());

  if (!sampleSize) {
    setText("mostDigit", "--");
    setText("evenOdd", "--");
    setText("overUnder", "--");
    setStatus("analysisStatus", "Waiting for digit data...", "#ffcc66");
    return;
  }

  const counts = Array(10).fill(0);
  digits.forEach(digit => counts[digit]++);

  const maxCount = Math.max(...counts);
  const mostFrequent = counts
    .map((count, digit) => ({ digit, count }))
    .filter(item => item.count === maxCount)
    .map(item => item.digit)
    .join(", ");

  const even = digits.filter(digit => digit % 2 === 0).length;
  const odd = sampleSize - even;
  const over = digits.filter(digit => digit > 5).length;
  const under = digits.filter(digit => digit < 5).length;

  const percentage = count =>
    `${((count / sampleSize) * 100).toFixed(1)}%`;

  setText("mostDigit", `${mostFrequent} (${percentage(maxCount)})`);
  setText("evenOdd", `Even ${percentage(even)} / Odd ${percentage(odd)}`);
  setText("overUnder", `Over 5: ${percentage(over)} / Under 5: ${percentage(under)}`);

  setStatus(
    "analysisStatus",
    `Descriptive statistics from ${sampleSize.toLocaleString()} digits. These frequencies do not predict the next digit.`,
    "#9cafc6"
  );
}

function renderChart() {
  const canvas = $("priceChart");
  if (!canvas) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#091626";
  context.fillRect(0, 0, width, height);

  const prices = state.priceHistory;
  if (prices.length < 2) {
    context.fillStyle = "#9cafc6";
    context.font = "16px Arial";
    context.fillText("Waiting for price history...", 20, 35);
    return;
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const pad = 18;

  context.strokeStyle = "#25d695";
  context.lineWidth = 2;
  context.beginPath();

  prices.forEach((price, index) => {
    const x = pad + index * (width - pad * 2) / (prices.length - 1);
    const y = height - pad - ((price - min) / range) * (height - pad * 2);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });

  context.stroke();

  context.fillStyle = "#9cafc6";
  context.font = "12px Arial";
  context.fillText(formatPrice(max, 4), 8, 14);
  context.fillText(formatPrice(min, 4), 8, height - 5);
}

function updateSignal() {
  if (!state.monitoring) {
    setText("signal", "STOPPED");
    setStatus("signalReason", "Signal monitor is stopped.", "#9cafc6");
    return;
  }

  const sample = state.digitHistory.slice(-100);
  if (sample.length < 50) {
    setText("signal", "WAIT");
    setStatus(
      "signalReason",
      `Collecting data: ${sample.length}/50 recent digits needed for a basic frequency report.`,
      "#ffcc66"
    );
    return;
  }

  const strategy = $("testStrategy")?.value || "overunder";
  let firstCount = 0;
  let secondCount = 0;
  let firstName = "";
  let secondName = "";

  if (strategy === "evenodd") {
    firstCount = sample.filter(digit => digit % 2 === 0).length;
    secondCount = sample.length - firstCount;
    firstName = "EVEN";
    secondName = "ODD";
  } else {
    firstCount = sample.filter(digit => digit > 5).length;
    secondCount = sample.filter(digit => digit < 5).length;
    firstName = "OVER 5";
    secondName = "UNDER 5";
  }

  const difference = Math.abs(firstCount - secondCount) / sample.length;

  setText("signal", "WAIT");
  setStatus(
    "signalReason",
    `${firstName}: ${((firstCount / sample.length) * 100).toFixed(1)}%; ${secondName}: ${((secondCount / sample.length) * 100).toFixed(1)}%. Difference: ${(difference * 100).toFixed(1)}%. This is historical frequency, not a predictive signal.`,
    "#ffcc66"
  );
}

async function refreshAccount() {
  setText("accountStatus", "Checking...");
  try {
    const response = await fetch("/api/account", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" }
    });

    if (!response.ok) throw new Error(`Account endpoint returned ${response.status}`);

    const data = await response.json();

    if (data.connected && data.account) {
      const account = data.account;
      setText("accountStatus", "Demo connected");
      setText("accountId", account.id || "--");
      setText(
        "accountBalance",
        `${account.currency || "USD"} ${formatPrice(account.balance, 2)}`
      );
      setStatus("accountMessage", "Demo account connected. Real-money trading is disabled.", "#25d695");
      return;
    }

    setText("accountStatus", "Not connected");
    setText("accountId", "--");
    setText("accountBalance", "--");
    setStatus("accountMessage", "Log in with Deriv to view your demo account.", "#ffcc66");
  } catch (error) {
    console.error("Account refresh failed:", error);
    setText("accountStatus", "Unavailable");
    setStatus("accountMessage", "Could not check account status. Refresh and try again.", "#ff687b");
  }
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
  if (state.observations.length > 50) state.observations.pop();

  setText("recordStatus", `Recorded observation at ${observation.time}.`);
  renderObservations();
}

function renderObservations() {
  const container = $("observationHistory");
  if (!container) return;
  container.innerHTML = "";

  state.observations.forEach(item => {
    const card = document.createElement("div");
    card.className = "status";
    card.style.marginTop = "8px";

    const heading = document.createElement("strong");
    heading.textContent = `${item.time} — ${item.strategy === "evenodd" ? "Even/Odd" : "Over/Under"}`;

    const details = document.createElement("p");
    details.textContent =
      `Sample: ${item.sample}; price: ${item.price === null ? "--" : item.price}; last digit: ${item.digit === null ? "--" : item.digit}. Notes: ${item.notes}`;

    card.append(heading, details);
    container.appendChild(card);
  });
}

function startMonitor() {
  state.monitoring = true;
  setStatus("botStatus", "Signal-only mode active. No orders will be placed.", "#25d695");
  updateSignal();
}

function stopMonitor() {
  state.monitoring = false;
  setStatus("botStatus", "Signal monitor stopped. No orders are placed.", "#ffcc66");
  updateSignal();
}

function handleMarketChange() {
  const select = $("marketSelect");
  if (!select || !select.value) return;

  state.symbol = select.value;
  const selected = state.activeSymbols.find(item => item.symbol === state.symbol);
  state.marketName = selected ? selected.display_name : state.symbol;

  state.ticks = 0;
  state.latestPrice = null;
  state.latestDigit = null;
  state.digitHistory = [];
  state.priceHistory = [];

  setText("selectedMarket", state.marketName);
  setText("livePrice", "--");
  setText("liveDigit", "--");
  setText("tickCount", "0");
  renderDigitHistory();
  renderChart();
  renderDigitAnalysis();
  updateSignal();
  subscribeToTicks();
}

function initialise() {
  setStatus("appStatus", "Application running — real-money trading disabled.", "#25d695");

  $("refreshAccount")?.addEventListener("click", refreshAccount);
  $("marketSelect")?.addEventListener("change", handleMarketChange);
  $("startMonitor")?.addEventListener("click", startMonitor);
  $("stopMonitor")?.addEventListener("click", stopMonitor);
  $("recordObservation")?.addEventListener("click", recordObservation);
  $("testStrategy")?.addEventListener("change", updateSignal);

  refreshAccount();
  connectPublicSocket();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialise, { once: true });
} else {
  initialise();
   }
   
