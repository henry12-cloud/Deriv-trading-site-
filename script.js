/* =========================================================
   TRADEDOLLARS
   Complete Trading Interface Script
   ========================================================= */

"use strict";


/* =========================================================
   CONFIG
========================================================= */

const PUBLIC_WS_BASE =
  "wss://api.derivws.com/trading/v1/options/ws/public";


/* =========================================================
   STATE
========================================================= */

const state = {

  config: null,

  loggedIn: false,

  account: null,

  publicSocket: null,

  tradingSocket: null,

  publicSocketReady: false,

  tradingSocketReady: false,

  markets: [],

  selectedSymbol: "",

  selectedMarketName: "",

  livePrice: null,

  direction: "RISE",

  amount: 1,

  duration: 5,

  durationUnit: "t",

  proposal: null,

  proposalId: null,

  askPrice: 0,

  payout: 0,

  requestId: 1000,

  activeContracts: new Map(),

  finishedContracts: new Map(),

  performance: {
    wins: 0,
    losses: 0,
    profit: 0
  },

  quoteTimer: null,

  reconnectTimer: null,

  connectingTrading: false

};


/* =========================================================
   UI HELPERS
========================================================= */

const ui = {};
state.accountType = "demo";


function findElement(...ids) {

  for (const id of ids) {

    const element =
      document.getElementById(id);

    if (element) {
      return element;
    }

  }

  return null;
}


function cacheUI() {

  ui.connectionStatus =
    findElement(
      "connectionStatus",
      "connection-status",
      "status"
    );

  ui.accountStatus =
    findElement(
      "accountStatus",
      "account-status"
    );

  ui.accountId =
    findElement(
      "accountId",
      "account-id"
    );

  ui.balance =
    findElement(
      "balance"
    );

  ui.accountType =
  findElement(
    "accountType"
  );

ui.accountTypeMessage =
  findElement(
    "accountTypeMessage"
  );

  ui.loginBtn =
    findElement(
      "loginBtn",
      "login-btn"
    );

  ui.logoutBtn =
    findElement(
      "logoutBtn",
      "logout-btn"
    );

  ui.marketSelect =
    findElement(
      "marketSelect",
      "market-select",
      "market"
    );

  ui.marketName =
    findElement(
      "marketName",
      "market-name",
      "selectedMarket"
    );

  ui.marketCount =
    findElement(
      "marketCount",
      "market-count"
    );

  ui.livePrice =
    findElement(
      "livePrice",
      "live-price",
      "price"
    );
  /* =========================================================
   LIVE PRICE CHART
========================================================= */

  ui.liveChart =
    findElement(
      "liveChart",
      "live-price-chart",
      "priceChart",
      "chart"
    );
  ui.priceMessage =
    findElement(
      "priceMessage",
      "price-message"
    );

  ui.amount =
    findElement(
      "amount",
      "tradeAmount",
      "trade-amount"
    );

  ui.duration =
    findElement(
      "duration",
      "tradeDuration",
      "trade-duration"
    );

  ui.riseBtn =
    findElement(
      "riseBtn",
      "rise-btn",
      "callBtn",
      "call-btn"
    );

  ui.fallBtn =
    findElement(
      "fallBtn",
      "fall-btn",
      "putBtn",
      "put-btn"
    );

  ui.quoteStatus =
    findElement(
      "quoteStatus",
      "quote-status",
      "quoteMessage"
    );

  ui.askPrice =
    findElement(
      "askPrice",
      "ask-price"
    );

  ui.payout =
    findElement(
      "payout"
    );

  ui.buyBtn =
    findElement(
      "buyBtn",
      "buy-btn",
      "confirmBuy",
      "confirm-buy"
    );

  ui.tradeMessage =
    findElement(
      "tradeMessage",
      "trade-message"
    );

  ui.openContracts =
    findElement(
      "openContracts",
      "open-contracts",
      "contracts"
    );

  ui.tradeHistory =
    findElement(
      "tradeHistory",
      "trade-history",
      "history"
    );

  ui.wins =
    findElement(
      "wins",
      "winCount",
      "win-count"
    );

  ui.losses =
    findElement(
      "losses",
      "lossCount",
      "loss-count"
    );

  ui.totalProfit =
    findElement(
      "totalProfit",
      "total-profit",
      "profit"
    );

}
/* =========================================================
   LIVE PRICE CHART
========================================================= */

state.priceHistory = [];
// =====================================================
// DIGITS ANALYSIS
// =====================================================

state.digitHistory = [];

function updateDigitsAnalysis(price) {
  const numericPrice = Number(price);

  if (!Number.isFinite(numericPrice)) {
    return;
  }

  // Extract the final digit from the displayed price
  const priceString = numericPrice.toFixed(2);
  const digitsOnly = priceString.replace(/\D/g, "");

  if (!digitsOnly.length) {
    return;
  }

  const lastDigit =
    Number(digitsOnly.charAt(digitsOnly.length - 1));

  if (!Number.isInteger(lastDigit)) {
    return;
  }

  state.digitHistory.push(lastDigit);

  // Keep the most recent 200 ticks
  if (state.digitHistory.length > 200) {
    state.digitHistory.shift();
  }

  const history = state.digitHistory;
  const total = history.length;

  if (total === 0) {
    return;
  }

  const counts = Array(10).fill(0);

  history.forEach(function (digit) {
    counts[digit]++;
  });

  let mostFrequent = 0;
  let leastFrequent = 0;

  for (let i = 1; i < 10; i++) {
    if (counts[i] > counts[mostFrequent]) {
      mostFrequent = i;
    }

    if (counts[i] < counts[leastFrequent]) {
      leastFrequent = i;
    }
  }

  const evenCount =
    history.filter(function (digit) {
      return digit % 2 === 0;
    }).length;

  const oddCount = total - evenCount;

  const overFiveCount =
    history.filter(function (digit) {
      return digit > 5;
    }).length;

  const underFiveCount =
    history.filter(function (digit) {
      return digit < 5;
    }).length;

  const last =
    history[history.length - 1];

  const previous =
    history.length > 1
      ? history[history.length - 2]
      : null;

  const repeated =
    previous !== null &&
    last === previous;

  const evenPercentage =
    ((evenCount / total) * 100).toFixed(1);

  const oddPercentage =
    ((oddCount / total) * 100).toFixed(1);

  const overFivePercentage =
    ((overFiveCount / total) * 100).toFixed(1);

  const underFivePercentage =
    ((underFiveCount / total) * 100).toFixed(1);

  const mostFrequency =
    ((counts[mostFrequent] / total) * 100).toFixed(1);

  const leastFrequency =
    ((counts[leastFrequent] / total) * 100).toFixed(1);

  let bias = "WAIT";
  let confidence = "LOW";
  let message =
    "Collecting more tick data...";

  if (total >= 50) {

    const difference =
      Math.abs(
        evenCount - oddCount
      ) / total;

    if (difference >= 0.10) {

      bias =
        evenCount > oddCount
          ? "EVEN BIAS"
          : "ODD BIAS";

      confidence =
        difference >= 0.18
          ? "MEDIUM"
          : "LOW";

      message =
        "A short-term digit imbalance has been detected. Wait for confirmation.";

    } else {

      bias = "NEUTRAL";
      confidence = "LOW";

      message =
        "Digit distribution is relatively balanced. Wait for confirmation.";
    }
  }

  const sampleElement =
    document.getElementById("digitsSample");

  const mostElement =
    document.getElementById("mostFrequentDigit");

  const leastElement =
    document.getElementById("leastFrequentDigit");

  const evenElement =
    document.getElementById("evenPercentage");

  const oddElement =
    document.getElementById("oddPercentage");

  const overFiveElement =
    document.getElementById("overFivePercentage");

  const underFiveElement =
    document.getElementById("underFivePercentage");

  const repeatedElement =
    document.getElementById("repeatedDigit");

  const biasElement =
    document.getElementById("digitBias");

  const confidenceElement =
    document.getElementById("digitConfidence");

  const messageElement =
    document.getElementById("digitAnalysisMessage");

  if (sampleElement) {
    sampleElement.textContent =
      total + " ticks";
  }

  if (mostElement) {
    mostElement.textContent =
      mostFrequent +
      " (" +
      mostFrequency +
      "%)";
  }

  if (leastElement) {
    leastElement.textContent =
      leastFrequent +
      " (" +
      leastFrequency +
      "%)";
  }

  if (evenElement) {
    evenElement.textContent =
      evenPercentage + "%";
  }

  if (oddElement) {
    oddElement.textContent =
      oddPercentage + "%";
  }

  if (overFiveElement) {
    overFiveElement.textContent =
      overFivePercentage + "%";
  }

  if (underFiveElement) {
    underFiveElement.textContent =
      underFivePercentage + "%";
  }

  if (repeatedElement) {
    repeatedElement.textContent =
      repeated ? "YES" : "NO";
  }

  if (biasElement) {
    biasElement.textContent = bias;
  }

  if (confidenceElement) {
    confidenceElement.textContent =
      confidence;
  }

  if (messageElement) {
    messageElement.textContent =
      message;
  }
}

