
"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const $ = id => document.getElementById(id);
  const APP_ID = "34qPaViEQZZw84Mc5thoO";
  const WS_URL =
    "wss://api.derivws.com/trading/v1/options/ws/public" +
    "?app_id=" + APP_ID;

  let ws = null;
  let symbol = "";
  let prices = [];
  let quoteId = 30;
  let reconnectTimer = null;

  const text = (id, value) => {
    const node = $(id);
    if (node) node.textContent = value;
  };

  const send = data => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    ws.send(JSON.stringify(data));
    return true;
  };

  const money = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(2) : "--";
  };

  function resetQuote() {
    quoteId++;
    text("quoteStatus", "Quote: Waiting...");
    text("askPrice", "--");
    text("potentialPayout", "--");
  }

  function drawChart() {
    const canvas = $("chart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (prices.length < 2) return;

    const low = Math.min(...prices);
    const high = Math.max(...prices);
    const range = high - low || 1;

    ctx.beginPath();
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 2;

    prices.forEach((price, i) => {
      const x = i / (prices.length - 1) * w;
      const y = h - 12 -
        ((price - low) / range) * (h - 24);

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();
  }

  function selectMarket(nextSymbol) {
    if (!nextSymbol) return;

    symbol = nextSymbol;
    prices = [];
    resetQuote();

    const select = $("marketSelect");
    const name = select.selectedOptions[0]?.textContent ||
      nextSymbol;

    text("selectedMarket", name);
    text("livePrice", "--");
    text("lastUpdate", "Waiting for prices...");

    drawChart();

    send({ forget_all: "ticks" });
    send({
      ticks: symbol,
      subscribe: 1,
      req_id: 2
    });
  }

  function connect() {
    clearTimeout(reconnectTimer);
    text("connectionStatus", "Connecting to Deriv...");

    try {
      ws = new WebSocket(WS_URL);
    } catch (err) {
      text("connectionStatus", "Connection failed");
      console.error(err);
      reconnectTimer = setTimeout(connect, 5000);
      return;
    }

    ws.onopen = () => {
      text("connectionStatus", "Connected to Deriv ✓");
      send({
        active_symbols: "brief",
        req_id: 1
      });
    };

    ws.onmessage = event => {
      let data;

      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (data.error) {
        console.error("Deriv:", data.error);

        if (data.req_id === 2) {
          text("lastUpdate", data.error.message);
        } else if (data.req_id === quoteId) {
          text("quoteStatus", "Quote: Error");
          text("tradeStatus", data.error.message);
        } else {
          text("marketStatus", data.error.message);
        }
        return;
      }

      if (data.msg_type === "active_symbols") {
        const markets = data.active_symbols || [];
        const select = $("marketSelect");

        text("marketStatus",
          markets.length + " markets loaded");

        select.replaceChildren();

        for (const market of markets) {
          const option = document.createElement("option");
          option.value = market.symbol;
          option.textContent =
            market.display_name || market.symbol;
          select.appendChild(option);
        }

        const preferred = markets.find(
          m => m.symbol === "1HZ100V"
        );

        if (preferred) select.value = preferred.symbol;

        if (select.value) selectMarket(select.value);
        return;
      }

      if (data.msg_type === "tick") {
        const tick = data.tick;
        if (!tick || tick.symbol !== symbol) return;

        const price = Number(tick.quote);
        if (!Number.isFinite(price)) return;

        text("livePrice", String(tick.quote));
        text("lastUpdate",
          "Updated: " + new Date().toLocaleTimeString());

        prices.push(price);
        if (prices.length > 100) prices.shift();

        drawChart();
        return;
      }

      if (data.msg_type === "proposal" &&
          data.req_id === quoteId) {
        const p = data.proposal;
        if (!p) return;

        text("askPrice", money(p.ask_price) + " USD");
        text("potentialPayout",
          money(p.payout) + " USD");
        text("quoteStatus", "Quote: Received ✓");
        text("tradeStatus",
          "Quote received. Purchasing is disabled.");
      }
    };

    ws.onerror = error => {
      console.error("WebSocket error:", error);
      text("connectionStatus", "Connection error");
    };

    ws.onclose = () => {
      text("connectionStatus", "Reconnecting...");
      reconnectTimer = setTimeout(connect, 5000);
    };
  }

  function requestQuote(type) {
    const amount = Number($("tradeAmount").value);
    const duration = Number($("duration").value);

    if (!symbol) {
      text("tradeStatus", "Select a market first.");
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      text("tradeStatus", "Enter a valid amount.");
      return;
    }

    if (!Number.isInteger(duration) || duration < 1) {
      text("tradeStatus", "Enter a valid tick duration.");
      return;
    }

    resetQuote();
    text("quoteStatus", "Quote: Requesting...");

    if (!send({
      proposal: 1,
      amount,
      basis: "stake",
      contract_type: type,
      currency: "USD",
      duration,
      duration_unit: "t",
      symbol,
      req_id: quoteId
    })) {
      text("quoteStatus", "Quote: Not connected");
    }
  }

  async function checkAccount() {
    try {
      const response = await fetch("/api/account", {
        credentials: "same-origin",
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error("Account HTTP " + response.status);
      }

      const result = await response.json();

      if (!result.connected) {
        text("accountStatus", "Account: Not connected");
        text("balance", "--");
        $("accountSelect").innerHTML =
          '<option>Log in first</option>';
        return;
      }

      text("accountStatus", "Account: Connected ✓");
      $("loginButton").hidden = true;
      $("logoutButton").hidden = false;

      const payload = result.data;
      const accounts =
        Array.isArray(payload) ? payload :
        Array.isArray(payload?.data) ? payload.data :
        Array.isArray(payload?.accounts) ?
          payload.accounts :
        Array.isArray(payload?.data?.accounts) ?
          payload.data.accounts : [];

      const select = $("accountSelect");
      select.replaceChildren();

      for (const account of accounts) {
        const option = document.createElement("option");
        option.value =
          account.account_id || account.id || "";
        option.textContent =
          account.account_id ||
          account.loginid ||
          account.id ||
          account.currency ||
          "Trading account";
        select.appendChild(option);
      }

      if (!accounts.length) {
        select.add(new Option(
          "Connected — account details unavailable", ""
        ));
      }

      select.disabled = accounts.length === 0;

      function updateBalance() {
        const account = accounts[select.selectedIndex];
        text("balance",
          account?.balance != null
            ? money(account.balance) +
              " " + (account.currency || "USD")
            : "Unavailable");
      }

      select.addEventListener("change", updateBalance);
      updateBalance();

    } catch (err) {
      console.error("Account error:", err);
      text("accountStatus", "Account check failed");
      text("balance", "--");
    }
  }

  $("marketSelect").addEventListener("change", e => {
    selectMarket(e.target.value);
  });

  $("riseButton").addEventListener("click", () => {
    requestQuote("CALL");
  });

  $("fallButton").addEventListener("click", () => {
    requestQuote("PUT");
  });

  $("tradeAmount").addEventListener("change", resetQuote);
  $("duration").addEventListener("change", resetQuote);

  $("loginButton").addEventListener("click", () => {
    location.href = "/login";
  });

  $("logoutButton").addEventListener("click", () => {
    location.href = "/logout";
  });

  $("buyButton").disabled = true;

  connect();
  checkAccount();
});      
