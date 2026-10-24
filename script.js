
/* =========================================================
   TRADEDOLLARS — SCRIPT.JS
   Live market data + digit analysis + demo quote preview
   REAL-MONEY TRADING: DISABLED
   ORDER PLACEMENT: DISABLED
   ========================================================= */

"use strict";

/* ---------------- CONFIGURATION ---------------- */

const PUBLIC_WS_URL =
  "wss://api.derivws.com/trading/v1/options/ws/public";

const DEFAULT_SYMBOL = "1HZ100V";
const DEFAULT_MARKET_NAME = "Volatility 100 (1s) Index";

const MAX_DIGIT_HISTORY = 2000;
const MAX_PRICE_HISTORY = 100;
const MAX_OBSERVATIONS = 100;
const QUOTE_MAX_AGE = 30000;

const state = {
  socket: null,
  tradingSocket: null,

  connected: false,
  subscribed: false,
  tradingConnected: false,
  tradingConnecting: false,

  reconnectTimer: null,
  responseTimer: null,
  requestId: 0,
  tradeRequestId: 0,

  pendingProposalReqId: null,
  pendingProposalDetails: null,
  latestProposal: null,

  activeTradingMode: "demo",
  monitoring: true,

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
    return false;
  }

  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch (error) {
    console.error("WebSocket send failed:", error);
    return false;
  }
}