function updateLiveChart(price) {
  if (
    !ui.liveChart ||
    !Number.isFinite(Number(price))
  ) {
    return;
  }

  const canvas =
    ui.liveChart;

  if (!canvas.getContext) {
    return;
  }

state.priceHistory.push({
  time: new Date().toLocaleTimeString(),
  price: Number(price)
});

updateMarketAnalysis(price);
updateDigitsAnalysis(price);

  if (state.priceHistory.length > 50) {
    state.priceHistory.shift();
  }

  const rect =
    canvas.getBoundingClientRect();

  const width =
    Math.max(
      Math.floor(rect.width),
      300
    );

  const height =
    Math.max(
      Math.floor(rect.height),
      260
    );

  const dpr =
    window.devicePixelRatio || 1;

  canvas.width =
    width * dpr;

  canvas.height =
    height * dpr;

  const ctx =
    canvas.getContext("2d");

  ctx.setTransform(
    dpr,
    0,
    0,
    dpr,
    0,
    0
  );

  ctx.clearRect(
    0,
    0,
    width,
    height
  );

  if (state.priceHistory.length < 2) {
    return;
  }

  const prices =
    state.priceHistory.map(
      item => item.price
    );

  const min =
    Math.min(...prices);

  const max =
    Math.max(...prices);

  const range =
    max - min || 1;

  const padding = 25;

  ctx.beginPath();

  state.priceHistory.forEach(
    function (item, index) {

      const x =
        padding +
        (
          index /
          (state.priceHistory.length - 1)
        ) *
        (
          width -
          padding * 2
        );

      const y =
        height -
        padding -
        (
          (
            item.price -
            min
          ) /
          range
        ) *
        (
          height -
          padding * 2
        );

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
  );

  ctx.strokeStyle =
    "#2196f3";

  ctx.lineWidth = 2;

  ctx.stroke();
}

/* =========================================================
   MARKET ANALYSIS
   CONFIRMATION-BASED STRATEGY
========================================================= */

function updateMarketAnalysis(price) {

  const value = Number(price);

  if (!Number.isFinite(value)) {
    return;
  }

  const history =
    Array.isArray(state.priceHistory)
      ? state.priceHistory
      : [];

  /*
    We require 20 ticks before making a directional decision.
    This prevents the dashboard from reacting too quickly
    to a small number of price movements.
  */

  if (history.length < 20) {

    updateAnalysisDisplay(
      "WAITING",
      "WAITING",
      "--",
      "--",
      "Collecting more live price data before generating a signal.",
      "WAIT"
    );

    return;
  }

  const prices =
    history
      .map(item => Number(item.price))
      .filter(Number.isFinite);

  if (prices.length < 20) {
    return;
  }


  /* =======================================================
     TIME WINDOWS
  ======================================================= */

  const shortTerm =
    prices.slice(-5);

  const previousShortTerm =
    prices.slice(-10, -5);

  const mediumTerm =
    prices.slice(-10);

  const previousMediumTerm =
    prices.slice(-20, -10);

  const structurePrices =
    prices.slice(-20);


  /* =======================================================
     AVERAGES
  ======================================================= */

  const shortAverage =
    shortTerm.reduce(
      (total, number) =>
        total + number,
      0
    ) / shortTerm.length;

  const previousShortAverage =
    previousShortTerm.reduce(
      (total, number) =>
        total + number,
      0
    ) / previousShortTerm.length;

  const mediumAverage =
    mediumTerm.reduce(
      (total, number) =>
        total + number,
      0
    ) / mediumTerm.length;

  const previousMediumAverage =
    previousMediumTerm.reduce(
      (total, number) =>
        total + number,
      0
    ) / previousMediumTerm.length;


  /* =======================================================
     TREND CONFIRMATION
  ======================================================= */

  const shortChange =
    shortAverage -
    previousShortAverage;

  const mediumChange =
    mediumAverage -
    previousMediumAverage;

  let trend = "NEUTRAL";

  if (
    shortChange > 0 &&
    mediumChange > 0
  ) {

    trend = "BULLISH";

  } else if (
    shortChange < 0 &&
    mediumChange < 0
  ) {

    trend = "BEARISH";

  }


  /* =======================================================
     SUPPORT / RESISTANCE
  ======================================================= */

  const support =
    Math.min(...structurePrices);

  const resistance =
    Math.max(...structurePrices);

  const structureRange =
    resistance -
    support;


  /* =======================================================
     MOMENTUM
  ======================================================= */

  const movement =
    Math.abs(shortChange);

  let normalizedMomentum = 0;

  if (structureRange > 0) {

    normalizedMomentum =
      movement /
      structureRange;

  }

  let momentum = "WEAK";

  if (
    normalizedMomentum >= 0.10
  ) {

    momentum = "MODERATE";

  }

  if (
    normalizedMomentum >= 0.25
  ) {

    momentum = "STRONG";

  }


  /* =======================================================
     DIRECTIONAL CONSISTENCY
  ======================================================= */

  const recentMoves = [];

  for (
    let i = prices.length - 8;
    i < prices.length;
    i++
  ) {

    if (i <= 0) {
      continue;
    }

    const difference =
      prices[i] -
      prices[i - 1];

    if (difference > 0) {
      recentMoves.push("UP");
    }

    if (difference < 0) {
      recentMoves.push("DOWN");
    }

  }


  const upMoves =
    recentMoves.filter(
      move => move === "UP"
    ).length;

  const downMoves =
    recentMoves.filter(
      move => move === "DOWN"
    ).length;

  const totalMoves =
    recentMoves.length;

  let directionalConsistency = 0;

  if (totalMoves > 0) {

    directionalConsistency =
      Math.max(
        upMoves,
        downMoves
      ) / totalMoves;

  }


  /* =======================================================
     SUPPORT / RESISTANCE ZONES
  ======================================================= */

  let nearSupport = false;
  let nearResistance = false;

  if (structureRange > 0) {

    const distanceFromSupport =
      value - support;

    const distanceFromResistance =
      resistance - value;

    const zoneSize =
      structureRange * 0.15;

    if (
      distanceFromSupport <= zoneSize
    ) {

      nearSupport = true;

    }

    if (
      distanceFromResistance <= zoneSize
    ) {

      nearResistance = true;

    }

  }


  /* =======================================================
     SIGNAL
  ======================================================= */

  let signal = "WAIT";


  /*
    RISE requires:

    1. Bullish short-term trend
    2. Bullish medium-term trend
    3. At least moderate momentum
    4. At least 60% directional consistency
    5. Price not too close to resistance
  */

  if (
    trend === "BULLISH" &&
    momentum !== "WEAK" &&
    directionalConsistency >= 0.60 &&
    !nearResistance
  ) {

    signal = "RISE";

  }


  /*
    FALL requires the opposite confirmation.
  */

  if (
    trend === "BEARISH" &&
    momentum !== "WEAK" &&
    directionalConsistency >= 0.60 &&
    !nearSupport
  ) {

    signal = "FALL";

  }

  /* =======================================================
     STRATEGY CONFIDENCE
  ======================================================= */

  let confidence = "WAIT";

  if (signal !== "WAIT") {

    if (
      momentum === "STRONG" &&
      directionalConsistency >= 0.75
    ) {

      confidence = "HIGH";

    } else {

      confidence = "MEDIUM";

    }

  }
  /* =======================================================
     REASON
  ======================================================= */

  let reason =
    "Market conditions are unclear. Wait for stronger confirmation.";


  if (
    trend === "BULLISH" &&
    momentum === "WEAK"
  ) {

    reason =
      "Bullish trend detected, but momentum is too weak.";

  }


  if (
    trend === "BEARISH" &&
    momentum === "WEAK"
  ) {

    reason =
      "Bearish trend detected, but momentum is too weak.";

  }


  if (
    trend === "BULLISH" &&
    directionalConsistency < 0.60
  ) {

    reason =
      "Bullish movement is not consistent enough yet.";

  }


  if (
    trend === "BEARISH" &&
    directionalConsistency < 0.60
  ) {

    reason =
      "Bearish movement is not consistent enough yet.";

  }


  if (
    trend === "BULLISH" &&
    nearResistance
  ) {

    reason =
      "Bullish trend detected, but price is close to resistance. Wait.";

  }


  if (
    trend === "BEARISH" &&
    nearSupport
  ) {

    reason =
      "Bearish trend detected, but price is close to support. Wait.";

  }


  if (signal === "RISE") {

    reason =
      "Bullish trend, momentum and directional movement are aligned.";

  }


  if (signal === "FALL") {

    reason =
      "Bearish trend, momentum and directional movement are aligned.";

  }


  /* =======================================================
     UPDATE DASHBOARD
  ======================================================= */

  updateAnalysisDisplay(
    trend,
    momentum,
    support,
    resistance,
    reason,
    signal
  );

}
function updateAnalysisDisplay(
  trend,
  momentum,
  support,
  resistance,
  reason,
  signal,
  confidence = "LOW"
) {

  const trendElement =
    document.getElementById("analysisTrend");

  const momentumElement =
    document.getElementById("analysisMomentum");

  const supportElement =
    document.getElementById("analysisSupport");

  const resistanceElement =
    document.getElementById("analysisResistance");

  const signalElement =
    document.getElementById("analysisSignal");

  const reasonElement =
    document.getElementById("analysisReason");

  const confidenceElement =
    document.getElementById("analysisConfidence");


  if (trendElement) {
    trendElement.textContent =
      trend;
  }


  if (momentumElement) {
    momentumElement.textContent =
      momentum;
  }


  if (supportElement) {

    supportElement.textContent =
      Number.isFinite(Number(support))
        ? Number(support).toFixed(2)
        : "--";

  }


  if (resistanceElement) {

    resistanceElement.textContent =
      Number.isFinite(Number(resistance))
        ? Number(resistance).toFixed(2)
        : "--";

  }


  if (signalElement) {
    signalElement.textContent =
      signal;
  }


  if (reasonElement) {
    reasonElement.textContent =
      reason;
  }


  if (confidenceElement) {
    confidenceElement.textContent =
      confidence;
   }
   }


/* =========================================================
   TEXT / DISPLAY
========================================================= */

function setText(element, value) {

  if (!element) {
    return;
  }

  element.textContent =
    value === null ||
    value === undefined
      ? "--"
      : String(value);

}


function money(value) {

  const number =
    Number(value);

  if (!Number.isFinite(number)) {
    return "--";
  }

  return number.toFixed(2);

}


function setConnectionStatus(message) {

  setText(
    ui.connectionStatus,
    message
  );

}


function setAccountStatus(message) {

  setText(
    ui.accountStatus,
    message
  );

}


function setTradeMessage(message) {

  setText(
    ui.tradeMessage,
    message
  );

}


function setQuoteStatus(message) {

  setText(
    ui.quoteStatus,
    message
  );

}


/* =========================================================
   REQUEST ID
========================================================= */

function nextRequestId() {

  state.requestId += 1;

  return state.requestId;

}


/* =========================================================
   SOCKET SEND
========================================================= */

function send(socket, payload) {

  if (
    !socket ||
    socket.readyState !== WebSocket.OPEN
  ) {

    return false;

  }

  try {

    socket.send(
      JSON.stringify(payload)
    );

    return true;

  } catch (error) {

    console.error(
      "WebSocket send error:",
      error
    );

    return false;

  }

}


/* =========================================================
   CONFIG
========================================================= */

async function loadConfig() {

  try {

    const response =
      await fetch(
        "/api/config",
        {
          cache: "no-store",
          credentials: "same-origin"
        }
      );

    if (!response.ok) {
      throw new Error(
        "Unable to load server configuration."
      );
    }

    state.config =
      await response.json();

    return true;

  } catch (error) {

    console.error(
      "Config error:",
      error
    );

    setConnectionStatus(
      "Server configuration unavailable."
    );

    return false;

  }

}


/* =========================================================
   SESSION CHECK
========================================================= */

async function checkSession() {

  try {

    const response =
      await fetch(
        "/api/session",
        {
          cache: "no-store",
          credentials: "same-origin"
        }
      );

    if (!response.ok) {
      return false;
    }

    const data =
      await response.json();

    state.loggedIn =
      Boolean(data.authenticated);

    return state.loggedIn;

  } catch (error) {

    console.error(
      "Session check error:",
      error
    );

    return false;

  }

}


/* =========================================================
   ACCOUNT
========================================================= */

async function loadAccount() {

  if (!state.loggedIn) {

    setAccountStatus(
      "Log in first"
    );

    setText(
      ui.accountId,
      "--"
    );

    setText(
      ui.balance,
      "--"
    );

    return false;

}
   setAccountStatus(
    "Checking account..."
  );


  try {

    const response =
      await fetch(
        "/api/account",
        {
          cache: "no-store",
          credentials: "same-origin"
        }
      );


    const data =
      await response.json();


    if (
      response.status === 401
    ) {

      state.loggedIn =
        false;

      showLoggedOut();

      return false;

    }


    if (
      !response.ok
    ) {

      throw new Error(
        data.error ||
        "Unable to load account."
      );

    }


    if (!data.account) {

      setAccountStatus(
        "No trading account found"
      );

      return false;

    }


    state.account =
      data.account;


    setAccountStatus(
      "Connected to Deriv ✓"
    );


    setText(
      ui.accountId,
      state.account.account_id ||
      state.account.id ||
      "--"
    );


    setText(
      ui.balance,
      state.account.balance !== null &&
      state.account.balance !== undefined
        ? `${money(state.account.balance)} ${state.account.currency || "USD"}`
        : "--"
    );


    return true;


  } catch (error) {

    console.error(
      "Account error:",
      error
    );

    setAccountStatus(
      "Unable to load account"
    );

    setTradeMessage(
      error.message
    );

    return false;

  }

}


/* =========================================================
   LOGIN / LOGOUT UI
========================================================= */

function showLoggedIn() {

  if (ui.loginBtn) {
    ui.loginBtn.style.display =
      "none";
  }

  if (ui.logoutBtn) {
    ui.logoutBtn.style.display =
      "";
  }

}


function showLoggedOut() {

  if (ui.loginBtn) {
    ui.loginBtn.style.display =
      "";
  }

  if (ui.logoutBtn) {
    ui.logoutBtn.style.display =
      "none";
  }

  setAccountStatus(
    "Log in first"
  );

  setText(
    ui.accountId,
    "--"
  );

  setText(
    ui.balance,
    "--"
  );

  disableBuy(
    "Trading is disabled until the secure account connection is verified."
  );

}


async function logout() {

  try {

    await fetch(
      "/logout",
      {
        method: "POST",
        credentials: "same-origin"
      }
    );

  } catch (error) {

    console.error(
      "Logout error:",
      error
    );

  }


  closeTradingSocket();
  closePublicSocket();


  state.loggedIn =
    false;

  state.account =
    null;

  state.proposal =
    null;

  state.proposalId =
    null;

  state.askPrice =
    0;

  state.payout =
    0;


  showLoggedOut();


  setConnectionStatus(
    "Logged out"
  );

}


/* =========================================================
   PUBLIC MARKET SOCKET
========================================================= */

function getPublicWsUrl() {

  const appId =
    state.config &&
    state.config.app_id;


  if (appId) {

    return (
      PUBLIC_WS_BASE +
      "?app_id=" +
      encodeURIComponent(appId)
    );

  }


  return PUBLIC_WS_BASE;

}


function connectPublicSocket() {

  closePublicSocket();


  let url;

  try {

    url =
      getPublicWsUrl();

    state.publicSocket =
      new WebSocket(url);

  } catch (error) {

    console.error(
      "Public WebSocket error:",
      error
    );

    setConnectionStatus(
      "Unable to open market connection."
    );

    return;

  }


  state.publicSocket.onopen =
    function () {

      state.publicSocketReady =
        true;


      setConnectionStatus(
        state.loggedIn
          ? "Connected to Deriv ✓"
          : "Market feed connected"
      );


      requestMarkets();

    };


  state.publicSocket.onmessage =
    function (event) {

      handlePublicMessage(
        event.data
      );

    };


  state.publicSocket.onerror =
    function (error) {

      console.error(
        "Public WebSocket error:",
        error
      );

      state.publicSocketReady =
        false;


      setConnectionStatus(
        "Market connection error"
      );

    };


  state.publicSocket.onclose =
    function () {

      state.publicSocketReady =
        false;


      if (state.loggedIn) {

        setConnectionStatus(
          "Market connection closed"
        );

      }

    };

}


/* =========================================================
   REQUEST MARKETS
========================================================= */

function requestMarkets() {

  if (
    !state.publicSocketReady
  ) {
    return;
  }


  send(
    state.publicSocket,
    {
      active_symbols: "brief",
      req_id: nextRequestId()
    }
  );

}


/* =========================================================
   HANDLE PUBLIC MESSAGES
========================================================= */

function handlePublicMessage(raw) {

  let data;

  try {

    data =
      JSON.parse(raw);

  } catch (error) {

    console.error(
      "Invalid public message:",
      raw
    );

    return;

  }


  if (data.error) {

    console.error(
      "Public API error:",
      data.error
    );

    setTradeMessage(
      data.error.message ||
      "Market API error."
    );

    return;

  }


  if (
    data.msg_type ===
    "active_symbols"
     ) {

    handleMarkets(
      data.active_symbols ||
      data.echo_req?.active_symbols ||
      []
    );

    return;

  }


  if (
    data.msg_type ===
    "tick"
  ) {

    handleTick(
      data.tick
    );

    return;

  }

}


/* =========================================================
   MARKETS
========================================================= */

function handleMarkets(markets) {

  if (!Array.isArray(markets)) {

    setText(
      ui.marketCount,
      "0 markets loaded"
    );

    setTradeMessage(
      "No markets returned by Deriv."
    );

    return;

  }


  const usableMarkets =
    markets
      .filter(
        market =>
          market &&
          (
            market.underlying_symbol ||
            market.symbol
          )
      )
      .map(
        market => {

          const symbol =
            market.underlying_symbol ||
            market.symbol;


          const name =
            market.underlying_symbol_name ||
            market.display_name ||
            market.name ||
            symbol;


          return {
            symbol,
            name,
            raw: market
          };

        }
      );


  const unique =
    new Map();


  for (
    const market of usableMarkets
  ) {

    if (
      !unique.has(
        market.symbol
      )
    ) {

      unique.set(
        market.symbol,
        market
      );

    }

  }


  state.markets =
    Array.from(
      unique.values()
    );


  setText(
    ui.marketCount,
    `${state.markets.length} markets loaded`
  );


  populateMarketSelect();


  if (
    !state.selectedSymbol &&
    state.markets.length
  ) {

    const preferred =
      state.markets.find(
        market =>
          market.symbol ===
          "1HZ100V"
      );


    selectMarket(
      preferred ||
      state.markets[0]
    );
     }

}


/* =========================================================
   MARKET SELECT
========================================================= */

function populateMarketSelect() {

  if (!ui.marketSelect) {
    return;
  }


  ui.marketSelect.innerHTML =
    "";


  for (
    const market of state.markets
  ) {

    const option =
      document.createElement(
        "option"
      );


    option.value =
      market.symbol;


    option.textContent =
      market.name;


    ui.marketSelect.appendChild(
      option
    );

  }


  if (
    state.selectedSymbol
  ) {

    ui.marketSelect.value =
      state.selectedSymbol;

  }

}


/* =========================================================
   SELECT MARKET
========================================================= */

function selectMarket(market) {

  if (!market) {
    return;
  }


  state.selectedSymbol =
    market.symbol;


  state.selectedMarketName =
    market.name;


  if (ui.marketSelect) {

    ui.marketSelect.value =
      market.symbol;

  }


  setText(
    ui.marketName,
    market.name
  );


  setText(
    ui.livePrice,
    "--"
  );


  setText(
    ui.priceMessage,
    "Waiting for prices..."
  );


  subscribeToPrice();


  requestQuote();

}


/* =========================================================
   PRICE SUBSCRIPTION
========================================================= */

function subscribeToPrice() {

  if (
    !state.publicSocketReady ||
    !state.selectedSymbol
  ) {

    return;

  }


  send(
    state.publicSocket,
    {
      ticks: state.selectedSymbol,
      subscribe: 1,
      req_id: nextRequestId()
    }
  );

}


/* =========================================================
   HANDLE TICK
========================================================= */

function handleTick(tick) {

  if (!tick) {
    return;
  }


  const symbol =
    tick.underlying_symbol ||
    tick.symbol;


  if (
    symbol &&
    state.selectedSymbol &&
    symbol !== state.selectedSymbol
  ) {

    return;

  }


  const quote =
    Number(
      tick.quote
    );


  if (
    !Number.isFinite(quote)
  ) {
     return;

  }


  state.livePrice =
    quote;


  setText(
    ui.livePrice,
    quote
  );
updateLiveChart(quote);

  setText(
    ui.priceMessage,
    "Live price ✓"
  );

}


/* =========================================================
   TRADING SOCKET
========================================================= */

async function connectTradingSocket() {

  if (!state.loggedIn) {

    disableBuy(
      "Log in first."
    );

    return false;

  }


  if (
    state.tradingSocketReady
  ) {

    return true;

  }


  if (
    state.connectingTrading
  ) {

    return false;

  }


  state.connectingTrading =
    true;


  setTradeMessage(
    "Creating secure trading connection..."
  );


  try {

    const response =
      await fetch(
        "/api/trading-connection",
        {
          cache: "no-store",
          credentials: "same-origin"
        }
      );


    const data =
      await response.json();


    if (
      response.status === 401
    ) {

      state.loggedIn =
        false;

      showLoggedOut();

      throw new Error(
         "Deriv authentication expired."
      );

    }


    if (
      !response.ok
    ) {

      throw new Error(
        data.error ||
        "Unable to create trading connection."
      );

    }


    if (!data.ws_url) {

      throw new Error(
        "Deriv did not return a trading WebSocket URL."
      );

    }


    await openTradingSocket(
      data.ws_url
    );


    return true;


  } catch (error) {

    console.error(
      "Trading connection error:",
      error
    );


    setTradeMessage(
      error.message ||
      "Trading connection failed."
    );


    disableBuy(
      "Trading connection is not ready."
    );


    return false;


  } finally {

    state.connectingTrading =
      false;

  }

}


/* =========================================================
   OPEN TRADING SOCKET
========================================================= */

function openTradingSocket(url) {

  return new Promise(
    function (resolve, reject) {

      closeTradingSocket();


      let socket;


      try {

        socket =
          new WebSocket(url);

      } catch (error) {

        reject(error);

        return;

      }


      state.tradingSocket =
        socket;


      let settled =
        false;


      const timeout =
        setTimeout(
          function () {

            if (!settled) {

              settled =
                true;

              try {
                socket.close();
              } catch (_) {}

              reject(
                new Error(
                  "Trading connection timed out."
                )
              );

            }

          },
          15000
        );
       socket.onopen =
        function () {

          state.tradingSocketReady =
            true;


          if (!settled) {

            settled =
              true;

            clearTimeout(
              timeout
            );

            resolve(true);

          }


          setTradeMessage(
            "Secure trading connection ready ✓"
          );


          requestTradingBalance();

          requestQuote();

        };


      socket.onmessage =
        function (event) {

          handleTradingMessage(
            event.data
          );

        };


      socket.onerror =
        function (error) {

          console.error(
            "Trading WebSocket error:",
            error
          );


          state.tradingSocketReady =
            false;


          if (!settled) {

            settled =
              true;

            clearTimeout(
              timeout
            );

           }

        };


      socket.onclose =
        function () {

          state.tradingSocketReady =
            false;

          if (state.loggedIn) {

            disableBuy(
              "Trading connection closed."
            );

          }

        };

    }
  );

}


/* =========================================================
   TRADING BALANCE
========================================================= */

function requestTradingBalance() {

  if (
    !state.tradingSocketReady
  ) {
    return;
  }

  send(
    state.tradingSocket,
    {
      balance: 1,
      subscribe: 1,
      req_id: nextRequestId()
    }
  );

}


/* =========================================================
   HANDLE TRADING MESSAGES
========================================================= */

function handleTradingMessage(raw) {

  let data;

  try {

    data =
      JSON.parse(raw);

  } catch (error) {

    console.error(
      "Invalid trading message:",
      raw
    );

    return;

  }


  if (data.error) {
             console.error(
      "Trading API error:",
      data.error
    );

    setTradeMessage(
      data.error.message ||
      "Deriv trading error."
    );

    state.proposal =
      null;

    state.proposalId =
      null;

    state.askPrice =
      0;

    state.payout =
      0;

    updateQuoteDisplay();

    return;

  }


  switch (
    data.msg_type
  ) {

    case "balance":

      handleBalance(
        data.balance
      );

      break;


    case "proposal":

      handleProposal(
        data.proposal
      );

      break;


    case "buy":

      handleBuy(
        data.buy
      );

      break;


    case "proposal_open_contract":

      handleOpenContract(
        data.proposal_open_contract
      );

      break;


    case "transaction":

      handleTransaction(
        data.transaction
      );

      break;


    default:

      break;

  }

}


/* =========================================================
   BALANCE UPDATE
========================================================= */

function handleBalance(balance) {

  if (!balance) {
    return;
  }


  const value =
    Number(
      balance.balance
    );


  if (
    Number.isFinite(value)
  ) {

    setText(
      ui.balance,
      `${money(value)} ${balance.currency || "USD"}`
    );


    if (state.account) {
      state.account.balance =
        value;

      state.account.currency =
        balance.currency ||
        state.account.currency ||
        "USD";

    }

  }

}


/* =========================================================
   REQUEST QUOTE
========================================================= */

function requestQuote() {

  clearTimeout(
    state.quoteTimer
  );


  state.proposal =
    null;

  state.proposalId =
    null;

  state.askPrice =
    0;

  state.payout =
    0;


  updateQuoteDisplay();


  if (
    !state.selectedSymbol
  ) {

    setQuoteStatus(
      "Select a market."
    );

    return;

  }


  const amount =
    getAmount();


  const duration =
    getDuration();


  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
     setQuoteStatus(
      "Enter a valid trade amount."
    );

    return;

  }


  if (
    !Number.isInteger(duration) ||
    duration <= 0
  ) {

    setQuoteStatus(
      "Enter a valid duration."
    );

    return;

  }


  if (
    !state.tradingSocketReady
  ) {

    setQuoteStatus(
      "Connecting secure trading account..."
    );

    connectTradingSocket();

    return;

  }


  const contractType =
    state.direction === "RISE"
      ? "CALL"
      : "PUT";


  setQuoteStatus(
    "Requesting quote..."
  );


  send(
    state.tradingSocket,
    {
      proposal: 1,
      amount,
      basis: "stake",
      contract_type:
        contractType,
      currency: "USD",
      duration,
      duration_unit:
        state.durationUnit,
      underlying_symbol:
        state.selectedSymbol,
      req_id:
        nextRequestId()
    }
  );


  state.quoteTimer =
    setTimeout(
      function () {

        if (
          !state.proposalId
        ) {

          setQuoteStatus(
            "Quote timed out. Try again."
          );

        }

      },
      10000
    );

}


