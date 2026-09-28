"use strict";

const state = {
  socket: null,
  markets: [],
  selectedSymbol: "",
  selectedContract: "",
  quoteRequest: null,
  priceRequest: null,
  reqId: 1,
  prices: [],
  connected: false
};

const $ = (id) => document.getElementById(id);

function nextReqId() {
  return state.reqId++;
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function showStatus(message) {
  setText("connectionStatus", message);
}

function connectDeriv() {
  showStatus("Connecting to Deriv...");

  const appId = window.TRADING_CONFIG?.APP_ID;

  if (!appId) {
    showStatus("Deriv app ID is missing.");
    return;
  }

  const url =
    "wss://api.derivws.com/trading/v1/options/ws/public?app_id=" +
    encodeURIComponent(appId);

  state.socket = new WebSocket(url);

  state.socket.onopen = () => {
    state.connected = true;
    showStatus("Connected to Deriv ✓");

    requestMarkets();
  };

  state.socket.onmessage = (event) => {
    let data;

    try {
      data = JSON.parse(event.data);
    } catch (error) {
      console.error("Invalid Deriv message:", error);
      return;
    }

    handleMessage(data);
  };

  state.socket.onerror = () => {
    state.connected = false;
    showStatus("Unable to connect to Deriv.");
  };

  state.socket.onclose = () => {
    state.connected = false;
    showStatus("Disconnected from Deriv.");
  };
}

function send(data) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  state.socket.send(JSON.stringify(data));
  return true;
}

function requestMarkets() {
  setText("marketsStatus", "Loading markets...");

  send({
    active_symbols: "brief",
    req_id: nextReqId()
  });
}

function handleMessage(data) {
  if (data.error) {
    console.error("Deriv error:", data.error);

    if (data.req_id === state.quoteRequest) {
      setText(
        "quoteStatus",
        data.error.message || "Unable to get quote."
      );
    }

    return;
  }

  if (data.msg_type === "active_symbols") {
    handleMarkets(data);
    return;
  }

  if (data.msg_type === "tick") {
    handleTick(data);
    return;
  }

  /*
   * DEMO QUOTE
   */
  if (
    data.msg_type === "proposal" &&
    data.req_id === state.quoteRequest
  ) {
    handleProposal(data);
    return;
  }

  if (data.msg_type === "history") {
    handleHistory(data);
    return;
  }
}

function handleMarkets(data) {
  if (!Array.isArray(data.active_symbols)) {
    setText("marketsStatus", "No markets returned by Deriv.");
    return;
  }

  state.markets = data.active_symbols.filter((market) => {
    return market && market.symbol && market.display_name;
  });

  setText(
    "marketsStatus",
    state.markets.length + " markets loaded"
  );

  populateMarketSelect();

  if (state.markets.length > 0) {
    const preferred =
      state.markets.find(
        (market) =>
          market.symbol === "1HZ100V"
      ) || state.markets[0];

    state.selectedSymbol = preferred.symbol;

    const select = $("marketSelect");

    if (select) {
      select.value = preferred.symbol;
    }

    setText(
      "selectedMarket",
      preferred.display_name || preferred.symbol
    );

    subscribeToMarket(preferred.symbol);
  }
}

function populateMarketSelect() {
  const select = $("marketSelect");

  if (!select) return;

  select.innerHTML = "";

  state.markets.forEach((market) => {
    const option = document.createElement("option");

    option.value = market.symbol;
    option.textContent =
      market.display_name + " (" + market.symbol + ")";

    select.appendChild(option);
  });

  select.addEventListener("change", () => {
    const symbol = select.value;

    const market = state.markets.find(
      (item) => item.symbol === symbol
    );

    if (!market) return;

    state.selectedSymbol = symbol;

    setText(
      "selectedMarket",
      market.display_name || symbol
    );

    state.prices = [];

    subscribeToMarket(symbol);
  });
}

function subscribeToMarket(symbol) {
  if (!symbol) return;

  send({
    forget_all: "ticks",
    req_id: nextReqId()
  });

  send({
    ticks: symbol,
    subscribe: 1,
    req_id: nextReqId()
  });

  requestHistory(symbol);
}

function requestHistory(symbol) {
  send({
    ticks_history: symbol,
    count: 50,
    end: "latest",
    start: 1,
    style: "ticks",
    req_id: nextReqId()
  });
}

