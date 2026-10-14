
/* =========================================================
   TRADEDOLLARS — CLEAN MARKET DATA VERSION
   Live markets, ticks, chart, analysis and account status
   Real-money trading remains disabled.
   ========================================================= */

"use strict";

const PUBLIC_WS_URL =
  "wss://api.derivws.com/trading/v1/options/ws/public";

const state = {
  config: null,
  loggedIn: false,
  account: null,
  socket: null,
  connected: false,
  markets: [],
  symbol: "",
  marketName: "",
  totalTicks: 0,
  prices: [],
  digits: [],
  requestId: 1000,
  reconnectTimer: null,
  reconnectDelay: 3000
};

const $ = id => document.getElementById(id);

function show(id, value) {
  const element = $(id);
  if (element) element.textContent = String(value ?? "--");
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "--";
}

function send(payload) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {
    state.socket.send(JSON.stringify(payload));
    return true;
  } catch (error) {
    console.error("Market send error:", error);
    return false;
  }
}

function setConnection(message) {
  show("connectionStatus", message);
}

function setPriceStatus(message) {
  show("priceStatus", message);
}

/* =========================================================
   ACCOUNT STATUS
========================================================= */

async function loadConfig() {
  try {
    const response = await fetch("/api/config", {
      cache: "no-store",
      credentials: "same-origin"
    });

    if (!response.ok) {
      throw new Error("Server configuration request failed.");
    }

    state.config = await response.json();

    // Never allow real trading in this version.
    const accountType = $("accountType");

    if (accountType) {
      const realOption = [...accountType.options]
        .find(option => option.value === "real");

      if (realOption) realOption.disabled = true;
      accountType.value = "demo";
    }
  } catch (error) {
    console.error("Config error:", error);
    setConnection("Server configuration unavailable");
  }
}