/* =========================================================
   HANDLE PROPOSAL
========================================================= */

function handleProposal(proposal) {

  if (!proposal) {
    return;
  }


  clearTimeout(
    state.quoteTimer
  );


  state.proposal =
    proposal;


  state.proposalId =
    proposal.id ||
    proposal.proposal_id ||
    null;


  state.askPrice =
    Number(
      proposal.ask_price ??
      proposal.price ??
      proposal.display_value ??
      0
    );


  state.payout =
    Number(
      proposal.payout ??
      0
    );


  updateQuoteDisplay();


  if (
    state.proposalId &&
    state.askPrice > 0
  ) {

    setQuoteStatus(
      "Quote received ✓"
    );

    enableBuy();

  } else {

    setQuoteStatus(
      "Quote received but is incomplete."
    );

    disableBuy(
      "Waiting for a valid quote."
    );

  }

}


/* =========================================================
   QUOTE DISPLAY
========================================================= */

function updateQuoteDisplay() {

  setText(
    ui.askPrice,
    state.askPrice > 0
      ? money(state.askPrice)
      : "--"
  );


  setText(
    ui.payout,
    state.payout > 0
      ? money(state.payout)
      : "--"
  );

}


/* =========================================================
   BUY BUTTON
========================================================= */

function enableBuy() {

  if (!ui.buyBtn) {
    return;
  }


  if (
    !state.loggedIn ||
    !state.tradingSocketReady ||
    !state.proposalId ||
    !state.askPrice
  ) {

    return;

  }


  ui.buyBtn.disabled =
    false;


  ui.buyBtn.textContent =
    "CONFIRM BUY";

}


