
/* =========================================================
   TRADEDOLLARS — MARKET CONNECTION REPAIR
   Live markets, continuous ticks, chart and analysis.
   Real-money trading and order execution are disabled.
========================================================= */

"use strict";

const state = {
  config: null,
  loggedIn: false,
  account: null,
  socket: null,
  connected: false,
  markets: [],
  symbol: "",
  totalTicks: 0,
  prices: [],
  digits: [],
  requestId: 1000,
  reconnectTimer: null,
  reconnectDelay: 3000
};

const $ = id => document.getElementById(id);

// Compatibility helper used by the interface.
function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = String(value ?? "--");
}

function show(id, value) {
  setText(id, value);
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "--";
}

function setConnection(message) {
  show("connectionStatus", message);
}

function setPriceStatus(message) {
  show("priceStatus", message);
}

function send(payload) {
  if (
    !state.socket ||
    state.socket.readyState !== WebSocket.OPEN
  ) {
    return false;
  }

  state.socket.send(JSON.stringify(payload));
  return true;
}

/* =========================================================
   SERVER CONFIGURATION AND ACCOUNT
========================================================= */

async function loadConfig() {
  const response = await fetch("/api/config", {
    cache: "no-store",
    credentials: "same-origin"
  });

  if (!response.ok) {
    throw new Error("Could not load server configuration.");
  }

  state.config = await response.json();

  const accountType = $("accountType");

  if (accountType) {
    [...accountType.options].forEach(option => {
      if (option.value === "real") option.disabled = true;
    });

    accountType.value = "demo";
  }

  return state.config;
}

async function checkAccount() {
  try {
    const response = await fetch("/api/session", {
      cache: "no-store",
      credentials: "same-origin"
    });

    if (!response.ok) {
      throw new Error("Session check failed.");
    }

    const data = await response.json();
    state.loggedIn = Boolean(data.authenticated);

    if (!state.loggedIn) {
      state.account = null;
      show("accountStatus", "Log in first");
      show("accountId", "--");
      show("balance", "--");

      if ($("loginBtn")) $("loginBtn").hidden = false;
      if ($("logoutBtn")) $("logoutBtn").hidden = true;
      return;
    }

    if ($("loginBtn")) $("loginBtn").hidden = true;
    if ($("logoutBtn")) $("logoutBtn").hidden = false;

    await loadAccount();
  } catch (error) {
    console.error("Account session error:", error);
    show("accountStatus", "Session check failed");
  }
}

async function loadAccount() {
  try {
    const response = await fetch("/api/account", {
      cache: "no-store",
      credentials: "same-origin"
    });

    const data = await response.json();

    if (!response.ok || !data.account) {
      throw new Error(data.error || "Demo account unavailable.");
    }

    const account = data.account;
    const type = String(
      account.account_type || account.accountType || ""
    ).toLowerCase();

    if (type !== "demo") {
      throw new Error("Only a verified demo account is permitted.");
    }

    state.account = account;

    show("accountStatus", "Demo account connected");
    show(
      "accountId",
      account.account_id || account.id || "--"
    );
    show(
      "balance",
      `${money(account.balance)} ${account.currency || "USD"}`
    );
    show("accountTypeMessage", "Demo Account selected");
  } catch (error) {
    state.account = null;
    console.error("Demo account error:", error);
    show("accountStatus", "Demo account unavailable");
    show("accountId", "--");
    show("balance", "--");
    show("accountTypeMessage", error.message);
  }
}

async function logout() {
  try {
    await fetch("/logout", {
      method: "POST",
      credentials: "same-origin"
    });
  } catch (error) {
    console.error("Logout error:", error);
  }

  state.loggedIn = false;
  state.account = null;

  show("accountStatus", "Log in first");
  show("accountId", "--");
  show("balance", "--");

  if ($("loginBtn")) $("loginBtn").hidden = false;
  if ($("logoutBtn")) $("logoutBtn").hidden = true;
}

/* =========================================================
   PUBLIC MARKET DATA
========================================================= */

