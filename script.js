
/* =========================================================
   TRADEDOLLARS — TRADING INTERFACE
   Continuous ticks, live chart, digits analysis, proposals
   ========================================================= */

"use strict";

const PUBLIC_WS_BASE =
  "wss://api.derivws.com/trading/v1/options/ws/public";

const state = {
  config: null,
  loggedIn: false,
  account: null,

  publicSocket: null,
  tradingSocket: null,

  publicReady: false,
  tradingReady: false,

  markets: [],
  selectedSymbol: "",
  selectedMarketName: "",

  livePrice: null,
  totalTicks: 0,

  priceHistory: [],
  digitHistory: [],

  direction: "RISE",
  contractType: "CALL",
  barrier: 5,
  amount: 1,
  duration: 5,
  durationUnit: "t",

  proposal: null,
  proposalId: null,
  askPrice: 0,
  payout: 0,
  quoteExpiresAt: 0,

  requestId: 1000,
  pendingProposalReqId: null,
  pendingBuyReqId: null,
  buying: false,

  activeContracts: new Map(),
  finishedContracts: new Map(),

  performance: {
    wins: 0,
    losses: 0,
    profit: 0
  },

  quoteTimer: null,
  reconnectTimer: null
};

const ui = {};

function el(id) {
  return document.getElementById(id);
}

function cacheUI() {
  [
    "connectionStatus",
    "accountStatus",
    "accountId",
    "balance",
    "accountType",
    "accountTypeMessage",
    "loginBtn",
    "logoutBtn",
    "marketSelect",
    "marketName",
    "marketCount",
    "livePrice",
    "liveDigit",
    "liveDigitHistory",
    "liveChart",
    "priceMessage",
    "amount",
    "duration",
    "contractType",
    "barrier",
    "barrierContainer",
    "riseBtn",
    "fallBtn",
    "quoteStatus",
    "askPrice",
    "payout",
    "buyBtn",
    "tradeMessage",
    "openContracts",
    "tradeHistory",
    "wins",
    "losses",
    "totalProfit"
  ].forEach(id => {
    ui[id] = el(id);
  });

  // Your HTML uses these IDs.
  ui.liveChart = el("chart") || el("liveChart");
  ui.marketName = el("selectedMarket");
  ui.priceMessage = el("priceStatus");
}

function setText(element, value) {
  if (element) {
    element.textContent =
      value === null || value === undefined
        ? "--"
        : String(value);
  }
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "--";
}

function nextId() {
  return ++state.requestId;
}

function send(socket, payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch (error) {
    console.error("WebSocket send error:", error);
    return false;
  }
}

function showMessage(message) {
  setText(ui.tradeMessage, message);
}

function invalidateQuote(message = "Requesting a fresh quote...") {
  clearTimeout(state.quoteTimer);

  state.proposal = null;
  state.proposalId = null;
  state.askPrice = 0;
  state.payout = 0;
  state.quoteExpiresAt = 0;
  state.pendingProposalReqId = null;

  setText(ui.askPrice, "--");
  setText(ui.payout, "--");
  setText(ui.quoteStatus, message);

  updateBuyButton();
}

function updateBuyButton() {
  const validQuote =
    Boolean(state.proposalId) &&
    state.quoteExpiresAt > Date.now();

  const correctAccount =
    state.account &&
    (
      state.account.account_type === "demo" ||
      (
        state.account.account_type === "real" &&
        state.config?.real_trading_enabled === true
      )
    );

  const enabled =
    state.loggedIn &&
    state.tradingReady &&
    correctAccount &&
    validQuote &&
    !state.buying;

  if (ui.buyBtn) {
    ui.buyBtn.disabled = !enabled;
  }
}

/* =========================================================
   SERVER CONFIG AND ACCOUNT
========================================================= */

async function loadConfig() {
  try {
    const response = await fetch("/api/config", {
      cache: "no-store",
      credentials: "same-origin"
    });

    if (!response.ok) {
      throw new Error("Unable to load server configuration.");
    }

    state.config = await response.json();

    // Never enable real trading from the browser alone.
    if (
      ui.accountType &&
      state.config.real_trading_enabled !== true
    ) {
      const realOption = Array.from(ui.accountType.options)
        .find(option => option.value === "real");

      if (realOption) {
        realOption.disabled = true;
      }
    }

    return true;
  } catch (error) {
    console.error(error);
    setText(ui.connectionStatus, "Server configuration unavailable.");
    return false;
  }
}