function disableBuy(message) {

  if (ui.buyBtn) {

    ui.buyBtn.disabled =
      true;

    ui.buyBtn.textContent =
      "CONFIRM BUY";

  }


  if (message) {

    setTradeMessage(
      message
    );

  }

}


/* =========================================================
   GET AMOUNT
========================================================= */

function getAmount() {

  const value =
    Number(
      ui.amount
        ? ui.amount.value
        : state.amount
    );

  return value;

}


/* =========================================================
   GET DURATION
========================================================= */

function getDuration() {

  const value =
    Number(
      ui.duration
        ? ui.duration.value
        : state.duration
    );

  return value;

}


/* =========================================================
   EXECUTE BUY
========================================================= */

async function executeBuy() {

  if (!state.loggedIn) {

    setTradeMessage(
      "Please log in with Deriv first."
    );

    return;

  }


  if (
    !state.tradingSocketReady
  ) {

    setTradeMessage(
      "Secure trading connection is not ready."
    );

    return;

  }


  if (!state.proposalId) {

    setTradeMessage(
      "No valid quote is available."
    );

    return;

  }


  if (
    !state.askPrice ||
    state.askPrice <= 0
  ) {

    setTradeMessage(
      "Invalid quote price."
    );

    return;

  }


  const amount =
    getAmount();


  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {

    setTradeMessage(
      "Enter a valid trade amount."
    );

    return;

  }


  const confirmed =
    window.confirm(
      `Confirm ${state.direction} trade?\n\n` +
      `Market: ${state.selectedMarketName}\n` +
      `Amount: ${money(amount)} USD\n` +
      `Ask price: ${money(state.askPrice)} USD\n` +
      `Payout: ${money(state.payout)} USD`
    );


 if (!confirmed) {
  showStatus("Trade cancelled.");
  return;
}

ui.buyBtn.disabled = true;

  ui.buyBtn.textContent =
    "BUYING...";


  setTradeMessage(
    "Submitting buy request..."
  );


  const sent =
    send(
      state.tradingSocket,
      {
        buy:
          String(
            state.proposalId
          ),

        price:
          state.askPrice,

        req_id:
          nextRequestId()
      }
    );


  if (!sent) {

    ui.buyBtn.disabled =
      false;

    ui.buyBtn.textContent =
      "CONFIRM BUY";

    setTradeMessage(
      "Unable to send buy request."
    );

    return;

  }

}