function handleHistory(data) {
  if (!data.history) return;

  const prices = data.history.prices;

  if (!Array.isArray(prices)) return;

  state.prices = prices.map(Number).filter(Number.isFinite);

  updateChart();
}

function handleTick(data) {
  if (!data.tick) return;

  const tick = data.tick;

  if (tick.symbol !== state.selectedSymbol) {
    return;
  }

  const price = Number(tick.quote);

  if (!Number.isFinite(price)) return;

  setText("livePrice", price);

  state.prices.push(price);

  if (state.prices.length > 50) {
    state.prices.shift();
  }

  updateChart();
}

function updateChart() {
  const canvas = $("priceChart");

  if (!canvas || state.prices.length < 2) {
    return;
  }

  const ctx = canvas.getContext("2d");

  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);

  const min = Math.min(...state.prices);
  const max = Math.max(...state.prices);

  const range = max - min || 1;

  ctx.beginPath();

  state.prices.forEach((price, index) => {
    const x =
      (index / (state.prices.length - 1)) *
      width;

    const y =
      height -
      ((price - min) / range) *
        (height - 20) -
      10;

    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.stroke();
}

function requestQuote(contractType) {
  if (!state.selectedSymbol) {
    setText("quoteStatus", "Select a market first.");
    return;
  }

  const amountInput = $("tradeAmount");
  const durationInput = $("duration");

  const amount = Number(
    amountInput ? amountInput.value : 1
  );

  const duration = Number(
    durationInput ? durationInput.value : 15
  );

  if (!Number.isFinite(amount) || amount <= 0) {
    setText("quoteStatus", "Enter a valid trade amount.");
    return;
  }

  if (!Number.isInteger(duration) || duration <= 0) {
    setText("quoteStatus", "Enter a valid duration.");
    return;
  }

  state.selectedContract = contractType;

  state.quoteRequest = nextReqId();

  setText("quoteStatus", "Requesting quote...");

  const proposal = {
    proposal: 1,
    amount: amount,
    basis: "stake",
    contract_type: contractType,
    currency: "USD",
    duration: duration,
    duration_unit: "t",
    symbol: state.selectedSymbol,
    req_id: state.quoteRequest
  };

  send(proposal);
}

function handleProposal(data) {
  const proposal = data.proposal;

  if (!proposal) {
    setText("quoteStatus", "No quote received.");
    return;
  }

  setText("quoteStatus", "Quote received ✓");

  const askPrice =
    proposal.ask_price !== undefined
      ? proposal.ask_price
      : "--";

  const payout =
    proposal.payout !== undefined
      ? proposal.payout
      : "--";

  setText("askPrice", askPrice);
  setText("payout", payout);
}

function setupTradeButtons() {
  const riseButton = $("riseButton");
  const fallButton = $("fallButton");

  if (riseButton) {
    riseButton.addEventListener("click", () => {
      requestQuote("CALL");
    });
  }

  if (fallButton) {
    fallButton.addEventListener("click", () => {
      requestQuote("PUT");
    });
  }
}

function setupLoginButton() {
  const loginButton = $("loginButton");

  if (!loginButton) return;

  loginButton.addEventListener("click", () => {
    window.location.href = "/login";
  });
}

function setupLogoutButton() {
  const logoutButton = $("logoutButton");

  if (!logoutButton) return;

  logoutButton.addEventListener("click", async () => {
    try {
      await fetch("/logout", {
        method: "POST"
      });
    } catch (error) {
      console.error("Logout error:", error);
    }

    window.location.reload();
  });
}

async function checkAccount() {
  try {
    const response = await fetch("/account-status");

    const data = await response.json();

    if (!response.ok || !data.connected) {
      setText("accountStatus", "Log in first");
      setText("balance", "--");
      return;
    }

    setText("accountStatus", "Connected to Deriv ✓");

    if (data.loginid) {
      setText("loginid", data.loginid);
    }

    if (
      data.balance !== undefined &&
      data.currency
    ) {
      setText(
        "balance",
        Number(data.balance).toFixed(2) +
          " " +
          data.currency
      );
    }
  } catch (error) {
    console.error("Account status error:", error);

    setText("accountStatus", "Unable to check account.");
    setText("balance", "--");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupTradeButtons();
  setupLoginButton();
  setupLogoutButton();

  checkAccount();
  connectDeriv();
});
