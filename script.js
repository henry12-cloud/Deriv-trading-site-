
"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const el = id => document.getElementById(id);

  const status = el("connectionStatus");
  const markets = el("marketSelect");
  const marketStatus = el("marketStatus");
  const selectedMarket = el("selectedMarket");
  const livePrice = el("livePrice");
  const priceStatus = el("priceStatus");
  const chart = el("chart");
  const ctx = chart.getContext("2d");

  let ws;
  let symbol = "";
  let direction = "";
  let subscription = null;
  let quoteId = null;
  let prices = [];
  let requestNumber = 10;
  let quoteRequest = 0;
  let reconnectTimer;

  const send = data => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  };

  async function checkAccount() {
    try {
      const response = await fetch("/api/account");
      const data = await response.json();

      if (!response.ok || !data.connected) {
        el("accountStatus").textContent =
          "Not logged in";
        el("balance").textContent = "Balance: --";
        return;
      }

      el("accountStatus").textContent =
        "Connected to Deriv ✓";
      el("loginBtn").hidden = true;
      el("logoutBtn").hidden = false;

      const payload = data.accounts;
      const list = Array.isArray(payload)
        ? payload
        : payload?.data?.accounts ||
          payload?.accounts ||
          payload?.data ||
          [];

      const accounts = Array.isArray(list)
        ? list
        : [];

      const account = accounts.find(a =>
        a.account_type === "demo" ||
        a.type === "demo"
      ) || accounts[0];

      if (account) {
        el("accountId").textContent =
          account.account_id ||
          account.id ||
          account.loginid ||
          "Deriv account";

        const balance =
          account.balance?.balance ??
          account.balance?.amount ??
          account.balance;

        const currency =
          account.currency ||
          account.balance?.currency ||
          "";

        el("balance").textContent =
          balance == null
            ? "Balance: Not supplied by account API"
            : "Balance: " + balance + " " + currency;
      } else {
        el("balance").textContent =
          "Connected. No options account returned.";
      }
    } catch (error) {
      el("accountStatus").textContent =
        "Unable to check account.";
    }
  }

  el("logoutBtn").onclick = async () => {
    await fetch("/logout", { method: "POST" });
    location.reload();
  };

  function drawChart() {
    const w = chart.width;
    const h = chart.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0b192a";
    ctx.fillRect(0, 0, w, h);

    if (prices.length < 2) return;

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;

    ctx.beginPath();
    ctx.strokeStyle = "#20df9b";
    ctx.lineWidth = 2;

    prices.forEach((price, i) => {
      const x = i * (w / (prices.length - 1));
      const y = h - 15 -
        ((price - min) / range) * (h - 30);

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();
  }

  function clearQuote() {
    quoteId = null;
    el("askPrice").textContent = "--";
    el("payout").textContent = "--";
    el("quoteStatus").textContent = "Quote: Waiting...";
  }

  function requestQuote() {
    clearQuote();

    const amount = Number(el("amount").value);
    const duration = Number(el("duration").value);

    if (!direction || !symbol) return;

    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > 10
    ) {
      el("quoteStatus").textContent =
        "Enter a valid amount and 1–10 ticks.";
      return;
    }

    quoteRequest = ++requestNumber;

    const sent = send({
      proposal: 1,
      amount,
      basis: "stake",
      contract_type: direction,
      currency: "USD",
      duration,
      duration_unit: "t",
      underlying_symbol: symbol,
      req_id: quoteRequest
    });

    el("quoteStatus").textContent = sent
      ? "Requesting quote..."
      : "Waiting for connection...";
  }

  function selectSymbol(value) {
    if (subscription) {
      send({ forget: subscription });
      subscription = null;
    }

    symbol = value;
    prices = [];
    drawChart();
    clearQuote();

    const option = markets.selectedOptions[0];

    selectedMarket.textContent =
      option?.textContent || "--";

    livePrice.textContent = "--";
    priceStatus.textContent = "Waiting for prices...";

    if (!symbol) return;

    send({
      ticks: symbol,
      subscribe: 1,
      req_id: ++requestNumber
    });

    if (direction) requestQuote();
  }

  function connect(appId) {
    clearTimeout(reconnectTimer);

    status.textContent = "Connecting to Deriv...";

    const endpoint =
      "wss://api.derivws.com/trading/v1/options/ws/public";

    const url = appId
      ? endpoint + "?app_id=" + encodeURIComponent(appId)
      : endpoint;

    ws = new WebSocket(url);

    ws.onopen = () => {
      status.textContent = "Connected to Deriv ✓";

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
        const message =
          data.error.message || "Deriv API error";

        if (data.req_id === 1) {
          marketStatus.textContent = message;
        } else if (data.req_id === quoteRequest) {
          el("quoteStatus").textContent = message;
        } else {
          priceStatus.textContent = message;
        }
        return;
      }

      if (data.msg_type === "active_symbols") {
        const list = data.active_symbols || [];

        markets.innerHTML = "";

        const valid = list.filter(item =>
          item.symbol || item.underlying_symbol
        );

        valid.forEach(item => {
          const option = document.createElement("option");

          option.value =
            item.symbol || item.underlying_symbol;

          option.textContent =
            item.display_name ||
            item.display_name_short ||
            option.value;

          markets.appendChild(option);
        });

        marketStatus.textContent =
          valid.length + " markets loaded";

        if (valid.length) {
          const preferred = valid.find(item =>
            (item.symbol ||
              item.underlying_symbol) === "1HZ100V"
          );

          markets.value = preferred
            ? preferred.symbol ||
              preferred.underlying_symbol
            : markets.options[0].value;

          selectSymbol(markets.value);
        } else {
          marketStatus.textContent =
            "No markets returned by Deriv";
        }
      }

      if (data.msg_type === "tick" && data.tick) {
        if (data.tick.symbol !== symbol) return;

        if (data.subscription?.id) {
          subscription = data.subscription.id;
        }

        const price = Number(data.tick.quote);

        if (!Number.isFinite(price)) return;

        livePrice.textContent = String(data.tick.quote);
        priceStatus.textContent = "Market is live ●";

        prices.push(price);

        if (prices.length > 80) prices.shift();

        drawChart();
      }

      if (data.msg_type === "proposal") {
        if (data.req_id !== quoteRequest) return;

        const quote = data.proposal || {};

        quoteId = quote.id || null;

        el("askPrice").textContent =
          quote.ask_price ?? "--";

        el("payout").textContent =
          quote.payout ?? "--";

        el("quoteStatus").textContent = quoteId
          ? "Quote received ✓"
          : "Quote unavailable";
      }
    };

    ws.onerror = () => {
      status.textContent = "Connection error";
    };

    ws.onclose = () => {
      status.textContent = "Reconnecting...";
      subscription = null;
      reconnectTimer = setTimeout(
        () => connect(appId),
        5000
      );
    };
  }

  markets.onchange = () => {
    selectSymbol(markets.value);
  };

  function choose(type) {
    direction = type;

    el("riseBtn").classList.toggle(
      "selected", type === "CALL"
    );

    el("fallBtn").classList.toggle(
      "selected", type === "PUT"
    );

    el("directionStatus").textContent =
      type === "CALL" ? "RISE selected" : "FALL selected";

    requestQuote();
  }

  el("riseBtn").onclick = () => choose("CALL");
  el("fallBtn").onclick = () => choose("PUT");

  el("amount").onchange = requestQuote;
  el("duration").onchange = requestQuote;

  el("buyBtn").onclick = () => {
    // Disabled until authenticated trading is tested.
  };

  checkAccount();

  try {
    const response = await fetch("/api/config");
    const config = await response.json();

    connect(config.appId);

    if (!config.configured) {
      el("accountStatus").textContent =
        "Set DERIV_CLIENT_ID in Render.";
    }
  } catch {
    status.textContent =
      "Server configuration unavailable.";
  }
});
          