/* =========================================================
   HANDLE BUY RESPONSE
========================================================= */

function handleBuy(buy) {

  if (!buy) {

    setTradeMessage(
      "Buy request returned no contract."
    );

    enableBuy();

    return;

  }


  const contractId =
    buy.contract_id ||
    buy.id ||
    null;


  const buyPrice =
    Number(
      buy.buy_price ??
      buy.price ??
      state.askPrice
    );


  const payout =
    Number(
      buy.payout ??
      state.payout ??
      0
    );


  if (!contractId) {

    setTradeMessage(
      "Buy response did not contain a contract ID."
    );

    enableBuy();

    return;

  }


  const contract = {

    contract_id:
      String(contractId),

    symbol:
      state.selectedSymbol,

    symbol_name:
      state.selectedMarketName,

    direction:
      state.direction,

    contract_type:
      state.direction === "RISE"
        ? "CALL"
        : "PUT",

    buy_price:
      buyPrice,

    payout,

    profit:
      null,

    status:
      "open",

    start_time:
      Date.now()

  };


  state.activeContracts.set(
    String(contractId),
    contract
  );


  setTradeMessage(
    `Trade opened ✓ Contract ${contractId}`
  );
   renderOpenContracts();


  subscribeContract(
    contractId
  );


  updatePerformance();


  requestTradingBalance();


  state.proposal =
    null;

  state.proposalId =
    null;

  state.askPrice =
    0;

  state.payout =
    0;


  updateQuoteDisplay();


  disableBuy(
    "Trade opened. Waiting for result..."
  );


  setQuoteStatus(
    "Trade opened ✓"
  );

}