async function checkAccount() {
  try {
    const response = await fetch("/api/session", {
      cache: "no-store",
      credentials: "same-origin"
    });

    if (!response.ok) {
      throw new Error("Could not check login session.");
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
    console.error("Session error:", error);
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

    state.account = data.account;

    if (state.account.account_type !== "demo") {
      state.account = null;
      throw new Error("Only a verified demo account is allowed.");
    }

    show("accountStatus", "Demo account connected");
    show(
      "accountId",
      state.account.account_id || state.account.id || "--"
    );
    show(
      "balance",
      `${money(state.account.balance)} ${state.account.currency || "USD"}`
    );
    show("accountTypeMessage", "Demo Account selected");
  } catch (error) {
    console.error("Account error:", error);
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
   PUBLIC MARKET SOCKET
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

  setConnection("Connecting to public market data...");
  setPriceStatus("Opening market data connection...");

  let socket;

  try {
    socket = new WebSocket(PUBLIC_WS_URL);
  } catch (error) {
    setConnection("Could not create market connection");
    setPriceStatus(error.message);
    scheduleReconnect();
    return;
  }

  state.socket = socket;
  state.connected = false;

  // Show a useful message if the server never responds.
  const connectionTimeout = setTimeout(() => {
    if (
      state.socket === socket &&
      socket.readyState === WebSocket.CONNECTING
    ) {
      setConnection("Market connection is taking too long");
      setPriceStatus("Check your internet connection and reload.");
    }
  }, 10000);

  socket.onopen = () => {
    if (state.socket !== socket) return;

    clearTimeout(connectionTimeout);
    state.connected = true;
    state.reconnectDelay = 3000;

    setConnection("Market socket connected; requesting markets...");
    setPriceStatus("Waiting for market list...");

    send({
      active_symbols: "brief",
      product_type: "basic",
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
      setPriceStatus("Received an unreadable market response.");
      return;
    }

    console.log("Tradedollars market response:", data);
    handleMarketMessage(data);
  };

  socket.onerror = error => {
    if (state.socket !== socket) return;

    console.error("Public socket error:", error);
    setConnection("Market socket error");
    setPriceStatus(
      "The browser could not complete the market connection. Check internet access."
    );
  };

  socket.onclose = event => {
    clearTimeout(connectionTimeout);

    if (state.socket !== socket) return;

    state.connected = false;

    setConnection(`Market disconnected (code ${event.code})`);
    setPriceStatus(
      event.reason
        ? `Connection closed: ${event.reason}`
        : "The market connection closed. Reconnecting..."
    );

    scheduleReconnect();
  };
}

function scheduleReconnect() {
  clearTimeout(state.reconnectTimer);

  state.reconnectTimer = setTimeout(() => {
    connectPublicSocket();
  }, state.reconnectDelay);

  state.reconnectDelay = Math.min(
    state.reconnectDelay * 2,
    30000
  );
}

function handleMarketMessage(data) {
  if (data.error || data.errors) {
    const errorObject = data.error || data.errors[0] || {};
    const message =
      errorObject.message ||
      errorObject.code ||
      JSON.stringify(errorObject);

    console.error("Market API returned an error:", data);
    setConnection("Market API rejected the request");
    setPriceStatus(message);
    show("marketStatus", `Market API error: ${message}`);
    return;
  }

  const symbols =
    data.active_symbols ||
    data.data?.active_symbols;

  if (Array.isArray(symbols)) {
    state.markets = symbols.filter(item =>
      item.underlying_symbol || item.symbol
    );

    show("marketStatus", `${state.markets.length} markets received`);

    if (state.markets.length === 0) {
      setPriceStatus("The API returned an empty market list.");
      return;
    }

    populateMarkets();
    setConnection("Market list loaded");
    return;
  }

  const tick =
    data.tick ||
    data.data?.tick;

  if (tick) {
    processTick(tick);
    return;
  }

  // Some responses may wrap fields differently. Show them visibly.
  const preview = JSON.stringify(data).slice(0, 350);

  setPriceStatus(`API response received: ${preview}`);
  show("marketStatus", "Received a response; checking its format.");
}

function populateMarkets() {
  const select = $("marketSelect");
  if (!select) return;

  select.replaceChildren();

  state.markets.forEach(market => {
    const symbol =
      market.underlying_symbol || market.symbol;

    const name =
      market.underlying_symbol_name ||
      market.display_name ||
      symbol;

    const option = document.createElement("option");
    option.value = symbol;
    option.textContent = name;

    select.appendChild(option);
  });

  show("marketStatus", `${state.markets.length} markets loaded`);

  const preferred = state.markets.find(m =>
    (m.underlying_symbol || m.symbol) === "1HZ100V"
  );

  select.value = preferred
    ? (preferred.underlying_symbol || preferred.symbol)
    : (state.markets[0].underlying_symbol || state.markets[0].symbol);

  selectMarket(select.value);
}

function selectMarket(symbol) {
  if (!symbol || !state.connected) return;

  state.symbol = symbol;

  const market = state.markets.find(item =>
    (item.underlying_symbol || item.symbol) === symbol
  );

  state.marketName =
    market?.underlying_symbol_name ||
    market?.display_name ||
    symbol;

  show("selectedMarket", state.marketName);
  show("livePrice", "--");
  show("liveDigit", "--");

  state.totalTicks = 0;
  state.prices = [];
  state.digits = [];

  updateDigitHistory();
  updateDigitsAnalysis();
  updateMarketAnalysis();
  drawChart();

  setPriceStatus(`Subscribing to ${state.marketName}...`);

  // Forget old tick subscriptions, then subscribe to this market.
  send({
    forget_all: "ticks",
    req_id: ++state.requestId
  });

  send({
    ticks: symbol,
    subscribe: 1,
    req_id: ++state.requestId
  });
}

/* =========================================================
   LIVE TICK PROCESSING
========================================================= */

function processTick(tick) {
  const symbol = tick.underlying_symbol || tick.symbol;

  if (symbol && state.symbol && symbol !== state.symbol) {
    return;
  }

  const price = Number(tick.quote);

  if (!Number.isFinite(price)) {
    console.warn("Tick has no valid quote:", tick);
    return;
  }

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
    span.className = "muted";
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

function updateDigitsAnalysis() {
  const digits = state.digits;
  const total = digits.length;

  show("digitsSample", `${total.toLocaleString()} ticks`);

  if (!total) {
    show("mostFrequentDigit", "--");
    show("leastFrequentDigit", "--");
    show("evenPercentage", "--");
    show("oddPercentage", "--");
    show("overFivePercentage", "--");
    show("underFivePercentage", "--");
    show("repeatedDigit", "--");
    show("digitBias", "WAIT");
    show("digitConfidence", "LOW");
    show("digitAnalysisMessage", "Waiting for live tick data.");
    return;
  }

  const counts = Array(10).fill(0);
  digits.forEach(digit => counts[digit]++);

  const most = Math.max(...counts);
  const leastSeen = counts.filter(count => count > 0);
  const least = Math.min(...leastSeen);

  const mostDigit = counts.indexOf(most);
  const leastDigit = counts.indexOf(least);

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
      : "Historical frequencies do not reliably predict the next digit."
  );
}

/* =========================================================
   PRICE CHART
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
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  if (state.prices.length < 2) return;

  const min = Math.min(...state.prices);
  const max = Math.max(...state.prices);
  const range = max - min || 1;
  const pad = 20;

  ctx.beginPath();

  state.prices.forEach((price, index) => {
    const x =
      pad + index / (state.prices.length - 1) * (width - pad * 2);

    const y =
      height - pad - (price - min) / range * (height - pad * 2);

    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.strokeStyle = "#2196f3";
  ctx.lineWidth = 2;
  ctx.stroke();
}

/* =========================================================
   SIMPLE MARKET ANALYSIS
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

  const avg = list =>
    list.reduce((sum, value) => sum + value, 0) / list.length;

  const shortChange =
    avg(prices.slice(-5)) - avg(prices.slice(-10, -5));

  const mediumChange =
    avg(prices.slice(-10)) - avg(prices.slice(-20, -10));

  let trend = "NEUTRAL";

  if (shortChange > 0 && mediumChange > 0) trend = "BULLISH";
  if (shortChange < 0 && mediumChange < 0) trend = "BEARISH";

  const last20 = prices.slice(-20);
  const support = Math.min(...last20);
  const resistance = Math.max(...last20);
  const range = resistance - support;

  const momentumRatio =
    range > 0 ? Math.abs(shortChange) / range : 0;

  const momentum =
    momentumRatio >= 0.25 ? "STRONG" :
    momentumRatio >= 0.10 ? "MODERATE" : "WEAK";

  let up = 0;
  let down = 0;
  const recent = prices.slice(-8);

  for (let i = 1; i < recent.length; i++) {
    if (recent[i] > recent[i - 1]) up++;
    if (recent[i] < recent[i - 1]) down++;
  }

  const moves = up + down;
  const consistency =
    moves > 0 ? Math.max(up, down) / moves : 0;

  const nearSupport =
    range > 0 && prices[prices.length - 1] - support <= range * 0.15;

  const nearResistance =
    range > 0 && resistance - prices[prices.length - 1] <= range * 0.15;

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
      : `${trend} conditions detected. This does not predict the next move with certainty.`
  );
}

/* =========================================================
   SAFE UI INITIALIZATION
========================================================= */

function bindEvents() {
  if ($("marketSelect")) {
    $("marketSelect").addEventListener("change", event => {
      selectMarket(event.target.value);
    });
  }

  if ($("logoutBtn")) {
    $("logoutBtn").addEventListener("click", logout);
  }

  if ($("accountType")) {
    $("accountType").addEventListener("change", event => {
      if (event.target.value === "real") {
        event.target.value = "demo";
        show(
          "accountTypeMessage",
          "Real trading is disabled. Demo Account remains selected."
        );
      }
    });
  }

  if ($("contractType")) {
    $("contractType").addEventListener("change", event => {
      const type = event.target.value;
      const isDigit = type === "DIGITOVER" || type === "DIGITUNDER";

      if ($("barrierContainer")) {
        $("barrierContainer").style.display = isDigit ? "block" : "none";
      }

      show(
        "tradeMessage",
        "Trade execution is temporarily disabled while the market connection is tested."
      );
    });
  }

  if ($("riseBtn")) {
    $("riseBtn").addEventListener("click", () => {
      if ($("contractType")) $("contractType").value = "CALL";
      show("directionStatus", "RISE selected. Buying remains disabled during testing.");
    });
  }

  if ($("fallBtn")) {
    $("fallBtn").addEventListener("click", () => {
      if ($("contractType")) $("contractType").value = "PUT";
      show("directionStatus", "FALL selected. Buying remains disabled during testing.");
    });
  }

  // Safety: no order can be sent from this diagnostic version.
  if ($("buyBtn")) {
    $("buyBtn").disabled = true;
    $("buyBtn").addEventListener("click", 
                                 
      () => {
        setText(
          "tradeMessage",
          "Demo buying is temporarily disabled while market-data connection is tested."
        );
      }
    );
  }

  // Keep the interface in diagnostic mode.
  setText(
    "directionStatus",
    "Market-data diagnostic mode"
  );

  setText(
    "quoteStatus",
    "Quotes disabled during connection testing"
  );

  setText(
    "tradeMessage",
    "No orders can be sent from this diagnostic version."
  );
}

/* START APPLICATION */

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApp);
} else {
  startApp();
}