function connectPublicSocket() {
  clearTimeout(state.reconnectTimer);

  if (
    state.socket &&
    (
      state.socket.readyState === WebSocket.OPEN ||
      state.socket.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  // This is the numeric Deriv application ID, not the OAuth
  // client ID. The server exposes it through /api/config.
  const appId = String(state.config?.app_id || "").trim();

  if (!/^\d+$/.test(appId)) {
    setConnection("Deriv App ID missing or invalid");
    setPriceStatus(
      "Set DERIV_APP_ID in Render to your numeric Deriv application ID."
    );
    show("marketStatus", "Market connection not started");
    return;
  }
const url = "wss://ws.derivws.com/websockets/v3";

  setConnection("Connecting to Deriv market data...");
  setPriceStatus("Opening market connection...");

  let socket;

  try {
    socket = new WebSocket(url);
  } catch (error) {
    setConnection("Could not create market connection");
    setPriceStatus(error.message);
    scheduleReconnect();
    return;
  }

  state.socket = socket;
  state.connected = false;

  socket.onopen = () => {
    if (state.socket !== socket) return;

    state.connected = true;
    state.reconnectDelay = 3000;

    setConnection("Connected; requesting markets...");
    setPriceStatus("Waiting for market list...");

    send({
      active_symbols: "brief",
      req_id: ++state.requestId
    });
  };

  socket.onmessage = event => {
    if (state.socket !== socket) return;

    let data;

    try {
      data = JSON.parse(event.data);
    } catch (error) {
      console.error("Invalid market response:", event.data);
      setPriceStatus("Could not read market response.");
      return;
    }

    console.log("Tradedollars market response:", data);
    handleMarketMessage(data);
  };

  socket.onerror = error => {
    if (state.socket !== socket) return;

    console.error("Market socket error:", error);
    setConnection("Market connection error");
    setPriceStatus(
      "Check the App ID and internet connection."
    );
  };

  socket.onclose = event => {
    if (state.socket !== socket) return;

    state.connected = false;
    setConnection(`Market disconnected (code ${event.code})`);
    setPriceStatus(
      event.reason || "Reconnecting to market data..."
    );

    scheduleReconnect();
  };
}

function scheduleReconnect() {
  clearTimeout(state.reconnectTimer);

  state.reconnectTimer = setTimeout(
    connectPublicSocket,
    state.reconnectDelay
  );

  state.reconnectDelay = Math.min(
    state.reconnectDelay * 2,
    30000
  );
}

function handleMarketMessage(data) {
  if (data.error) {
    const message =
      data.error.message || data.error.code || "Unknown API error";

    console.error("Deriv API error:", data.error);
    setConnection("Deriv rejected the request");
    setPriceStatus(message);
    show("marketStatus", message);
    return;
  }

  if (data.msg_type === "active_symbols" &&
      Array.isArray(data.active_symbols)) {
    state.markets = data.active_symbols.filter(
      item => item && item.symbol
    );

    show("marketStatus", `${state.markets.length} markets received`);

    if (!state.markets.length) {
      setPriceStatus("Deriv returned no active markets.");
      return;
    }

    populateMarkets();
    return;
  }

  if (data.msg_type === "tick" && data.tick) {
    processTick(data.tick);
    return;
  }

  if (data.msg_type === "forget" || data.msg_type === "ping") {
    return;
  }

  console.log("Other Deriv response:", data);
}

function populateMarkets() {
  const select = $("marketSelect");
  if (!select) return;

  select.replaceChildren();

  for (const market of state.markets) {
    const option = document.createElement("option");
    option.value = market.symbol;
    option.textContent = market.display_name || market.symbol;
    select.appendChild(option);
  }

  show("marketStatus", `${state.markets.length} markets loaded`);

  const preferred = state.markets.find(
    market => market.symbol === "1HZ100V"
  );

  const symbol = preferred
    ? preferred.symbol
    : state.markets[0].symbol;

  select.value = symbol;
  selectMarket(symbol);
}

function selectMarket(symbol) {
  if (!symbol || !state.connected) return;

  if (state.symbol) {
    send({
      forget: "ticks",
      symbol: state.symbol,
      req_id: ++state.requestId
    });
  }

  state.symbol = symbol;
  state.totalTicks = 0;
  state.prices = [];
  state.digits = [];

  const market = state.markets.find(
    item => item.symbol === symbol
  );

  show("selectedMarket", market?.display_name || symbol);
  show("livePrice", "--");
  show("liveDigit", "--");

  updateDigitHistory();
  updateDigitsAnalysis();
  updateMarketAnalysis();
  drawChart();

  setPriceStatus(`Subscribing to ${symbol}...`);

  send({
    ticks: symbol,
    subscribe: 1,
    req_id: ++state.requestId
  });
}

/* =========================================================
   CONTINUOUS TICK PROCESSING
========================================================= */

function processTick(tick) {
  if (
    tick.symbol &&
    state.symbol &&
    tick.symbol !== state.symbol
  ) {
    return;
  }

  const price = Number(tick.quote);
  if (!Number.isFinite(price)) return;

  state.totalTicks++;
  state.prices.push(price);

  if (state.prices.length > 50) {
    state.prices.shift();
  }

  const decimals = Math.max(
    0,
    Math.min(8, Number(tick.pip_size ?? 2))
  );

  const formatted = price.toFixed(decimals);
  const digit = Number(formatted.slice(-1));

  state.digits.push(digit);

  if (state.digits.length > 2000) {
    state.digits.shift();
  }

  show("livePrice", formatted);
  show("liveDigit", digit);

  setConnection("Live market data connected");
  setPriceStatus(
    `Live • ${state.totalTicks.toLocaleString()} ticks received`
  );

  updateDigitHistory();
  updateDigitsAnalysis();
  updateMarketAnalysis();
  drawChart();
}

function updateDigitHistory() {
  const container = $("liveDigitHistory");
  if (!container) return;

  container.replaceChildren();

  if (!state.digits.length) {
    const span = document.createElement("span");
    span.textContent = "Waiting for ticks...";
    container.appendChild(span);
    return;
  }

  state.digits.slice(-12).forEach(digit => {
    const span = document.createElement("span");
    span.textContent = digit;
    span.style.cssText =
      "background:#334155;padding:7px 10px;border-radius:7px;";
    container.appendChild(span);
  });
}

/* =========================================================
   DIGIT STATISTICS — DESCRIPTIVE, NOT PREDICTIVE
========================================================= */

function updateDigitsAnalysis() {
  const digits = state.digits;
  const total = digits.length;

  show("digitsSample", `${total.toLocaleString()} ticks`);

  if (!total) {
    [
      "mostFrequentDigit",
      "leastFrequentDigit",
      "evenPercentage",
      "oddPercentage",
      "overFivePercentage",
      "underFivePercentage",
      "repeatedDigit"
    ].forEach(id => show(id, "--"));

    show("digitBias", "WAIT");
    show("digitConfidence", "LOW");
    show("digitAnalysisMessage", "Waiting for live tick data.");
    return;
  }

  const counts = Array(10).fill(0);
  digits.forEach(digit => counts[digit]++);

  const most = Math.max(...counts);
  const seenCounts = counts.filter(count => count > 0);
  const least = Math.min(...seenCounts);

  const mostDigit = counts.indexOf(most);
  const leastDigit = counts.findIndex(count => count === least);

  const even = digits.filter(d => d % 2 === 0).length;
  const odd = total - even;
  const over = digits.filter(d => d > 5).length;
  const under = digits.filter(d => d < 5).length;

  const evenPct = even / total * 100;
  const oddPct = odd / total * 100;
  const overPct = over / total * 100;
  const underPct = under / total * 100;

  let bias = "NEUTRAL";
  let confidence = "LOW";

  if (total >= 200) {
    const difference = Math.abs(evenPct - oddPct);

    if (difference >= 10) {
      bias = evenPct > oddPct ? "EVEN BIAS" : "ODD BIAS";
    }

    if (difference >= 18) confidence = "MEDIUM";
  }

  show(
    "mostFrequentDigit",
    `${mostDigit} (${(most / total * 100).toFixed(1)}%)`
  );

  show(
    "leastFrequentDigit",
    `${leastDigit} (${(least / total * 100).toFixed(1)}%)`
  );

  show("evenPercentage", `${evenPct.toFixed(1)}%`);
  show("oddPercentage", `${oddPct.toFixed(1)}%`);
  show("overFivePercentage", `${overPct.toFixed(1)}%`);
  show("underFivePercentage", `${underPct.toFixed(1)}%`);

  show(
    "repeatedDigit",
    total >= 2 && digits[total - 1] === digits[total - 2]
      ? "YES"
      : "NO"
  );

  show("digitBias", bias);
  show("digitConfidence", confidence);

  show(
    "digitAnalysisMessage",
    total < 200
      ? `Collecting initial sample: ${total}/200 ticks.`
      : "Past frequencies do not reliably predict the next digit."
  );
}

/* =========================================================
   CHART
========================================================= */

function drawChart() {
  const canvas = $("chart");
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(300, Math.floor(rect.width));
  const height = Math.max(220, Math.floor(rect.height));
  const dpr = window.devicePixelRatio || 1;

  canvas.width = width * dpr;
  canvas.height = height * dpr;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  if (state.prices.length < 2) return;

  const min = Math.min(...state.prices);
  const max = Math.max(...state.prices);
  const range = max - min || 1;
  const pad = 20;

  ctx.beginPath();

  state.prices.forEach((price, index) => {
    const x = pad +
      index / (state.prices.length - 1) * (width - pad * 2);

    const y = height - pad -
      (price - min) / range * (height - pad * 2);

    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.strokeStyle = "#2196f3";
  ctx.lineWidth = 2;
  ctx.stroke();
}

/* =========================================================
   BASIC RISE/FALL CONTEXT
========================================================= */

function updateMarketAnalysis() {
  const prices = state.prices;

  if (prices.length < 20) {
    show("analysisTrend", "WAITING");
    show("analysisMomentum", "WAITING");
    show("analysisSupport", "--");
    show("analysisResistance", "--");
    show("analysisSignal", "WAIT");
    show("analysisConfidence", "LOW");
    show("analysisReason", "Collecting 20 live price points.");
    return;
  }

  const avg = values =>
    values.reduce((sum, value) => sum + value, 0) / values.length;

  const shortChange =
    avg(prices.slice(-5)) - avg(prices.slice(-10, -5));

  const mediumChange =
    avg(prices.slice(-10)) - avg(prices.slice(-20, -10));

  let trend = "NEUTRAL";

  if (shortChange > 0 && mediumChange > 0) trend = "BULLISH";
  if (shortChange < 0 && mediumChange < 0) trend = "BEARISH";

  const recent = prices.slice(-20);
  const support = Math.min(...recent);
  const resistance = Math.max(...recent);
  const range = resistance - support;

  const ratio = range > 0 ? Math.abs(shortChange) / range : 0;

  const momentum =
    ratio >= 0.25 ? "STRONG" :
    ratio >= 0.10 ? "MODERATE" : "WEAK";

  let up = 0;
  let down = 0;
  const lastPrices = prices.slice(-8);

  for (let i = 1; i < lastPrices.length; i++) {
    if (lastPrices[i] > lastPrices[i - 1]) up++;
    if (lastPrices[i] < lastPrices[i - 1]) down++;
  }

  const moves = up + down;
  const consistency = moves
    ? Math.max(up, down) / moves
    : 0;

  const current = prices[prices.length - 1];

  const nearSupport =
    range > 0 && current - support <= range * 0.15;

  const nearResistance =
    range > 0 && resistance - current <= range * 0.15;

  let signal = "WAIT";

  if (
    trend === "BULLISH" &&
    momentum !== "WEAK" &&
    consistency >= 0.60 &&
    !nearResistance
  ) {
    signal = "RISE";
  } else if (
    trend === "BEARISH" &&
    momentum !== "WEAK" &&
    consistency >= 0.60 &&
    !nearSupport
  ) {
    signal = "FALL";
  }

  show("analysisTrend", trend);
  show("analysisMomentum", momentum);
  show("analysisSupport", support.toFixed(2));
  show("analysisResistance", resistance.toFixed(2));
  show("analysisSignal", signal);

  show(
    "analysisConfidence",
    signal === "WAIT"
      ? "LOW"
      : momentum === "STRONG" && consistency >= 0.75
        ? "HIGH"
        : "MEDIUM"
  );

  show(
    "analysisReason",
    signal === "WAIT"
      ? "Conditions are not sufficiently confirmed. Wait."
      : `${trend} conditions detected; this is not a guarantee of the next move.`
  );
}

/* =========================================================
   EVENTS AND STARTUP
========================================================= */

function bindEvents() {
  if ($("loginBtn")) {
    $("loginBtn").addEventListener("click", () => {
      window.location.href = "/login";
    });
  }

  if ($("logoutBtn")) {
    $("logoutBtn").addEventListener("click", logout);
  }

  if ($("marketSelect")) {
    $("marketSelect").addEventListener("change", event => {
      selectMarket(event.target.value);
    });
  }

  if ($("accountType")) {
    $("accountType").addEventListener("change", event => {
      event.target.value = "demo";
      show(
        "accountTypeMessage",
        "Real-money trading is disabled. Demo remains selected."
      );
    });
  }

  if ($("contractType")) {
    $("contractType").addEventListener("change", event => {
      const type = event.target.value;
      const isDigit =
        type === "DIGITOVER" || type === "DIGITUNDER";

      if ($("barrierContainer")) {
        $("barrierContainer").style.display =
          isDigit ? "block" : "none";
      }
    });
  }

  if ($("riseBtn")) {
    $("riseBtn").addEventListener("click", () => {
      if ($("contractType")) $("contractType").value = "CALL";
      show("directionStatus", "RISE selected — demo order execution is disabled.");
    });
  }

  if ($("fallBtn")) {
    $("fallBtn").addEventListener("click", () => {
      if ($("contractType")) $("contractType").value = "PUT";
      show("directionStatus", "FALL selected — demo order execution is disabled.");
    });
  }

  // Never send buy requests in this market-data repair version.
  if ($("buyBtn")) {
    $("buyBtn").disabled = true;
    $("buyBtn").textContent = "BUY DISABLED";
  }

  show("quoteStatus", "Quotes disabled during connection repair");
  show("tradeMessage", "No orders can be sent in this version.");
  show("directionStatus", "Market-data diagnostic mode");
}

async function startApp() {
  bindEvents();

  setConnection("Starting Tradedollars...");
  setPriceStatus("Checking configuration...");

  try {
    await loadConfig();
    await checkAccount();

    const appId = String(state.config?.app_id || "").trim();


    connectPublicSocket();
  } catch (error) {
    console.error("Startup error:", error);
    setConnection("Startup failed");
    setPriceStatus(error.message || "Could not initialize the app.");
  }
}

/* =========================================================
   APPLICATION ENTRY POINT
========================================================= */

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApp);
} else {
  startApp();
}