/* =========================================================
   SUBSCRIBE CONTRACT
========================================================= */

function subscribeContract(
  contractId
) {

  if (
    !state.tradingSocketReady
  ) {
    return;
  }


  send(
    state.tradingSocket,
    {
      proposal_open_contract: 1,
      contract_id:
        String(contractId),
      subscribe: 1,
      req_id:
        nextRequestId()
    }
  );

}


/* =========================================================
   HANDLE OPEN CONTRACT
========================================================= */

function handleOpenContract(contract) {

  if (!contract) {
    return;
  }


  const contractId =
    String(
      contract.contract_id ||
      contract.id ||
      ""
    );


  if (!contractId) {
    return;
  }


  let local =
    state.activeContracts.get(
      contractId
    );


  if (!local) {

    local = {

      contract_id:
        contractId,

      symbol:
        contract.underlying_symbol ||
        contract.symbol ||
        state.selectedSymbol,

      symbol_name:
        contract.underlying_symbol_name ||
        state.selectedMarketName,

      direction:
        contract.contract_type === "PUT"
          ? "FALL"
          : "RISE",

      contract_type:
        contract.contract_type ||
        "",

      buy_price:
        Number(
          contract.buy_price ||
          contract.purchase_price ||
          0
        ),

      payout:
        Number(
          contract.payout ||
          0
        ),

      profit:
        contract.profit !== undefined
          ? Number(contract.profit)
          : null,

      status:
        contract.status ||
        "open"

    };

  }


  Object.assign(
    local,
    {

      symbol:
        contract.underlying_symbol ||
        contract.symbol ||
        local.symbol,

      symbol_name:
        contract.underlying_symbol_name ||
        local.symbol_name,

      buy_price:
        Number(
          contract.buy_price ??
          local.buy_price ??
          0
        ),

      payout:
        Number(
          contract.payout ??
          local.payout ??
          0
        ),

      profit:
        contract.profit !== undefined &&
        contract.profit !== null
          ? Number(contract.profit)
          : local.profit,

      status:
        contract.status ||
        local.status ||
        "open",

      current_spot:
        contract.current_spot ??
        local.current_spot,

      entry_spot:
        contract.entry_tick ??
        contract.entry_spot ??
        local.entry_spot,

      exit_spot:
        contract.exit_tick ??
        contract.exit_spot ??
        local.exit_spot

    }
  );


  if (
    contractIsFinished(
      local
    )
  ) {

    finishContract(
      local
    );

  } else {

    state.activeContracts.set(
      contractId,
      local
    );

    renderOpenContracts();

  }

}