async function checkSession() {
  try {
    const response = await fetch("/api/session", {
      cache: "no-store",
      credentials: "same-origin"
    });

    if (!response.ok) return false;

    const data = await response.json();
    state.loggedIn = Boolean(data.authenticated);

    return state.loggedIn;
  } catch (error) {
    console.error("Session check:", error);
    return false;
  }
}

async function loadAccount() {
  if (!state.loggedIn) return false;

  setText(ui.accountStatus, "Checking account...");

  try {
    const response = await fetch("/api/account", {
      cache: "no-store",
      credentials: "same-origin"
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Account request failed.");
    }

    if (!data.account) {
      throw new Error("No Deriv trading account was returned.");
    }

    state.account = data.account;

    setText(ui.accountStatus, "Connected to Deriv ✓");
    setText(ui.accountId, state.account.account_id || state.account.id);
    setText(
      ui.balance,
      `${money(state.account.balance)} ${state.account.currency || "USD"}`
    );

    // Reflect the actual server-selected account.
    if (ui.accountType) {
      ui.accountType.value =
        state.account.account_type || "demo";
    }

    setText(
      ui.accountTypeMessage,
      `Connected account: ${state.account.account_type || "unknown"}`
    );

    return true;
  } catch (error) {
    console.error("Account error:", error);
    setText(ui.accountStatus, "Account unavailable");
    showMessage(error.message);
    return false;
  }
}

function showLoggedIn() {
  if (ui.loginBtn) ui.loginBtn.style.display = "none";
  if (ui.logoutBtn) ui.logoutBtn.hidden = false;
}

function showLoggedOut() {
  if (ui.loginBtn) ui.loginBtn.style.display = "";
  if (ui.logoutBtn) ui.logoutBtn.hidden = true;

  setText(ui.accountStatus, "Log in first");
  setText(ui.accountId, "--");
  setText(ui.balance, "--");

  invalidateQuote("Log in to request a quote.");
}

async function logout() {
  try {
    await fetch("/logout", {
      method: "POST",
      credentials: "same-origin"
    });
  } catch (error) {
    console.error("Logout:", error);
  }

  closeSocket(state.tradingSocket);
  closeSocket(state.publicSocket);

  state.loggedIn = false;
  state.account = null;
  state.tradingReady = false;
  state.publicReady = false;
  state.activeContracts.clear();

  showLoggedOut();

  setText(ui.connectionStatus, "Logged out");
}

/* =========================================================
   SOCKET MANAGEMENT
========================================================= */

function closeSocket(socket) {
  if (socket) {
    try {
      socket.onclose = null;
      socket.close();
    } catch (_) {}
  }
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

  const appId = state.config?.app_id;

  const url = appId
    ? `${PUBLIC_WS_BASE}?app_id=${encodeURIComponent(appId)}`
    : PUBLIC_WS_BASE;

  setText(ui.connectionStatus, "Connecting to market data...");

  const socket = new WebSocket(url);
  state.publicSocket = socket;

  socket.onopen = () => {
    if (state.publicSocket !== socket) return;

    state.publicReady = true;
    setText(ui.connectionStatus, "Market data connected");

send(socket, {
  active_symbols: "brief",
  req_id: nextId()
});

  socket.onmessage = event => {
    if (state.publicSocket !== socket) return;

    let data;

    try {
      data = JSON.parse(event.data);
    } catch (_) {
      return;
    }

    handlePublicMessage(data);
  };

  socket.onerror = error => {
    console.error("Public WebSocket error:", error);
  };

  socket.onclose = () => {
    if (state.publicSocket !== socket) return;

    state.publicReady = false;
    setText(ui.connectionStatus, "Market data disconnected");

    clearTimeout(state.reconnectTimer);

    state.reconnectTimer = setTimeout(() => {
      connectPublicSocket();
    }, 3000);
  };
}


function handlePublicMessage(data) {
  if (data.error || data.errors) {
    const message =
      data.error?.message ||
      data.errors?.[0]?.message ||
      "Unknown market API error";

    console.error("Market API error:", data);
    setText(ui.connectionStatus, "Market API error");
    setText(ui.priceMessage, message);
    return;
  }

  const symbols =
    data.active_symbols ||
    data.data?.active_symbols;

  if (Array.isArray(symbols)) {
    state.markets = symbols.filter(item =>
      item.underlying_symbol || item.symbol
    );

    populateMarkets();
    return;
  }

  const tick =
    data.tick ||
    data.data?.tick;

  if (tick) {
    processTick(tick);
  }
}
   

function populateMarkets() {
  if (!ui.marketSelect) return;

  const previous = state.selectedSymbol;

  ui.marketSelect.replaceChildren();

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

    ui.marketSelect.appendChild(option);
  });

  setText(ui.marketCount, `${state.markets.length} markets loaded`);

  if (!state.markets.length) {
    setText(ui.priceMessage, "No markets were returned.");
    return;
  }

  const selectedExists = state.markets.some(m =>
    (m.underlying_symbol || m.symbol) === previous
  );

  if (selectedExists) {
    ui.marketSelect.value = previous;
  } else {
    const preferred = state.markets.find(m =>
      (m.underlying_symbol || m.symbol) === "1HZ100V"
    );

    ui.marketSelect.value =
      preferred
        ? (preferred.underlying_symbol || preferred.symbol)
        : (state.markets[0].underlying_symbol || state.markets[0].symbol);
  }

  selectMarket(ui.marketSelect.value);
}

