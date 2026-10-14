
/* =========================================================
   TRADEDOLLARS — SCRIPT.JS
   Public market data + demo account status + analysis
   Real-money trading remains disabled.
   ========================================================= */

"use strict";

/* ---------------- CONFIGURATION ---------------- */

const APP_ID = "34qPaViEQZZw84Mc5thoO";

const PUBLIC_WS_URL =
  `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

const API_BASE = "";

const DEFAULT_SYMBOL = "1HZ100V";

const MAX_PRICE_POINTS = 100;
const MAX_DIGIT_HISTORY = 20;
const ANALYSIS_WINDOW = 50;

/* ---------------- APPLICATION STATE ---------------- */

const state = {
  config: null,
  account: null,
  authenticated: false,

  publicSocket: null,
  publicReconnectTimer: null,
  reconnectDelay: 2000,

  requestId: 0,
  activeSymbols: [],
  selectedSymbol: DEFAULT_SYMBOL,

  priceHistory: [],
  digitHistory: [],
  totalTicks: 0,

  lastPrice: null,
  lastDigit: null,
  pipSize: 2,

  socketReady: false,
  loadingAccount: false,
  loadingMarkets: false
};

/* ---------------- DOM HELPERS ---------------- */

function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const element = byId(id);
  if (element) element.textContent = String(value);
}

function setStatus(id, message, color) {
  const element = byId(id);
  if (!element) return;

  element.textContent = message;

  if (color) {
    element.style.color = color;
  }
}

function formatMoney(value, currency = "USD") {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return "--";
  }

  return `${currency} ${amount.toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[character];
  });
}

/* ---------------- CONFIGURATION ---------------- */