/* =========================================================
   CONTRACT FINISHED CHECK
========================================================= */

function contractIsFinished(contract) {

  if (!contract) {
    return false;
  }


  const status =
    String(
      contract.status ||
      ""
    ).toLowerCase();


  return (
    status === "sold" ||
    status === "won" ||
    status === "lost" ||
    status === "expired" ||
    (
      contract.profit !== null &&
      contract.profit !== undefined
    )
  );

}


/* =========================================================
   FINISH CONTRACT
========================================================= */

function finishContract(contract) {

  const id =
    String(
      contract.contract_id
    );


  state.activeContracts.delete(
    id
  );


  if (
    state.finishedContracts.has(
      id
    )
  ) {

    return;

  }


  state.finishedContracts.set(
    id,
    contract
  );


  const profit =
    Number(
      contract.profit
    );


  if (
    Number.isFinite(profit)
  ) {

    state.performance.profit +=
      profit;


    if (profit > 0) {

      state.performance.wins +=
        1;

    } else if (profit < 0) {

      state.performance.losses +=
        1;
       }

  }


  renderOpenContracts();
  renderTradeHistory();
  updatePerformance();


  const status =
    String(
      contract.status ||
      ""
    ).toLowerCase();


  if (
    profit > 0 ||
    status === "won"
  ) {

    setTradeMessage(
      `Trade won ✓ Profit ${money(profit)} USD`
    );

  } else if (
    profit < 0 ||
    status === "lost"
  ) {

    setTradeMessage(
      `Trade lost. Result ${money(profit)} USD`
    );

  } else {

    setTradeMessage(
      `Trade finished. Result ${money(profit)} USD`
    );

  }


  requestTradingBalance();


  setTimeout(
    function () {

      if (
        state.tradingSocketReady
      ) {

        requestQuote();

      }

    },
    500
  );

}


/* =========================================================
   OPEN CONTRACTS DISPLAY
========================================================= */

function renderOpenContracts() {

  if (!ui.openContracts) {
    return;
  }


  ui.openContracts.innerHTML =
    "";


  if (
    state.activeContracts.size ===
    0
  ) {

    const empty =
      document.createElement(
        "div"
      );


    empty.className =
      "empty-state";


    empty.textContent =
      "No open contracts.";


    ui.openContracts.appendChild(
      empty
    );


    return;

  }


  for (
    const contract of
    state.activeContracts.values()
  ) {

    const box =
      document.createElement(
        "div"
      );


    box.className =
      "open-contract";


    const title =
      document.createElement(
        "strong"
      );
     title.textContent =
      contract.symbol_name ||
      contract.symbol ||
      "Contract";


    const details =
      document.createElement(
        "div"
      );


    details.textContent =
      `${contract.direction || ""} • ` +
      `Stake ${money(contract.buy_price)} USD`;


    const result =
      document.createElement(
        "div"
      );


    const currentProfit =
      contract.profit;


    result.textContent =
      currentProfit !== null &&
      currentProfit !== undefined
        ? `Profit: ${money(currentProfit)} USD`
        : "Trade in progress...";


    box.appendChild(
      title
    );


    box.appendChild(
      details
    );


    box.appendChild(
      result
    );


    ui.openContracts.appendChild(
      box
    );

  }

}


/* =========================================================
   TRADE HISTORY
========================================================= */