function selectMarket(symbol) {
  if (!symbol || !state.publicReady) return;

  state.selectedSymbol = symbol;

  const market = state.markets.find(item =>
    (item.underlying_symbol || item.symbol) === symbol
  );

  state.selectedMarketName =
    market?.underlying_symbol_name ||
    market?.display_name ||
    symbol;

  setText(ui.marketName, state.selectedMarketName);
  setText(ui.priceMessage, "Subscribing to live ticks...");

  state.priceHistory = [];
  state.digitHistory = [];
  state.totalTicks = 0;

  invalidateQuote("Market changed. Request a new quote.");

  // Replace the old tick subscription cleanly.
  send(state.publicSocket, {
    forget_all: "ticks"
  });

  send(state.publicSocket, {
    ticks: symbol,
    subscribe: 1,
    req_id: nextId()
  });
}

/* =========================================================
   CONTINUOUS TICK PROCESSING
========================================================= */

function processTick(tick) {
  if (
    tick.symbol &&
    state.selectedSymbol &&
    tick.symbol !== state.selectedSymbol
  ) {
    return;
  }

  const price = Number(tick.quote);

  if (!Number.isFinite(price)) return;

  state.livePrice = price;

  // This counter never depends on chart-history length.
  state.totalTicks += 1;

  setText(ui.livePrice, price.toFixed(2));
  setText(
    ui.priceMessage,
    `Live • ${state.totalTicks.toLocaleString()} ticks received`
  );

  const formatted = price.toFixed(
    Math.max(0, Math.min(8, Number(tick.pip_size ?? 2)))
  );

  const digit = Number(formatted.slice(-1));

  state.digitHistory.push(digit);

  // Retain 2,000 digits for analysis; the stream continues.
  if (state.digitHistory.length > 2000) {
    state.digitHistory.shift();
  }

  state.priceHistory.push(price);

  // Chart stores only the latest 50 points.
  if (state.priceHistory.length > 50) {
    state.priceHistory.shift();
  }

  setText(ui.liveDigit, digit);

  updateLiveDigitHistory();
  updateDigitsAnalysis();
  updateMarketAnalysis();
  drawChart();
}

function updateLiveDigitHistory() {
  if (!ui.liveDigitHistory) return;

  ui.liveDigitHistory.replaceChildren();

  state.digitHistory.slice(-12).forEach(digit => {
    const span = document.createElement("span");

    span.textContent = digit;
    span.style.cssText =
      "background:#334155;padding:7px 10px;border-radius:7px;";

    ui.liveDigitHistory.appendChild(span);
  });
}

