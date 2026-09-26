
"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const el = id => document.getElementById(id);

  const API =
    "wss://api.derivws.com/trading/v1/options/ws/public";

  const APP_ID = "34qPaViEQZZw84Mc5thoO";

  const fields = {
    connectionStatus: el("connectionStatus"),
    marketSelect: el("marketSelect"),
    marketStatus: el("marketStatus"),
    selectedMarket: el("selectedMarket"),
    livePrice: el("livePrice"),
    chartPrice: el("chartPrice"),
    lastUpdate: el("lastUpdate"),
    quoteStatus: el("quoteStatus"),
    askPrice: el("askPrice"),
    potentialPayout: el("potentialPayout"),
    tradeStatus: el("tradeStatus"),
    accountStatus: el("accountStatus"),
    balance: el("balance")
  };

  const loginButton = el("loginButton");
  const riseButton = el("riseButton");
  const fallButton = el("fallButton");
  const buyButton =
    el("buyButton") || el("confirmBuy");
  const amountInput = el("tradeAmount");
  const durationInput = el("duration");
  const canvas = el("chart");

  let socket;
  let currentSymbol = "";
  let currentPrice = null;
  let selectedContract = null;
  let latestProposal = null;
  let quoteRequestId = 30;
  let reconnectTimer;
  let tickHistory = [];

  function show(name, value) {
    const node = fields[name];
    if (!node) return;

    // Support HTML that already contains a label.
    const label = node.dataset.label ||
      node.getAttribute("data-label");

    node.textContent = label
      ? value
      : value;
  }

  function displayValue(name, value, prefix) {
    const node = fields[name];
    if (!node) return;

    const text = String(value);

function displayValue(name, value, prefix = "") {
  const node = fields[name];
  if (!node) return;

  const separateLabels = [
    "balance",
    "selectedMarket",
    "askPrice",
    "potentialPayout"
  ];

  node.textContent = separateLabels.includes(name)
    ? String(value)
    : prefix + String(value);
}


    if (existingLabel) {
      node.textContent = text;
    } else {
      node.textContent = prefix
        ? prefix + text
        : text;
    }
  }

  function money(value, currency = "USD") {
    const number = Number(value);

    if (!Number.isFinite(number)) return "--";

    return number.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + " " + currency;
  }

  function resetQuote() {
    latestProposal = null;
    displayValue("askPrice", "--", "Ask Price: ");
    displayValue(
      "potentialPayout",
      "--",
      "Potential Payout: "
    );
    displayValue(
      "quoteStatus",
      "Waiting...",
      "Quote: "
    );
  }

  // Purchasing requires a separate authenticated
  // trading endpoint. Never simulate a purchase.
  if (buyButton) {
    buyButton.disabled = true;
    buyButton.title =
      "Authenticated purchase is not configured.";
  }

  function send(message) {
    if (!socket ||
        socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify(message));
    return true;
  }

  function connect() {
    clearTimeout(reconnectTimer);

    displayValue(
      "connectionStatus",
      "Connecting to Deriv..."
    );

    socket = new WebSocket(
      API + "?app_id=" + encodeURIComponent(APP_ID)
    );

    socket.onopen = () => {
      displayValue(
        "connectionStatus",
        "Connected to Deriv ✓"
      );

      send({
        active_symbols: "brief",
        req_id: 1
      });
    };

    socket.onmessage = event => {
      let data;

      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (data.error) {
        console.error("Deriv API:", data.error);

        const message =
          data.error.message || "Unknown API error";

        if (data.req_id === 2) {
          displayValue(
            "livePrice",
            "Price unavailable"
          );
        } else {
          displayValue("tradeStatus", message);
          displayValue(
            "quoteStatus",
            "Error",
            "Quote: "
          );
        }
        return;
      }

      if (data.msg_type === "active_symbols") {
        const markets = data.active_symbols || [];
        const select = fields.marketSelect;

        displayValue(
          "marketStatus",
          markets.length + " markets loaded"
        );

        if (!select || !markets.length) return;

        select.replaceChildren();

        for (const market of markets) {
          const option =
            document.createElement("option");

          option.value = market.symbol;
          option.textContent =
            market.display_name || market.symbol;

          select.appendChild(option);
        }

        const preferred = markets.find(m =>
          m.symbol === "1HZ100V"
        );

        if (preferred) {
          select.value = preferred.symbol;
        }

        selectMarket(select.value);
        return;
      }

      if (data.msg_type === "tick") {
        const tick = data.tick;
        if (!tick) return;

        if (tick.symbol &&
            tick.symbol !== currentSymbol) {
          return;
        }

        const price = Number(tick.quote);
        if (!Number.isFinite(price)) return;

        currentPrice = price;
        tickHistory.push(price);

        if (tickHistory.length > 100) {
          tickHistory.shift();
        }

        const formatted = String(tick.quote);

        displayValue(
          "livePrice",
          formatted,
          "Live Price: "
        );

        displayValue(
          "chartPrice",
          formatted,
          "Current Price: "
        );

        displayValue(
          "lastUpdate",
          new Date().toLocaleTimeString(),
          "Last update: "
        );

        drawChart();
        return;
      }

      if (data.msg_type === "proposal") {
        if (data.req_id !== quoteRequestId) {
          return;
        }

        const proposal = data.proposal;
        if (!proposal) return;

        latestProposal = proposal;

        displayValue(
          "askPrice",
          money(proposal.ask_price),
          "Ask Price: "
        );

        displayValue(
          "potentialPayout",
          money(proposal.payout),
          "Potential Payout: "
        );

        displayValue(
          "quoteStatus",
          "Received ✓",
          "Quote: "
        );

        displayValue(
          "tradeStatus",
          "Quote received. Purchase is disabled."
        );
      }
    };

    socket.onerror = () => {
      displayValue(
        "connectionStatus",
        "Connection error"
      );
    };

    socket.onclose = () => {
      displayValue(
        "connectionStatus",
        "Disconnected. Reconnecting..."
      );

      reconnectTimer = setTimeout(connect, 3000);
    };
  }

  function selectMarket(symbol) {
    if (!symbol) return;

    currentSymbol = symbol;
    currentPrice = null;
    tickHistory = [];
    resetQuote();

    const select = fields.marketSelect;
    const name =
      select?.selectedOptions?.[0]?.textContent ||
      symbol;

    displayValue(
      "selectedMarket",
      name,
      "Selected market: "
    );

    displayValue("livePrice", "--", "Live Price: ");
    displayValue(
      "chartPrice",
      "--",
      "Current Price: "
    );

    send({ forget_all: "ticks" });

    send({
      ticks: symbol,
      subscribe: 1,
      req_id: 2
    });

    drawChart();
  }

  fields.marketSelect?.addEventListener(
    "change",
    event => selectMarket(event.target.value)
  );

  function requestQuote(contractType) {
    if (!currentSymbol) {
      displayValue(
        "tradeStatus",
        "Select a market first."
      );
      return;
    }

    const amount = Number(amountInput?.value);
    const ticks = Number(durationInput?.value);

    if (!Number.isFinite(amount) || amount <= 0) {
      displayValue(
        "tradeStatus",
        "Enter a valid trade amount."
      );
      return;
    }

    if (!Number.isInteger(ticks) || ticks < 1) {
      displayValue(
        "tradeStatus",
        "Enter a valid tick duration."
      );
      return;
    }

    selectedContract = contractType;
    resetQuote();
    quoteRequestId++;

    displayValue(
      "quoteStatus",
      "Requesting...",
      "Quote: "
    );

    const sent = send({
      proposal: 1,
      amount: amount,
      basis: "stake",
      contract_type: selectedContract,
      currency: "USD",
      duration: ticks,
      duration_unit: "t",
      symbol: currentSymbol,
      req_id: quoteRequestId
    });

    if (!sent) {
      displayValue(
        "tradeStatus",
        "Waiting for market connection."
      );
    }
  }

  riseButton?.addEventListener(
    "click",
    () => requestQuote("CALL")
  );

  fallButton?.addEventListener(
    "click",
    () => requestQuote("PUT")
  );

  amountInput?.addEventListener(
    "change",
    resetQuote
  );

  durationInput?.addEventListener(
    "change",
    resetQuote
  );

  function drawChart() {
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (tickHistory.length < 2) return;

    const minimum = Math.min(...tickHistory);
    const maximum = Math.max(...tickHistory);
    const range = maximum - minimum || 1;
    const padding = 12;

    ctx.beginPath();
    ctx.strokeStyle = "#16a34a";
    ctx.lineWidth = 2;

    tickHistory.forEach((price, index) => {
      const x =
        index / (tickHistory.length - 1) * width;

      const y =
        height - padding -
        (price - minimum) / range *
        (height - padding * 2);

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();
  }

  async function checkAccount() {
    try {
      const response = await fetch("/api/account", {
        credentials: "same-origin",
        cache: "no-store"
      });

      const result = await response.json();

      if (!response.ok) {
        displayValue(
          "accountStatus",
          "Unable to retrieve account"
        );
        displayValue("balance", "--", "Balance: ");
        return;
      }

      if (!result.connected) {
        displayValue(
          "accountStatus",
          "Not connected",
          "Account: "
        );
        displayValue("balance", "--", "Balance: ");
        return;
      }

      displayValue(
        "accountStatus",
        "Connected ✓",
        "Account: "
      );

      if (loginButton) {
        loginButton.textContent = "LOGGED IN ✓";
        loginButton.disabled = true;
      }

      // Deriv's REST response usually wraps the
      // accounts array inside its data property.
      const payload = result.data;

      const accounts = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.accounts)
            ? payload.accounts
            : [];

      const account =
        accounts.find(a => a.account_type === "demo") ||
        accounts[0];

      if (account?.balance != null) {
        displayValue(
          "balance",
          money(account.balance, account.currency),
          "Balance: "
        );
      } else {
        displayValue(
          "balance",
          "Unavailable",
          "Balance: "
        );
      }

    } catch (error) {
      console.error("Account error:", error);

      displayValue(
        "accountStatus",
        "Account request failed"
      );
    }
  }

  loginButton?.addEventListener("click", () => {
    window.location.assign("/login");
  });

  connect();
  checkAccount();
});
        