function renderTradeHistory() {

  if (!ui.tradeHistory) {
    return;
  }


  ui.tradeHistory.innerHTML =
    "";


  if (
    state.finishedContracts.size ===
    0
  ) {

    const empty =
      document.createElement(
        "div"
      );


    empty.className =
      "empty-state";


    empty.textContent =
      "No verified results yet.";


    ui.tradeHistory.appendChild(
      empty
    );


    return;

  }


  const contracts =
    Array.from(
      state.finishedContracts.values()
    ).reverse();


  for (
    const contract of contracts
  ) {

    const row =
      document.createElement(
        "div"
      );


    row.className =
      "trade-history-row";


    const title =
      document.createElement(
        "strong"
      );


    title.textContent =
      contract.symbol_name ||
      contract.symbol ||
      "Contract";


    const details =
      document.createElement(
        "div"
      );


    details.textContent =
      `${contract.direction || ""} • ` +
      `Contract ${contract.contract_id}`;


    const profit =
      document.createElement(
        "div"
      );


    const value =
      Number(
        contract.profit
      );


    profit.textContent =
      Number.isFinite(value)
        ? `Result: ${money(value)} USD`
        : "Result unavailable";


    row.appendChild(
      title
    );


    row.appendChild(
      details
    );


    row.appendChild(
      profit
    );


    ui.tradeHistory.appendChild(
      row
    );

  }

}


/* =========================================================
   PERFORMANCE
========================================================= */

function updatePerformance() {

  setText(
    ui.wins,
    state.performance.wins
  );


  setText(
    ui.losses,
    state.performance.losses
  );


  setText(
    ui.totalProfit,
    money(
      state.performance.profit
    )
  );

                     }
       /* =========================================================
   TRANSACTIONS
========================================================= */

function handleTransaction(transaction) {

  if (!transaction) {
    return;
  }


  if (
    transaction.action ===
    "buy"
  ) {

    requestTradingBalance();

  }

}


/* =========================================================
   DIRECTION
========================================================= */

function setDirection(direction) {

  if (
    direction !== "RISE" &&
    direction !== "FALL"
  ) {

    return;

  }


  state.direction =
    direction;


  if (ui.riseBtn) {

    ui.riseBtn.classList.toggle(
      "active",
      direction === "RISE"
    );

  }


  if (ui.fallBtn) {

    ui.fallBtn.classList.toggle(
      "active",
      direction === "FALL"
    );

  }


  requestQuote();

}


/* =========================================================
   INPUT EVENTS
========================================================= */

function setupInputs() {
  
if (ui.accountType) {
  ui.accountType.addEventListener(
    "change",
    async function () {

      const selectedType =
        ui.accountType.value;

      if (
        ui.accountTypeMessage
      ) {
        ui.accountTypeMessage.textContent =
          "Switching account...";
      }

      try {
        const response =
          await fetch(
            "/api/account-type",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json"
              },

              credentials:
                "same-origin",

              body: JSON.stringify({
                account_type:
                  selectedType
              })
            }
          );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
            "Unable to switch account."
          );
        }

        state.accountType =
          selectedType;

        state.account =
          data.account ||
          null;

        if (
          ui.accountTypeMessage
        ) {
          ui.accountTypeMessage.textContent =
            selectedType === "demo"
              ? "Demo Account selected ✓"
              : "Real Account selected ✓";
        }

        setText(
          ui.accountId,
          data.account?.id ||
          data.account?.account_id ||
          "--"
        );

        if (
          data.account?.balance !==
            null &&
          data.account?.balance !==
            undefined
        ) {
          setText(
            ui.balance,
            `${money(data.account.balance)} ${
              data.account.currency ||
              "USD"
            }`
          );
        }

        closeTradingSocket();

        if (
          state.loggedIn
        ) {
          await connectTradingSocket();
        }

      } catch (error) {

        console.error(
          "Account switch error:",
          error
        );

        if (
          ui.accountTypeMessage
        ) {
          ui.accountTypeMessage.textContent =
            error.message ||
            "Unable to switch account.";
        }

        /*
          Keep Demo selected if the
          requested account could not
          be activated.
        */

        ui.accountType.value =
          state.accountType ||
          "demo";
      }

    }
  );
}

  if (ui.marketSelect) {

    ui.marketSelect.addEventListener(
      "change",
      function () {

        const market =
          state.markets.find(
            item =>
              item.symbol ===
              ui.marketSelect.value
          );


        if (market) {

          selectMarket(
            market
          );

        }

              }

    );

  }


  if (ui.amount) {

    ui.amount.addEventListener(
      "input",
      function () {

        state.amount =
          Number(
            ui.amount.value
          );

        requestQuote();

      }
    );


    ui.amount.addEventListener(
      "change",
      requestQuote
    );

  }


  if (ui.duration) {

    ui.duration.addEventListener(
      "input",
      function () {

        state.duration =
          Number(
            ui.duration.value
          );

        requestQuote();

      }
    );


    ui.duration.addEventListener(
      "change",
      requestQuote
    );

  }


  if (ui.riseBtn) {

    ui.riseBtn.addEventListener(
      "click",
      function () {

        setDirection(
          "RISE"
        );

      }
    );

  }


  if (ui.fallBtn) {

    ui.fallBtn.addEventListener(
      "click",
      function () {

        setDirection(
          "FALL"
        );

      }
    );

  }


  if (ui.buyBtn) {

    ui.buyBtn.addEventListener(
      "click",
      executeBuy
    );

  }


  if (ui.logoutBtn) {
  ui.logoutBtn.addEventListener(
      "click",
      logout
    );

  }


  if (ui.loginBtn) {

    ui.loginBtn.addEventListener(
      "click",
      function () {

        window.location.href =
          "/login";

      }
    );

  }

}


/* =========================================================
   CLOSE SOCKETS
========================================================= */

function closePublicSocket() {

  if (
    state.publicSocket
  ) {

    try {

      state.publicSocket.close();

    } catch (_) {}

  }


  state.publicSocket =
    null;


  state.publicSocketReady =
    false;

}


function closeTradingSocket() {

  if (
    state.tradingSocket
  ) {

    try {

      state.tradingSocket.close();

    } catch (_) {}

  }


  state.tradingSocket =
    null;


  state.tradingSocketReady =
    false;

}


/* =========================================================
   INITIALIZE
========================================================= */

async function initialize() {

  cacheUI();

  setupInputs();

  updatePerformance();


  setConnectionStatus(
    "Connecting..."
  );


  disableBuy(
    "Trading is disabled until the secure account connection is verified."
  );


  const configLoaded =
    await loadConfig();


  if (!configLoaded) {
    return;
  }


  const loggedIn =
    await checkSession();


  if (loggedIn) {

    showLoggedIn();


    setConnectionStatus(
      "Connecting to Deriv..."
    );


    await loadAccount();


    connectPublicSocket();


    await connectTradingSocket();

  } else {

    showLoggedOut();


    connectPublicSocket();

  }

}


/* =========================================================
   START
========================================================= */

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    initialize
  );

} else {

  initialize();

}

    