function updateDigitsAnalysis() {
  const digits = state.digitHistory;
  const total = digits.length;

  setText(el("digitsSample"), `${total.toLocaleString()} ticks`);

  if (!total) return;

  const counts = Array(10).fill(0);
  digits.forEach(digit => counts[digit]++);

  const most = Math.max(...counts);
  const least = Math.min(...counts);

  const mostDigit = counts.indexOf(most);
  const leastDigit = counts.indexOf(least);

  const even = digits.filter(d => d % 2 === 0).length;
  const odd = total - even;
  const over = digits.filter(d => d > 5).length;
  const under = digits.filter(d => d < 5).length;

  const evenPct = even / total * 100;
  const oddPct = odd / total * 100;

  let bias = "NEUTRAL";
  let confidence = "LOW";

  if (total >= 200) {
    const difference = Math.abs(evenPct - oddPct);

    if (difference >= 10) {
      bias = evenPct > oddPct ? "EVEN BIAS" : "ODD BIAS";
    }

    if (difference >= 18) {
      confidence = "MEDIUM";
    }
  }

  const repeated =
    total >= 2 &&
    digits[total - 1] === digits[total - 2];

  setText(el("mostFrequentDigit"), `${mostDigit} (${(most / total * 100).toFixed(1)}%)`);
  setText(el("leastFrequentDigit"), `${leastDigit} (${(least / total * 100).toFixed(1)}%)`);
  setText(el("evenPercentage"), `${evenPct.toFixed(1)}%`);
  setText(el("oddPercentage"), `${oddPct.toFixed(1)}%`);
  setText(el("overFivePercentage"), `${(over / total * 100).toFixed(1)}%`);
  setText(el("underFivePercentage"), `${(under / total * 100).toFixed(1)}%`);
  setText(el("repeatedDigit"), repeated ? "YES" : "NO");
  setText(el("digitBias"), bias);
  setText(el("digitConfidence"), confidence);

  setText(
    el("digitAnalysisMessage"),
    total < 200
      ? `Collecting data: ${total}/200 ticks for the initial sample.`
      : "Historical digit frequencies do not reliably predict the next digit."
  );
}

/* =========================================================
   CHART — INDEPENDENT OF TOTAL TICK COUNT
========================================================= */