async function loadConfig() {
  try {
    const response = await fetch(`${API_BASE}/api/config`, {
      credentials: "same-origin",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Configuration request failed (${response.status})`);
    }

    state.config = await response.json();

    // This application must not enable real-money trading.
    if (byId("accountType")) {
      const realOption = byId("accountType").querySelector(
        'option[value="real"]'
      );

      if (realOption) realOption.disabled = true;

      byId("accountType").value = "demo";
    }

    setStatus(
      "connectionStatus",
      "Configuration loaded",
      "#22c55e"
    );

    return true;
  } catch (error) {
    console.error("Configuration error:", error);

    setStatus(
      "connectionStatus",
      "Configuration unavailable",
      "#ef4444"
    );

    return false;
  }
}

/* ---------------- LOGIN AND ACCOUNT ---------------- */

function updateLoginButtons() {
  const loginButton = byId("loginBtn");
  const logoutButton = byId("logoutBtn");

  if (loginButton) {
    loginButton.style.display = state.authenticated ? "none" : "";
  }

  if (logoutButton) {
    logoutButton.style.display = state.authenticated ? "" : "none";
  }
}

function renderAccount(account) {
  state.account = account || null;

  if (!account) {
    setText("accountId", "--");
    setText("balance", "--");
    setText("accountTypeMessage", "Connect a Deriv demo account.");
    setStatus("accountStatus", "Not connected", "#f59e0b");
    return;
  }

  setText("accountId", account.id || "--");

  setText(
    "balance",
    formatMoney(account.balance, account.currency || "USD")
  );

  setText(
    "accountTypeMessage",
    "Demo account selected. Real-money trading is disabled."
  );

  setStatus(
    "accountStatus",
    "Demo account connected",
    "#22c55e"
  );

  if (byId("accountType")) {
    byId("accountType").value = "demo";
  }
}

async function checkAccount() {
  if (state.loadingAccount) return;

  state.loadingAccount = true;

  setStatus(
    "accountStatus",
    "Checking demo account...",
    "#f59e0b"
  );

  try {
    const response = await fetch(`${API_BASE}/api/account`, {
      credentials: "same-origin",
      cache: "no-store"
    });

    const result = await response.json().catch(() => ({}));

    if (response.status === 401 || response.status === 403) {
      state.authenticated = false;
      renderAccount(null);
      updateLoginButtons();

      setStatus(
        "accountStatus",
        "Please log in with Deriv",
        "#f59e0b"
      );

      return;
    }

    if (!response.ok || !result.connected || !result.account) {
      throw new Error(
        result.error || result.message || "Demo account not available"
      );
    }

    state.authenticated = true;
    renderAccount(result.account);
    updateLoginButtons();

    // Refresh the session display after account selection.
    fetch(`${API_BASE}/api/session`, {
      credentials: "same-origin",
      cache: "no-store"
    }).catch(() => {});
  } catch (error) {
    console.error("Account check error:", error);

    setStatus(
      "accountStatus",
      "Unable to load account. Try refreshing.",
      "#ef4444"
    );
  } finally {
    state.loadingAccount = false;
  }
}

function loginWithDeriv() {
  window.location.href = `${API_BASE}/login`;
}

async function logoutFromDeriv() {
  try {
    await fetch(`${API_BASE}/logout`, {
      method: "POST",
      credentials: "same-origin"
    });
  } catch (error) {
    console.warn("Logout request:", error);
  }

  // Support servers where logout is exposed as a GET route.
  try {
    await fetch(`${API_BASE}/logout`, {
      method: "GET",
      credentials: "same-origin"
    });
  } catch (_) {}

  state.authenticated = false;
  state.account = null;

  renderAccount(null);
  updateLoginButtons();

  setStatus(
    "accountStatus",
    "Logged out",
    "#f59e0b"
  );

  checkAccount();
}

/* ---------------- PUBLIC MARKET SOCKET ---------------- */

function closePublicSocket() {
  if (state.publicReconnectTimer) {
    clearTimeout(state.publicReconnectTimer);
    state.publicReconnectTimer = null;
  }

  const socket = state.publicSocket;
  state.publicSocket = null;
  state.socketReady = false;

  if (socket) {
    try {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    } catch (_) {}
  }
}

function sendPublicMessage(message) {
  const socket = state.publicSocket;

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  socket.send(JSON.stringify({
    ...message,
    req_id: ++state.requestId
  }));

  return true;
}

function connectPublicSocket() {
  if (
    state.publicSocket &&
    (
      state.publicSocket.readyState === WebSocket.OPEN ||
      state.publicSocket.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  setStatus(
    "priceStatus",
    "Connecting to market data...",
    "#f59e0b"
  );

  let socket;

  try {
    socket = new WebSocket(PUBLIC_WS_URL);
  } catch (error) {
    console.error("WebSocket creation error:", error);
    schedulePublicReconnect();
    return;
  }

  state.publicSocket = socket;

  socket.onopen = () => {
    if (state.publicSocket !== socket) return;

    state.socketReady = true;
    state.reconnectDelay = 2000;

    setStatus(
      "priceStatus",
      "Market connection established",
      "#22c55e"
    );

    setStatus(
      "marketStatus",
      "Loading markets...",
      "#f59e0b"
    );

    sendPublicMessage({
      active_symbols: "brief",
      product_type: "basic"
    });

    subscribeToSelectedMarket();
  };

  socket.onmessage = event => {
    if (state.publicSocket !== socket) return;

    let message;

    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.warn("Invalid market message received.");
      return;
    }

    handlePublicMessage(message);
  };

  socket.onerror = error => {
    console.error("Public market socket error:", error);

    setStatus(
      "priceStatus",
      "Market connection error",
      "#ef4444"
    );
  };

  socket.onclose = () => {
    if (state.publicSocket !== socket) return;

    state.publicSocket = null;
    state.socketReady = false;

    setStatus(
      "priceStatus",
      "Market disconnected. Reconnecting...",
      "#f59e0b"
    );

    schedulePublicReconnect();
  };
}

function schedulePublicReconnect() {
  if (state.publicReconnectTimer) return;

  const delay = state.reconnectDelay;

  state.reconnectDelay = Math.min(
    state.reconnectDelay * 2,
    30000
  );

  state.publicReconnectTimer = setTimeout(() => {
    state.publicReconnectTimer = null;
    connectPublicSocket();
  }, delay);
}

function subscribeToSelectedMarket() {
  if (!state.socketReady) return;

  sendPublicMessage({
    forget_all: "ticks"
  });

  sendPublicMessage({
    ticks: state.selectedSymbol,
    subscribe: 1
  });

  setStatus(
    "priceStatus",
    `Waiting for ${state.selectedSymbol} ticks...`,
    "#f59e0b"
  );
}

function handlePublicMessage(message) {
  if (message.error) {
    console.error("Deriv market API error:", message.error);

    const errorMessage =
      message.error.message || "Market data request failed";

    setStatus("priceStatus", errorMessage, "#ef4444");

    if (message.echo_req?.active_symbols) {
      setStatus(
        "marketStatus",
        "Market list unavailable",
        "#ef4444"
      );
    }

    return;
  }

  if (Array.isArray(message.active_symbols)) {
    processActiveSymbols(message.active_symbols);
  }

  if (message.msg_type === "tick" && message.tick) {
    processTick(message.tick);
  }
}

/* ---------------- MARKET SELECTOR ---------------- */

function processActiveSymbols(symbols) {
  state.activeSymbols = symbols
    .filter(item => item && item.symbol && item.display_name)
    .sort((a, b) =>
      a.display_name.localeCompare(b.display_name)
    );

  const select = byId("marketSelect");

  if (!select) return;

  const previousValue = state.selectedSymbol;

  select.innerHTML = state.activeSymbols
    .map(item => {
      return `<option value="${escapeHtml(item.symbol)}">${
        escapeHtml(item.display_name)
      }</option>`;
    })
    .join("");

  const hasPrevious = state.activeSymbols.some(
    item => item.symbol === previousValue
  );

  const hasDefault = state.activeSymbols.some(
    item => item.symbol === DEFAULT_SYMBOL
  );

  if (hasPrevious) {
    state.selectedSymbol = previousValue;
  } else if (hasDefault) {
    state.selectedSymbol = DEFAULT_SYMBOL;
  } else if (state.activeSymbols.length > 0) {
    state.selectedSymbol = state.activeSymbols[0].symbol;
  }

  select.value = state.selectedSymbol;

  const market = state.activeSymbols.find(
    item => item.symbol === state.selectedSymbol
  );

  setText(
    "selectedMarket",
    market ? market.display_name : state.selectedSymbol
  );

  setStatus(
    "marketStatus",
    `${state.activeSymbols.length} markets loaded`,
    "#22c55e"
  );

  subscribeToSelectedMarket();
}

function handleMarketChange() {
  const select = byId("marketSelect");

  if (!select || !select.value) return;

  state.selectedSymbol = select.value;

  state.priceHistory = [];
  state.digitHistory = [];
  state.totalTicks = 0;
  state.lastPrice = null;
  state.lastDigit = null;

  const market = state.activeSymbols.find(
    item => item.symbol === state.selectedSymbol
  );

  setText(
    "selectedMarket",
    market ? market.display_name : state.selectedSymbol
  );

  setText("livePrice", "--");
  setText("liveDigit", "--");

  renderDigitHistory();
  renderChart();
  renderMarketAnalysis();
  renderDigitAnalysis();

  subscribeToSelectedMarket();
}

/* ---------------- TICK PROCESSING ---------------- */

function getLastDigit(price, pipSize) {
  const decimals = Number.isInteger(Number(pipSize))
    ? Math.max(0, Math.min(10, Number(pipSize)))
    : 2;

  const formatted = Number(price).toFixed(decimals);
  const digits = formatted.replace(/\D/g, "");

  return digits.length
    ? Number(digits[digits.length - 1])
    : null;
}

function processTick(tick) {
  if (tick.symbol && tick.symbol !== state.selectedSymbol) {
    return;
  }

  const price = Number(tick.quote);

  if (!Number.isFinite(price)) return;

  state.pipSize = Number.isInteger(Number(tick.pip_size))
    ? Number(tick.pip_size)
    : state.pipSize;

  state.lastPrice = price;
  state.lastDigit = getLastDigit(price, state.pipSize);
  state.totalTicks += 1;

  state.priceHistory.push(price);

  if (state.priceHistory.length > MAX_PRICE_POINTS) {
    state.priceHistory.shift();
  }

  if (state.lastDigit !== null) {
    state.digitHistory.push(state.lastDigit);

    if (state.digitHistory.length > ANALYSIS_WINDOW) {
      state.digitHistory.shift();
    }
  }

  const formattedPrice = price.toFixed(state.pipSize);

  setText("livePrice", formattedPrice);
  setText("liveDigit", state.lastDigit ?? "--");

  setStatus(
    "priceStatus",
    `Live • ${state.totalTicks} ticks collected`,
    "#22c55e"
  );

  renderDigitHistory();
  renderChart();
  renderMarketAnalysis();
  renderDigitAnalysis();
}

/* ---------------- DIGIT HISTORY ---------------- */

function renderDigitHistory() {
  const container = byId("liveDigitHistory");

  if (!container) return;

  const digits = state.digitHistory.slice(-MAX_DIGIT_HISTORY);

  container.innerHTML = digits.map((digit, index) => {
    const isLatest = index === digits.length - 1;

    return `
      <span style="
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-width:28px;
        height:30px;
        margin:3px;
        border-radius:6px;
        background:${isLatest ? "#2563eb" : "#1e293b"};
        color:#ffffff;
        font-weight:700;
      ">${digit}</span>
    `;
  }).join("");
}

/* ---------------- CHART ---------------- */

function renderChart() {
  const canvas = byId("chart");

  if (!canvas) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  const width = canvas.clientWidth || 600;
  const height = 240;
  const pixelRatio = window.devicePixelRatio || 1;

  canvas.width = Math.floor(width * pixelRatio);
  canvas.height = Math.floor(height * pixelRatio);
  canvas.style.height = `${height}px`;

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  context.fillStyle = "#0f172a";
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "#263449";
  context.lineWidth = 1;

  for (let row = 1; row < 5; row++) {
    const y = (height / 5) * row;

    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  const prices = state.priceHistory;

  if (prices.length < 2) {
    context.fillStyle = "#94a3b8";
    context.font = "14px Arial";
    context.textAlign = "center";
    context.fillText(
      "Waiting for market prices...",
      width / 2,
      height / 2
    );
    return;
  }

  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  const range = maximum - minimum || 1;
  const padding = 12;

  context.beginPath();

  prices.forEach((price, index) => {
    const x = padding +
      (index / (prices.length - 1)) * (width - padding * 2);

    const y = height - padding -
      ((price - minimum) / range) * (height - padding * 2);

    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });

  context.strokeStyle =
    prices[prices.length - 1] >= prices[0]
      ? "#22c55e"
      : "#f87171";

  context.lineWidth = 2;
  context.stroke();
}

/* ---------------- RISE/FALL ANALYSIS ---------------- */

function average(values) {
  if (!values.length) return 0;

  return values.reduce((sum, value) => sum + value, 0) /
    values.length;
}

function renderMarketAnalysis() {
  const prices = state.priceHistory;

  if (prices.length < 20) {
    setText("analysisTrend", "COLLECTING DATA");
    setText("analysisMomentum", "Not enough data");
    setText("analysisSupport", "--");
    setText("analysisResistance", "--");
    setText("analysisConfidence", "LOW");
    setText("analysisSignal", "WAIT");

    setText(
      "analysisReason",
      `Collecting ticks: ${prices.length}/20. No trade signal yet.`
    );

    return;
  }

  const shortRecent = prices.slice(-5);
  const shortPrevious = prices.slice(-10, -5);
  const mediumRecent = prices.slice(-10);
  const mediumPrevious = prices.slice(-20, -10);

  const shortChange =
    average(shortRecent) - average(shortPrevious);

  const mediumChange =
    average(mediumRecent) - average(mediumPrevious);

  const support = Math.min(...prices.slice(-20));
  const resistance = Math.max(...prices.slice(-20));
  const latest = prices[prices.length - 1];

  let trend = "SIDEWAYS";

  if (shortChange > 0 && mediumChange > 0) {
    trend = "BULLISH";
  } else if (shortChange < 0 && mediumChange < 0) {
    trend = "BEARISH";
  }

  const momentum = Math.abs(shortChange);

  const nearResistance =
    latest >= resistance - (resistance - support) * 0.15;

  const nearSupport =
    latest <= support + (resistance - support) * 0.15;

  let signal = "WAIT";
  let confidence = "LOW";
  let reason =
    "Waiting for clearer momentum and confirmation.";

  if (
    trend === "BULLISH" &&
    !nearResistance &&
    shortChange > 0
  ) {
    signal = "RISE WATCH";
    confidence = mediumChange > 0 ? "MEDIUM" : "LOW";
    reason =
      "Recent movement is upward. This is a watch condition, not a prediction.";
  } else if (
    trend === "BEARISH" &&
    !nearSupport &&
    shortChange < 0
  ) {
    signal = "FALL WATCH";
    confidence = mediumChange < 0 ? "MEDIUM" : "LOW";
    reason =
      "Recent movement is downward. This is a watch condition, not a prediction.";
  }

  if (nearResistance && trend === "BULLISH") {
    signal = "WAIT";
    reason =
      "Price is near recent resistance. Wait for confirmation.";
  }

  if (nearSupport && trend === "BEARISH") {
    signal = "WAIT";
    reason =
      "Price is near recent support. Wait for confirmation.";
  }

  setText("analysisTrend", trend);

  setText(
    "analysisMomentum",
    momentum.toFixed(state.pipSize)
  );

  setText(
    "analysisSupport",
    support.toFixed(state.pipSize)
  );

  setText(
    "analysisResistance",
    resistance.toFixed(state.pipSize)
  );

  setText("analysisConfidence", confidence);
  setText("analysisSignal", signal);
  setText("analysisReason", reason);
}

/* ---------------- DIGIT ANALYSIS ---------------- */

function renderDigitAnalysis() {
  const digits = state.digitHistory;
  const sampleSize = digits.length;

  setText("digitsSample", sampleSize);

  if (sampleSize === 0) {
    setText("mostFrequentDigit", "--");
    setText("leastFrequentDigit", "--");
    setText("evenPercentage", "0%");
    setText("oddPercentage", "0%");
    setText("overFivePercentage", "0%");
    setText("underFivePercentage", "0%");
    setText("repeatedDigit", "No");
    setText("digitBias", "COLLECTING");
    setText("digitConfidence", "LOW");

    setText(
      "digitAnalysisMessage",
      "Waiting for digit data. Frequencies describe the sample only."
    );

    return;
  }

  const counts = Array(10).fill(0);

  digits.forEach(digit => {
    counts[digit] += 1;
  });

  let mostDigit = 0;
  let leastDigit = 0;

  for (let digit = 1; digit < 10; digit++) {
    if (counts[digit] > counts[mostDigit]) {
      mostDigit = digit;
    }

    if (counts[digit] < counts[leastDigit]) {
      leastDigit = digit;
    }
  }

  const evenCount = digits.filter(digit => digit % 2 === 0).length;
  const oddCount = sampleSize - evenCount;

  const overFive = digits.filter(digit => digit > 5).length;
  const underFive = digits.filter(digit => digit < 5).length;

  const percentage = count =>
    `${((count / sampleSize) * 100).toFixed(1)}%
      `;

  setText("mostFrequentDigit", mostDigit);
  setText("leastFrequentDigit", leastDigit);
  setText("evenPercentage", percentage(evenCount));
  setText("oddPercentage", percentage(oddCount));
  setText("overFivePercentage", percentage(overFive));
  setText("underFivePercentage", percentage(underFive));

  const lastTwo = digits.slice(-2);

  setText(
    "repeatedDigit",
    lastTwo.length === 2 && lastTwo[0] === lastTwo[1]
      ? "Yes"
      : "No"
  );

  const difference = Math.abs(evenCount - oddCount);

  let bias = "NO CLEAR BIAS";
  let confidence = "LOW";

  if (sampleSize >= 20 && difference / sampleSize >= 0.15) {
    bias = evenCount > oddCount
      ? "EVEN FREQUENCY"
      : "ODD FREQUENCY";

    confidence = "OBSERVED";
  }

  setText("digitBias", bias);
  setText("digitConfidence", confidence);

  setText(
    "digitAnalysisMessage",
    "Historical frequencies describe this sample only; they do not predict the next digit."
  );
}

/* ---------------- SAFE TRADE CONTROLS ---------------- */

function configureSafeTradingControls() {
  const buyButton = byId("buyBtn");

  if (buyButton) {
    buyButton.disabled = true;
    buyButton.textContent = "DEMO BUY UNAVAILABLE";
  }

  setStatus(
    "quoteStatus",
    "Trade quotes not connected",
    "#f59e0b"
  );

  setStatus(
    "tradeMessage",
    "Demo order placement remains disabled until quote and purchase handling are verified.",
    "#f59e0b"
  );

  const contractType = byId("contractType");
  const barrierContainer = byId("barrierContainer");

  function updateBarrierVisibility() {
    if (!contractType || !barrierContainer) return;

    barrierContainer.hidden = ![
      "DIGITOVER",
      "DIGITUNDER"
    ].includes(contractType.value);
  }

  if (contractType) {
    contractType.addEventListener(
      "change",
      updateBarrierVisibility
    );
  }

  updateBarrierVisibility();

  const riseButton = byId("riseBtn");
  const fallButton = byId("fallBtn");

  if (riseButton) {
    riseButton.addEventListener("click", () => {
      setStatus(
        "directionStatus",
        "RISE selected for analysis. No trade placed.",
        "#94a3b8"
      );
    });
  }

  if (fallButton) {
    fallButton.addEventListener("click", () => {
      setStatus(
        "directionStatus",
        "FALL selected for analysis. No trade placed.",
        "#94a3b8"
      );
    });
  }

  const depositButton = byId("depositBtn");

  if (depositButton) {
    depositButton.addEventListener("click", () => {
      window.open(
        "https://app.deriv.com/",
        "_blank",
        "noopener,noreferrer"
      );
    });
  }
}

/* ---------------- EVENT HANDLERS ---------------- */

function bindEvents() {
  const loginButton = byId("loginBtn");
  const logoutButton = byId("logoutBtn");
  const marketSelect = byId("marketSelect");

  if (loginButton) {
    loginButton.addEventListener("click", loginWithDeriv);
  }

  if (logoutButton) {
    logoutButton.addEventListener("click", logoutFromDeriv);
  }

  if (marketSelect) {
    marketSelect.addEventListener("change", handleMarketChange);
  }

  window.addEventListener("resize", renderChart);
}

/* ---------------- APPLICATION START ---------------- */

async function startApp() {
  bindEvents();
  configureSafeTradingControls();

  setStatus(
    "connectionStatus",
    "Starting Tradedollars...",
    "#f59e0b"
  );

  await loadConfig();
  await checkAccount();

  connectPublicSocket();

  setStatus(
    "connectionStatus",
    "Application running",
    "#22c55e"
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApp, {
    once: true
  });
} else {
  startApp();
     }
        