function clearQuote(message) {
  state.latestProposal = null;
  state.pendingProposalReqId = null;
  state.pendingProposalDetails = null;

  setText("quoteStake", "--");
  setText("quotePayout", "--");

  const button = $("confirmBuy");

  if (button) {
    button.disabled = true;
    button.textContent = "ORDER PLACEMENT DISABLED";
  }

  if (message) {
    setStatus("quoteStatus", message, "#f59e0b");
  }
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
    console.error("Could not create public WebSocket:", error);
    scheduleReconnect();
    return;
  }

  state.responseTimer = setTimeout(() => {
    if (
      state.socket === socket &&
      state.activeSymbols.length === 0
    ) {
      setStatus(
        "marketStatus",
        "No market list received yet. Check connection and console.",
        "#ef4444"
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
      console.error("Invalid public WebSocket response:", error);
      return;
    }

    if (message.error) {
      const errorText =
        message.error.message ||
        message.error.code ||
        "Unknown market-data error";

      console.error("Public market API error:", message.error);

      setStatus(
        "marketStatus",
        "Market API error: " + errorText,
        "#ef4444"
      );

      setStatus(
        "priceStatus",
        "Market data unavailable. See console for details.",
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
    }
  });

  socket.addEventListener("error", error => {
    console.error("Public market WebSocket error:", error);

    setStatus(
      "marketStatus",
      "Market connection error. Reconnecting...",
      "#ef4444"
    );
  });

  socket.addEventListener("close", event => {
    if (state.socket !== socket) return;

    state.connected = false;
    state.subscribed = false;
    state.socket = null;

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
    if (!state.connected) connectPublicSocket();
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

  setText("marketCount", state.activeSymbols.length);

  if (!state.activeSymbols.length) {
    setStatus(
      "marketStatus",
      "Connected, but no markets were returned.",
      "#ef4444"
    );

    setStatus(
      "priceStatus",
      "No markets available to subscribe to.",
      "#ef4444"
    );

    return;
  }

  const marketSelect = $("marketSelect");

  if (marketSelect) {
    const previousSymbol = state.symbol;

    marketSelect.innerHTML = "";

    state.activeSymbols.forEach(market => {
      const option = document.createElement("option");
      option.value = market.symbol;
      option.textContent = market.name;
      marketSelect.appendChild(option);
    });

    const chosenMarket =
      state.activeSymbols.find(
        market => market.symbol === previousSymbol
      ) || state.activeSymbols[0];

    marketSelect.value = chosenMarket.symbol;
    state.symbol = chosenMarket.symbol;
    state.marketName = chosenMarket.name;
  } else {
    const chosenMarket =
      state.activeSymbols.find(
        market => market.symbol === state.symbol
      ) || state.activeSymbols[0];

    state.symbol = chosenMarket.symbol;
    state.marketName = chosenMarket.name;
  }

  updateSelectedMarket();

  setStatus(
    "marketStatus",
    `${state.activeSymbols.length} markets loaded`,
    "#22c55e"
  );

  subscribeToTicks();
}

function updateSelectedMarket() {
  setText("selectedMarket", state.marketName);
  setText("marketName", state.marketName);
}

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

  if (!market) return;

  state.symbol = market.symbol;
  state.marketName = market.name;

  state.ticks = 0;
  state.latestPrice = null;
  state.latestDigit = null;
  state.digitHistory = [];
  state.priceHistory = [];

  clearQuote("Market changed. Request a fresh demo quote if needed.");

  updateSelectedMarket();
  renderDigitHistory();
  renderDigitAnalysis();
  renderChart();
  updateSignal();

  setText("tickCount", "0");
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

/* ---------------- LIVE TICKS ---------------- */

function processTick(tick) {
  if (!tick || tick.quote === undefined) return;

  const price = Number(tick.quote);

  if (!Number.isFinite(price)) return;

  const pipSize = Number.isInteger(Number(tick.pip_size))
    ? Math.max(0, Math.min(10, Number(tick.pip_size)))
    : 2;

  const formattedPrice = price.toFixed(pipSize);
  const digit = Number(formattedPrice.slice(-1));

  if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
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
  const container = $("digitHistory") || $("recentDigits");

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

  if (!sampleSize) {
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
    counts[digit] += 1;

    if (digit % 2 === 0) evenCount += 1;
    else oddCount += 1;

    if (digit > 5) overFiveCount += 1;
    else if (digit < 5) underFiveCount += 1;
    else equalFiveCount += 1;
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
    `Based on ${sampleSize} observed ticks. Digit 5 occurred ${equalFiveCount} times and is excluded from both Over 5 and Under 5. Frequencies describe past data and do not predict the next digit.`,
    "#94a3b8"
  );
}

/* ---------------- SIGNAL-ONLY MONITOR ---------------- */

function updateSignal() {
  setText("signal", "OBSERVE");
  setText("signalValue", "OBSERVE");

  setText(
    "signalReason",
    state.digitHistory.length < 50
      ? `Collecting data: ${state.digitHistory.length}/50 ticks. No order will be placed.`
      : "Observation only. Past digit frequencies do not reliably predict the next outcome. No order will be placed."
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
    buyButton.textContent = "ORDER PLACEMENT DISABLED";
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

    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
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
    note: String(note || "Observation")
  };

  state.observations.unshift(observation);

  if (state.observations.length > MAX_OBSERVATIONS) {
    state.observations.length = MAX_OBSERVATIONS;
  }

  renderObservations();
}

function renderObservations() {
  const container = $("observationHistory");
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

/* ---------------- DEMO CONNECTION FOR QUOTES ONLY ---------------- */

async function connectTradingSocket() {
  if (
    state.tradingConnecting ||
    (
      state.tradingSocket &&
      (
        state.tradingSocket.readyState === WebSocket.OPEN ||
        state.tradingSocket.readyState === WebSocket.CONNECTING
      )
    )
  ) {
    return;
  }

  if (state.activeTradingMode !== "demo") return;

  state.tradingConnecting = true;

  try {
    const response = await fetch("/api/trading-connection", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" }
    });

    const data = await response.json();

    if (
      !response.ok ||
      !data.connected ||
      data.account_type !== "demo" ||
      data.real_trading_enabled !== false
    ) {
      throw new Error(
        data.error || "A verified demo connection was not returned."
      );
    }

    const url = new URL(data.ws_url);

    if (
      url.protocol !== "wss:" ||
      url.hostname !== "api.derivws.com" ||
      url.pathname !== "/trading/v1/options/ws/demo" ||
      !url.searchParams.has("otp")
    ) {
      throw new Error("The demo WebSocket URL failed validation.");
    }

    const socket = new WebSocket(data.ws_url);
    state.tradingSocket = socket;

    socket.addEventListener("open", () => {
      if (state.tradingSocket !== socket) return;

      state.tradingConnected = true;
      state.tradingConnecting = false;

      setStatus(
        "quoteStatus",
        "Demo quote connection ready. Purchases remain disabled.",
        "#22c55e"
      );
    });

    socket.addEventListener("message", event => {
      if (state.tradingSocket !== socket) return;

      let message;

      try {
        message = JSON.parse(event.data);
      } catch (error) {
        console.error("Invalid demo response:", error);
        return;
      }

      if (message.error) {
        const errorText =
          message.error.message ||
          message.error.code ||
          "Unknown demo API error";

        if (message.req_id === state.pendingProposalReqId) {
          state.pendingProposalReqId = null;
          state.pendingProposalDetails = null;
          state.latestProposal = null;

          setStatus(
            "quoteStatus",
            "Quote failed: " + errorText,
            "#ef4444"
          );

          setText("quoteStake", "--");
          setText("quotePayout", "--");
        } else {
          console.warn("Demo API response error:", message.error);
        }

        return;
      }

      if (
        message.msg_type !== "proposal" ||
        !message.proposal ||
        message.req_id !== state.pendingProposalReqId
      ) {
        return;
      }

            const proposal = message.proposal;
      const askPrice = Number(proposal.ask_price);
      const payout = Number(proposal.payout);
      const details = state.pendingProposalDetails;

      state.pendingProposalReqId = null;
      state.pendingProposalDetails = null;

      if (
        !proposal.id ||
        !Number.isFinite(askPrice) ||
        askPrice <= 0 ||
        !Number.isFinite(payout)
      ) {
        state.latestProposal = null;

        setStatus(
          "quoteStatus",
          "Quote response incomplete. Request a new quote.",
          "#ef4444"
        );

        return;
      }

      state.latestProposal = {
        id: proposal.id,
        askPrice,
        payout,
        receivedAt: Date.now(),
        symbol: details ? details.symbol : state.symbol,
        amount: details ? details.amount : null,
        contractType: details ? details.contractType : null,
        duration: details ? details.duration : null,
        barrier: details ? details.barrier : null,
        currency: proposal.currency || "USD"
      };

      setText("quoteStake", askPrice.toFixed(2));
      setText("quotePayout", payout.toFixed(2));

      setStatus(
        "quoteStatus",
        "Demo quote received. This is a quote only; no purchase was made.",
        "#22c55e"
      );

      setText(
        "quoteDetails",
        proposal.longcode ||
          "Quote received. Order placement is disabled."
      );

      updateSignal();
    });

    socket.addEventListener("error", error => {
      if (state.tradingSocket !== socket) return;

      console.error("Demo quote socket error:", error);

      state.tradingConnected = false;

      setStatus(
        "quoteStatus",
        "Demo quote connection failed. Check Render logs.",
        "#ef4444"
      );
    });

    socket.addEventListener("close", () => {
      if (state.tradingSocket !== socket) return;

      state.tradingSocket = null;
      state.tradingConnected = false;
      state.tradingConnecting = false;

      clearQuote(
        "Demo quote connection closed. Recheck the demo account."
      );
    });
  } catch (error) {
    state.tradingConnected = false;
    state.tradingSocket = null;

    setStatus(
      "quoteStatus",
      error.message || "Demo quote connection unavailable.",
      "#ef4444"
    );

    console.warn(
      "Demo quote connection unavailable:",
      error.message
    );
  } finally {
    state.tradingConnecting = false;
  }
}
/* ---------------- DEMO QUOTE REQUEST ---------------- */

function requestDemoQuote() {
  if (state.activeTradingMode !== "demo") {
    setStatus(
      "quoteStatus",
      "Quotes are available only in Demo Account mode.",
      "#ef4444"
    );
    return;
  }

  const socket = state.tradingSocket;

  if (
    !state.tradingConnected ||
    !socket ||
    socket.readyState !== WebSocket.OPEN
  ) {
    setStatus(
      "quoteStatus",
      "Demo quote connection is not ready. Refresh the demo account first.",
      "#ef4444"
    );
    return;
  }

  const amountElement = $("tradeAmount");
  const typeElement = $("tradeContractType");
  const barrierElement = $("tradeBarrier");
  const durationElement = $("tradeDuration");

  if (!amountElement || !typeElement || !durationElement) {
    setStatus(
      "quoteStatus",
      "Quote controls are missing. Check index.html.",
      "#ef4444"
    );
    return;
  }

  const amount = Number(amountElement.value);
  const contractType = typeElement.value;
  const duration = Number(durationElement.value);

  if (![1, 2, 5].includes(amount)) {
    setStatus(
      "quoteStatus",
      "Choose a valid stake.",
      "#ef4444"
           );
    return;
  }

  if (![1, 2, 5, 10].includes(duration)) {
    setStatus(
      "quoteStatus",
      "Choose a valid duration.",
      "#ef4444"
    );
    return;
  }

  const allowedTypes = [
    "DIGITOVER",
    "DIGITUNDER",
    "DIGITEVEN",
    "DIGITODD"
  ];

  if (!allowedTypes.includes(contractType)) {
    setStatus(
      "quoteStatus",
      "Choose a supported digit contract type.",
      "#ef4444"
    );
    return;
  }

  const payload = {
    proposal: 1,
    amount,
    basis: "stake",
    contract_type: contractType,
    currency: "USD",
    duration,
    duration_unit: "t",
    underlying_symbol: state.symbol,
    req_id: ++state.tradeRequestId
  };

  let barrier = null;

  if (
    contractType === "DIGITOVER" ||
    contractType === "DIGITUNDER"
  ) {
    if (!barrierElement) {
      setStatus(
        "quoteStatus",
        "The barrier selector is missing.",
        "#ef4444"
      );
      return;
    }

    barrier = Number(barrierElement.value);

    if (
      !Number.isInteger(barrier) ||
      barrier < 0 ||
      barrier > 9 ||
      (contractType === "DIGITOVER" && barrier > 8) ||
      (contractType === "DIGITUNDER" && barrier < 1)
    ) {
      setStatus(
        "quoteStatus",
        "Choose a valid barrier for this contract.",
        "#ef4444"
      );
      return;
    }

    payload.barrier = String(barrier);
  }

  state.latestProposal = null;
  state.pendingProposalReqId = payload.req_id;

  state.pendingProposalDetails = {
    symbol: state.symbol,
    amount,
    contractType,
    duration,
    barrier
  };

  setText("quoteStake", "--");
  setText("quotePayout", "--");

  setStatus(
    "quoteStatus",
    "Requesting a demo quote...",
    "#f59e0b"
  );

  setText(
    "quoteDetails",
    "Waiting for Deriv. No purchase will be made."
  );

  if (!sendJson(socket, payload)) {
    state.pendingProposalReqId = null;
    state.pendingProposalDetails = null;

    setStatus(
      "quoteStatus",
      "Could not send quote request. Check the connection.",
      "#ef4444"
    );
  }
}

/* ---------------- ACCOUNT STATUS ---------------- */

async function refreshAccount() {
  const accountMode = $("accountMode");
  const mode = accountMode ? accountMode.value : "demo";

  if (mode !== "demo") {
    if (accountMode) accountMode.value = "demo";

    state.activeTradingMode = "demo";

    clearQuote("Real-money trading is disabled.");

    setStatus(
      "accountStatus",
      "Demo account only",
      "#f59e0b"
    );

    setText("accountId", "--");
    setText("accountBalance", "--");
    setText("tradingMode", "Demo only");

    setStatus(
      "accountMessage",
      "Real-money trading and order placement remain disabled.",
      "#f59e0b"
    );

    return;
  }

  state.activeTradingMode = "demo";

  setStatus(
    "accountStatus",
    "Checking demo account...",
    "#f59e0b"
  );

  setStatus(
    "accountMessage",
    "Checking your Deriv demo account. No trade will be placed.",
    "#f59e0b"
  );
       try {
    const response = await fetch(
      "/api/account?mode=demo",
      {
        method: "GET",
        credentials: "same-origin",
        headers: {
          Accept: "application/json"
        }
      }
    );

    const data = await response.json();

    if (!response.ok || !data || data.error) {
      throw new Error(
        data?.error ||
        `Account check failed (${response.status}).`
      );
    }

    const account = data.account || data;

    const accountId =
      account.account_id ||
      account.id ||
      account.loginid ||
      account.accountId;

    const balance = Number(
      account.balance ??
      account.available_balance
    );

    if (!accountId) {
      throw new Error(
        "The server did not return a demo account ID. Log in with Deriv again."
      );
    }

    setText("accountId", accountId);

    setText(
      "accountBalance",
      Number.isFinite(balance)
        ? `${balance.toFixed(2)} ${account.currency || "USD"}`
        : "--"
    );

    setText("tradingMode", "Demo only");

    setStatus(
      "accountStatus",
      "Demo account connected",
      "#22c55e"
    );

    setStatus(
      "accountMessage",
      "Demo account checked. Order placement remains disabled.",
      "#22c55e"
    );

    await connectTradingSocket();
  } catch (error) {
    console.error("Demo account check failed:", error);

    setText("accountId", "--");
    setText("accountBalance", "--");
    setText("tradingMode", "Demo only");
          setStatus(
      "accountStatus",
      "Demo account not connected",
      "#ef4444"
    );

    setStatus(
      "accountMessage",
      error.message ||
        "Unable to verify the demo account. Log in with Deriv and try again.",
      "#ef4444"
    );

    clearQuote(
      "Connect your demo account to request a quote."
    );
  }
}
/* ---------------- LOGIN BUTTON ---------------- */

function loginWithDeriv() {
  window.location.href = "/login";
}

/* ---------------- EXTERNAL DERIV LINKS ---------------- */

function openDerivPage(path) {
  const allowedPaths = {
    home: "https://deriv.com/",
    deposit: "https://app.deriv.com/cashier/deposit",
    withdraw: "https://app.deriv.com/cashier/withdraw"
  };

  const url = allowedPaths[path];

  if (!url) {
    console.warn("Unknown Deriv destination.");
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

/* ---------------- EVENT LISTENERS ---------------- */

function setupEventListeners() {
  const loginButton = $("loginButton");
  const refreshButton = $("refreshAccount");
  const accountMode = $("accountMode");
  const requestQuoteButton = $("requestQuote");
  const marketSelect = $("marketSelect");
  const startButton = $("startMonitor");
  const stopButton = $("stopMonitor");
  const recordButton = $("recordObservation");
  const testButton = $("testStrategy");
  const confirmBuyButton = $("confirmBuy");

  if (loginButton) {
    loginButton.addEventListener("click", loginWithDeriv);
  }

  if (refreshButton) {
    refreshButton.addEventListener("click", refreshAccount);
  }

  if (accountMode) {
    accountMode.addEventListener("change", () => {
      if (accountMode.value !== "demo") {
        accountMode.value = "demo";
      }

      refreshAccount();
    });
  }

  if (requestQuoteButton) {
    requestQuoteButton.addEventListener(
      "click",
      requestDemoQuote
    );
  }

  if (marketSelect) {
    marketSelect.addEventListener("change", () => {
      const symbol = marketSelect.value;

      if (!symbol) return;

      state.symbol = symbol;
      state.ticks = [];
      state.prices = [];

      setText(
        "selectedMarket",
        marketSelect.options[
          marketSelect.selectedIndex
        ]?.textContent || symbol
      );

      renderDigitHistory();
      renderChart();
      updateAnalysis();
      updateSignal();
      connectPublicSocket();
    });
  }

  if (startButton) {
    startButton.addEventListener("click", () => {
      state.monitoring = true;

      setStatus(
        "botStatus",
               "Monitoring live data — no trades will be placed.",
        "#22c55e"
      );

      updateSignal();
    });
  }

  if (stopButton) {
    stopButton.addEventListener("click", () => {
      state.monitoring = false;

      setStatus(
        "botStatus",
        "Monitoring paused. No trades were placed.",
        "#f59e0b"
      );

      updateSignal();
    });
  }

  if (recordButton) {
    recordButton.addEventListener(
      "click",
      recordObservation
    );
  }

  if (testButton) {
    testButton.addEventListener("click", () => {
      updateAnalysis();
      updateSignal();

      setStatus(
        "analysisStatus",
        `Analysis uses ${state.ticks.length} observed ticks. Historical frequencies are descriptive, not predictions.`,
        "#60a5fa"
      );
    });
  }

  if (confirmBuyButton) {
    confirmBuyButton.disabled = true;
    confirmBuyButton.textContent =
      "Order placement disabled";

    confirmBuyButton.addEventListener("click", event => {
      event.preventDefault();

      setStatus(
        "quoteStatus",
        "Order placement is disabled. Quotes and analysis only.",
        "#f59e0b"
      );
    });
  }

  const depositButton = $("depositButton");
  const withdrawButton = $("withdrawButton");
  const openDerivButton = $("openDeriv");

  if (depositButton) {
    depositButton.addEventListener("click", () => {
      openDerivPage("deposit");
    });
  }

  if (withdrawButton) {
    withdrawButton.addEventListener("click", () => {
      openDerivPage("withdraw");
    });
  }

  if (openDerivButton) {
    openDerivButton.addEventListener("click", () => {
      openDerivPage("home");
    });
  }
}

/* ---------------- INITIALISE APPLICATION ---------------- */

function initialise() {
  setText("appStatus", "Starting application...");
  setText("tradingMode", "Demo only");

  setStatus(
    "marketStatus",
    "Connecting to live market data...",
    "#f59e0b"
  );

   setStatus(
    "priceStatus",
    "Waiting for market ticks...",
    "#f59e0b"
  );

  setStatus(
    "quoteStatus",
    "Demo quote connection not checked yet.",
    "#94a3b8"
  );

  setStatus(
    "botStatus",
    "Monitoring stopped. No trades will be placed.",
    "#94a3b8"
  );

  setupEventListeners();
  connectPublicSocket();
  refreshAccount();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initialise,
    { once: true }
  );
} else {
  initialise();
}
       