function drawChart() {
  const canvas = ui.liveChart;

  if (!canvas?.getContext) return;

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(300, Math.floor(rect.width));
  const height = Math.max(220, Math.floor(rect.height));

  const dpr = window.devicePixelRatio || 1;

  canvas.width = width * dpr;
  canvas.height = height * dpr;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const prices = state.priceHistory;

  if (prices.length < 2) return;

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const pad = 20;

  ctx.beginPath();

  prices.forEach((price, index) => {
    const x = pad + index / (prices.length - 1) * (width - pad * 2);
    const y = height - pad - (price - min) / range * (height - pad * 2);

    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.strokeStyle = "#2196f3";
  ctx.lineWidth = 2;
  ctx.stroke();
}

/* =========================================================
   SIMPLE PRICE ANALYSIS
========================================================= */

function updateMarketAnalysis() {
  const prices = state.priceHistory;

  if (prices.length < 20) {
    setText(el("analysisTrend"), "WAITING");
    setText(el("analysisMomentum"), "WAITING");
    setText(el("analysisSignal"), "WAIT");
    setText(el("analysisConfidence"), "LOW");
    setText(el("analysisReason"), "Collecting 20 chart points.");
    return;
  }

  const average = list =>
    list.reduce((sum, value) => sum + value, 0) / list.length;

  const shortChange =
    average(prices.slice(-5)) -
    average(prices.slice(-10, -5));

  const mediumChange =
    average(prices.slice(-10)) -
    average(prices.slice(-20, -10));

  let trend = "NEUTRAL";

  if (shortChange > 0 && mediumChange > 0) trend = "BULLISH";
  if (shortChange < 0 && mediumChange < 0) trend = "BEARISH";

  const structure = prices.slice(-20);
  const support = Math.min(...structure);
  const resistance = Math.max(...structure);
  const range = resistance - support;

  const momentumRatio =
    range > 0 ? Math.abs(shortChange) / range : 0;

  const momentum =
    momentumRatio >= 0.25 ? "STRONG" :
    momentumRatio >= 0.10 ? "MODERATE" : "WEAK";

  const recent = prices.slice(-8);
  let up = 0;
  let down = 0;

  for (let i = 1; i < recent.length; i++) {
    if (recent[i] > recent[i - 1]) up++;
    if (recent[i] < recent[i - 1]) down++;
  }

  const moves = up + down;
  const consistency =
    moves ? Math.max(up, down) / moves : 0;

  const nearSupport =
    range > 0 && state.livePrice - support <= range * 0.15;

  const nearResistance =
    range > 0 && resistance - state.livePrice <= range * 0.15;

  let signal = "WAIT";

  if (
    trend === "BULLISH" &&
    momentum !== "WEAK" &&
    consistency >= 0.60 &&
    !nearResistance
  ) {
    signal = "RISE";
  }

  if (
    trend === "BEARISH" &&
    momentum !== "WEAK" &&
    consistency >= 0.60 &&
    !nearSupport
  ) {
    signal = "FALL";
  }

  setText(el("analysisTrend"), trend);
  setText(el("analysisMomentum"), momentum);
  setText(el("analysisSupport"), support.toFixed(2));
  setText(el("analysisResistance"), resistance.toFixed(2));
  setText(el("analysisSignal"), signal);
  setText(
    el("analysisConfidence"),
    signal === "WAIT" ? "LOW" :
      momentum === "STRONG" && consistency >= 0.75
        ? "HIGH" : "MEDIUM"
  );

  setText(
    el("analysisReason"),
    signal === "WAIT"
      ? "Conditions are not sufficiently confirmed. Wait."
      : `${trend} conditions detected. This is not a guarantee of the next price movement.`
  );
}

/* =========================================================
   AUTHENTICATED TRADING CONNECTION
========================================================= */

async function connectTradingSocket() {
  if (!state.loggedIn) return;

  if (
    state.tradingSocket &&
    (
      state.tradingSocket.readyState === WebSocket.OPEN ||
      state.tradingSocket.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  setText(ui.connectionStatus, "Connecting to trading account...");

  try {
    const response = await fetch("/api/trading-connection", {
      credentials: "same-origin",
      cache: "no-store"
    });

    const data = await response.json();

    if (!response.ok || !data.ws_url) {
      throw new Error(data.error || "Trading connection URL unavailable.");
    }

    const socket = new WebSocket(data.ws_url);
    state.tradingSocket = socket;

    socket.onopen = () => {
      if (state.tradingSocket !== socket) return;

      state.tradingReady = true;

      setText(ui.connectionStatus, "Trading connection ready");
      updateBuyButton();

      send(socket, {
        balance: 1,
        subscribe: 1,
        req_id: nextId()
      });

      requestQuote();
    };

    socket.onmessage = event => {
      if (state.tradingSocket !== socket) return;

      let data;

      try {
        data = JSON.parse(event.data);
      } catch (_) {
        return;
      }

      handleTradingMessage(data);
     }
     socket.onerror = error => {
      console.error("Trading WebSocket error:", error);
      setText(ui.connectionStatus, "Trading connection error");
    };

    socket.onclose = () => {
      if (state.tradingSocket !== socket) return;

      state.tradingReady = false;
      state.tradingSocket = null;
      state.buying = false;
      state.pendingBuyReqId = null;

      invalidateQuote("Trading disconnected. Reconnecting...");

      setText(ui.connectionStatus, "Trading disconnected");

      if (state.loggedIn) {
        clearTimeout(state.reconnectTimer);

        state.reconnectTimer = setTimeout(() => {
          connectTradingSocket();
        }, 3000);
      }
    };

  } catch (error) {
    console.error("Trading connection:", error);

    state.tradingReady = false;
    setText(ui.connectionStatus, "Trading connection failed");
    showMessage(error.message);
  }
}


/* =========================================================
   QUOTE REQUESTS
========================================================= */

function requestQuote() {
  if (!state.loggedIn || !state.tradingReady) {
    invalidateQuote("Connect your Deriv account first.");
    return;
  }

  if (!state.account || !state.selectedSymbol) {
    invalidateQuote("Select a market and account first.");
    return;
  }

  if (state.buying) {
    setText(ui.quoteStatus, "Please wait for the current trade.");
    return;
  }

  const amount = Number(ui.amount?.value ?? state.amount);
  const duration = Number(ui.duration?.value ?? state.duration);

  if (!Number.isFinite(amount) || amount <= 0) {
    invalidateQuote("Enter a valid stake amount.");
    return;
  }

  if (!Number.isFinite(duration) || duration < 1) {
    invalidateQuote("Enter a valid duration.");
    return;
  }

  state.amount = amount;
  state.duration = duration;

  if (
    state.account.currency &&
    state.account.currency !== "USD"
  ) {
    invalidateQuote(
      `Your account currency is ${state.account.currency}. Check your stake settings.`
    );
    return;
  }

  invalidateQuote("Requesting a fresh quote...");

  const reqId = nextId();
  state.pendingProposalReqId = reqId;

  const payload = {
    proposal: 1,
    amount: state.amount,
    basis: "stake",
    contract_type: state.contractType,
    currency: state.account.currency || "USD",
    duration: state.duration,
    duration_unit: state.durationUnit,
    underlying_symbol: state.selectedSymbol,
    product_type: "basic",
    req_id: reqId
  };

  if (
    state.contractType === "DIGITOVER" ||
    state.contractType === "DIGITUNDER"
  ) {
    payload.barrier = String(state.barrier);
  }

  if (!send(state.tradingSocket, payload)) {
    state.pendingProposalReqId = null;
    invalidateQuote("Could not send the quote request.");
  }
}


/* =========================================================
   TRADING MESSAGE HANDLER
========================================================= */

function handleTradingMessage(data) {
  if (data.error) {
    const message =
      data.error.message || "Deriv returned a trading error.";

    console.error("Deriv trading error:", data.error);

    if (data.req_id === state.pendingBuyReqId) {
      state.pendingBuyReqId = null;
      state.buying = false;
    }

    if (data.req_id === state.pendingProposalReqId) {
      state.pendingProposalReqId = null;
    }

    setText(ui.quoteStatus, message);
    showMessage(message);
    updateBuyButton();
    return;
  }

  const proposal = data.proposal || data.data?.proposal;

  if (
    proposal &&
    (
      data.req_id === state.pendingProposalReqId ||
      data.echo_req?.req_id === state.pendingProposalReqId
    )
  ) {
    state.pendingProposalReqId = null;

    state.proposal = proposal;
    state.proposalId = proposal.id || null;
    state.askPrice = Number(proposal.ask_price || 0);
    state.payout = Number(proposal.payout || 0);

    // Do not allow a quote to remain usable indefinitely.
    state.quoteExpiresAt = Date.now() + 15000;

    setText(ui.askPrice, money(state.askPrice));
    setText(ui.payout, money(state.payout));
    setText(ui.quoteStatus, "Quote received ✓");

    clearTimeout(state.quoteTimer);

    state.quoteTimer = setTimeout(() => {
      if (state.quoteExpiresAt <= Date.now()) {
        invalidateQuote("Quote expired. Request a new quote.");
      }
    }, 15100);

    updateBuyButton();
    return;
  }

  const buy = data.buy || data.data?.buy;

  if (
    buy &&
    (
      data.req_id === state.pendingBuyReqId ||
      data.echo_req?.req_id === state.pendingBuyReqId
    )
  ) {
    state.pendingBuyReqId = null;
    state.buying = false;

    if (buy.contract_id) {
      state.activeContracts.set(
        String(buy.contract_id),
        {
          contract_id: buy.contract_id,
          buy_price: Number(buy.buy_price || state.askPrice),
          startedAt: Date.now()
        }
      );

      send(state.tradingSocket, {
        proposal_open_contract: 1,
        contract_id: buy.contract_id,
        subscribe: 1,
        req_id: nextId()
      });

      showMessage(
        `Trade purchased successfully. Contract ID: ${buy.contract_id}`
      );

      setText(ui.quoteStatus, "Trade purchased ✓");
      invalidateQuote("Trade placed. Request a fresh quote.");
      renderOpenContracts();
    } else {
      showMessage("The purchase response did not include a contract ID.");
    }

    updateBuyButton();
    return;
  }

  const balance = data.balance || data.data?.balance;

  if (balance) {
    if (state.account) {
      state.account.balance = Number(balance.balance);
      state.account.currency =
        balance.currency || state.account.currency;
    }

    setText(
      ui.balance,
      `${money(balance.balance)} ${balance.currency || "USD"}`
    );
    return;
  }

  const contract =
    data.proposal_open_contract ||
    data.data?.proposal_open_contract;

  if (contract) {
    handleContractUpdate(contract);
  }
          }
/* =========================================================
   BUY CURRENT QUOTE
========================================================= */

function buyCurrentQuote() {
  if (state.buying) return;

  if (!state.loggedIn || !state.tradingReady) {
    showMessage("Connect to Deriv before purchasing.");
    return;
  }

  if (!state.account || !state.proposalId) {
    showMessage("Request a valid quote first.");
    return;
  }

  if (state.quoteExpiresAt <= Date.now()) {
    invalidateQuote("Quote expired. Request a new quote.");
    return;
  }

  if (
    state.account.account_type === "real" &&
    state.config?.real_trading_enabled !== true
  ) {
    showMessage("Real trading is disabled by the server.");
    return;
  }

  const confirmed = window.confirm(
    `Confirm ${state.account.account_type || "demo"} trade?\n\n` +
    `Market: ${state.selectedMarketName}\n` +
    `Contract: ${state.contractType}\n` +
    `Stake: ${money(state.askPrice)} ${state.account.currency || "USD"}\n` +
    `Potential payout: ${money(state.payout)}\n\n` +
    `Only continue if these details are correct.`
  );

  if (!confirmed) return;

  const proposalId = state.proposalId;
  const askPrice = state.askPrice;

  state.buying = true;
  state.pendingBuyReqId = nextId();

  const reqId = state.pendingBuyReqId;

  updateBuyButton();
  showMessage("Sending purchase request...");

  const sent = send(state.tradingSocket, {
    buy: proposalId,
    price: askPrice,
    req_id: reqId
  });

  if (!sent) {
    state.buying = false;
    state.pendingBuyReqId = null;

    showMessage("Purchase request could not be sent.");
    updateBuyButton();
  }
}


/* =========================================================
   CONTRACT UPDATES AND HISTORY
========================================================= */

function handleContractUpdate(contract) {
  const id = String(contract.contract_id || "");

  if (!id) return;

  const existing = state.activeContracts.get(id) || {};

  const updated = {
    ...existing,
    contract_id: contract.contract_id,
    buy_price: Number(
      contract.buy_price ?? existing.buy_price ?? 0
    ),
    current_spot: contract.current_spot,
    status: contract.status || "open",
    profit: Number(contract.profit || 0),
    payout: Number(contract.payout || 0),
    is_sold: Boolean(contract.is_sold),
    is_expired: Boolean(contract.is_expired)
  };

  const finished =
    updated.is_sold ||
    updated.is_expired ||
    ["won", "lost", "sold"].includes(updated.status);

  if (finished) {
    state.activeContracts.delete(id);
    state.finishedContracts.set(id, updated);

    if (state.finishedContracts.size > 100) {
      const oldest =
        state.finishedContracts.keys().next().value;

      state.finishedContracts.delete(oldest);
    }

    if (!existing.resultRecorded) {
      if (updated.profit > 0) {
        state.performance.wins++;
      } else if (updated.profit < 0) {
        state.performance.losses++;
      }

      state.performance.profit += updated.profit;
      updated.resultRecorded = true;
      state.finishedContracts.set(id, updated);
    }

    updatePerformance();
    renderTradeHistory();

    showMessage(
      `Contract ${id} finished. Profit/Loss: ${money(updated.profit)}`
    );
  } else {
    state.activeContracts.set(id, updated);
  }

  renderOpenContracts();
}

function updatePerformance() {
  setText(el("wins"), state.performance.wins);
  setText(el("losses"), state.performance.losses);
  setText(el("totalProfit"), money(state.performance.profit));
}

function renderOpenContracts() {
  if (!ui.openContracts) return;

  ui.openContracts.replaceChildren();

  if (!state.activeContracts.size) {
    ui.openContracts.textContent = "No open contracts.";
    return;
  }

  state.activeContracts.forEach(contract => {
    const row = document.createElement("div");

    row.style.cssText =
      "padding:10px;margin:6px 0;background:#1e293b;border-radius:8px;";

    row.textContent =
      `Contract ${contract.contract_id} • ` +
      `Status: ${contract.status || "open"} • ` +
      `Profit/Loss: ${money(contract.profit || 0)}`;

    ui.openContracts.appendChild(row);
  });
}

function renderTradeHistory() {
  if (!ui.tradeHistory) return;

  ui.tradeHistory.replaceChildren();

  if (!state.finishedContracts.size) {
    ui.tradeHistory.textContent = "No finished trades yet.";
    return;
  }

  Array.from(state.finishedContracts.values())
    .reverse()
    .forEach(contract => {
      const row = document.createElement("div");

      row.style.cssText =
        "padding:10px;margin:6px 0;background:#1e293b;border-radius:8px;";

      row.textContent =
        `Contract ${contract.contract_id} • ` +
        `${contract.status} • P/L: ${money(contract.profit)}`;

      ui.tradeHistory.appendChild(row);
    });
}


/* =========================================================
   ACCOUNT TYPE
========================================================= */

async function changeAccountType() {
  if (!ui.accountType || !state.loggedIn) return;

  const selectedType = ui.accountType.value;

  if (!["demo", "real"].includes(selectedType)) {
    showMessage("Invalid account selection.");
    return;
  }

  if (
    selectedType === "real" &&
    state.config?.real_trading_enabled !== true
  ) {
    showMessage("Real trading is disabled by the server.");
    ui.accountType.value = "demo";
    return;
  }

  if (
    selectedType === "real" &&
    !window.confirm(
      "You selected a REAL account. Trades may use real money. Continue?"
    )
  ) {
    ui.accountType.value =
      state.account?.account_type || "demo";
    return;
  }

  invalidateQuote("Changing account. Please wait.");

  try {
    const response = await fetch("/api/account-type", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({
        account_type: selectedType
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "Could not change the account type."
      );
       }
     // Confirm the server-selected account instead of assuming
    // that changing the dropdown changed the trading account.
    const loaded = await loadAccount();

    if (!loaded) {
      throw new Error("Could not verify the selected account.");
    }

    closeSocket(state.tradingSocket);

    state.tradingSocket = null;
    state.tradingReady = false;

    await connectTradingSocket();

    showMessage(
      `Account selection updated. Verify the account details before trading.`
    );
  } catch (error) {
    console.error("Account type:", error);

    showMessage(error.message);

    if (state.account) {
      ui.accountType.value =
        state.account.account_type || "demo";
    }
  }
}


/* =========================================================
   USER INTERACTIONS
========================================================= */

function bindEvents() {
  if (ui.loginBtn) {
    ui.loginBtn.addEventListener("click", () => {
      window.location.href = "/login";
    });
  }

  if (ui.logoutBtn) {
    ui.logoutBtn.addEventListener("click", logout);
  }

  if (ui.marketSelect) {
    ui.marketSelect.addEventListener("change", () => {
      selectMarket(ui.marketSelect.value);
    });
  }

  if (ui.accountType) {
    ui.accountType.addEventListener(
      "change",
      changeAccountType
    );
  }

  if (ui.amount) {
    ui.amount.addEventListener("change", () => {
      state.amount = Number(ui.amount.value);
      invalidateQuote("Stake changed. Request a new quote.");
    });
  }

  if (ui.duration) {
    ui.duration.addEventListener("change", () => {
      state.duration = Number(ui.duration.value);
      invalidateQuote("Duration changed. Request a new quote.");
    });
  }

  if (ui.contractType) {
    ui.contractType.addEventListener("change", () => {
      state.contractType = ui.contractType.value;
      invalidateQuote("Contract changed. Request a new quote.");
    });
  }

  if (ui.barrier) {
    ui.barrier.addEventListener("change", () => {
      state.barrier = Number(ui.barrier.value);
      invalidateQuote("Barrier changed. Request a new quote.");
    });
  }

  if (ui.riseBtn) {
    ui.riseBtn.addEventListener("click", () => {
      state.direction = "RISE";
      state.contractType = "CALL";

      if (ui.contractType) {
        ui.contractType.value = "CALL";
      }

      invalidateQuote("RISE selected. Request a new quote.");
      requestQuote();
    });
  }

  if (ui.fallBtn) {
    ui.fallBtn.addEventListener("click", () => {
      state.direction = "FALL";
      state.contractType = "PUT";

      if (ui.contractType) {
        ui.contractType.value = "PUT";
      }

      invalidateQuote("FALL selected. Request a new quote.");
      requestQuote();
    });
  }

  if (ui.buyBtn) {
    ui.buyBtn.addEventListener("click", buyCurrentQuote);
  }
const quoteButton = el("quoteBtn");

  if (quoteButton) {
    quoteButton.addEventListener("click", requestQuote);
  }

  window.addEventListener("resize", drawChart);
}


/* =========================================================
   START APPLICATION
========================================================= */

async function startApp() {
  cacheUI();
  bindEvents();

  updatePerformance();
  renderOpenContracts();
  renderTradeHistory();

  setText(ui.connectionStatus, "Loading Tradedollars...");

  const configLoaded = await loadConfig();

  if (!configLoaded) {
    setText(
      ui.connectionStatus,
      "Configuration unavailable. Refresh to retry."
    );
    return;
  }

  connectPublicSocket();

  const loggedIn = await checkSession();

  if (loggedIn) {
    showLoggedIn();

    setText(ui.connectionStatus, "Connecting to Deriv...");

    const accountLoaded = await loadAccount();

    if (accountLoaded) {
      await connectTradingSocket();
    }
  } else {
    showLoggedOut();
  }

  updateBuyButton();
}


/* =========================================================
   APPLICATION ENTRY POINT
========================================================= */

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApp);
} else {
  startApp();
}

/* =========================================================
   TRADEDOLLARS — STARTUP DIAGNOSTICS
========================================================= */

window.addEventListener("load", () => {
  const requiredElements = [
    "connectionStatus",
    "loginBtn",
    "logoutBtn",
    "marketSelect",
    "livePrice",
    "amount",
    "duration",
    "riseBtn",
    "fallBtn",
    "buyBtn"
  ];

  const missingElements = requiredElements.filter(
    id => !document.getElementById(id)
  );

  if (missingElements.length > 0) {
    console.warn(
      "Tradedollars: HTML elements not found:",
      missingElements
    );
  } else {
    console.info(
      "Tradedollars: Required HTML elements found."
    );
  }
});
  
                
