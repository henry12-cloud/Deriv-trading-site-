
"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const el = id => document.getElementById(id);

  const status = el("connectionStatus");
  const markets = el("marketSelect");
  const marketStatus = el("marketStatus");
  const chart = el("chart");
  const ctx = chart.getContext("2d");

  let publicWs = null;
  let demoWs = null;
  let symbol = "";
  let direction = "";
  let subscription = null;
  let prices = [];
  let requestId = 10;
  let quoteRequest = 0;
  let quote = null;
  let quoteTime = 0;
  let demoConnected = false;
  let demoAccountId = "";
  let buying = false;
  let buyRequest = 0;
  let reconnectTimer;

  const nextId = () => ++requestId;

  function send(ws, message) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    ws.send(JSON.stringify(message));
    return true;
  }

  function setBuyEnabled() {
    el("buyBtn").disabled = !(
      demoConnected &&
      quote &&
      direction &&
      !buying &&
      Date.now() - quoteTime < 15000
    );
  }

  function clearQuote() {
    quote = null;
    quoteTime = 0;
    quoteRequest = 0;
    el("askPrice").textContent = "--";
    el("payout").textContent = "--";
    el("quoteStatus").textContent = "Quote: Waiting...";
    setBuyEnabled();
  }

  async function checkAccount() {
    try {
      const response = await fetch("/api/account", {
        cache: "no-store"
      });

      const data = await response.json();

      if (!response.ok || !data.connected) {
        el("accountStatus").textContent = "Not logged in";
        el("balance").textContent = "Balance: --";
        el("loginBtn").hidden = false;
        el("logoutBtn").hidden = true;
        return;
      }

      el("loginBtn").hidden = true;
      el("logoutBtn").hidden = false;

      const payload = data.accounts;
      const list = Array.isArray(payload)
        ? payload
        : payload?.data?.accounts ||
          payload?.accounts ||
          payload?.data ||
          [];

      const accounts = Array.isArray(list) ? list : [];

      const demo = accounts.find(a =>
        a.account_type === "demo" ||
        a.type === "demo"
      );

      if (!demo) {
        el("accountStatus").textContent =
          "Connected. No demo trading account available.";
        return;
      }

      demoAccountId =
        demo.account_id || demo.id || demo.loginid || "";

      el("accountId").textContent = demoAccountId;
      el("accountStatus").textContent =
        "Connected to Deriv ✓ — Demo account";

      const balance =
        demo.balance?.balance ??
        demo.balance?.amount ??
        demo.balance;

      const currency =
        demo.currency || demo.balance?.currency || "";

      el("balance").textContent = balance == null
        ? "Balance: Not supplied"
        : "Balance: " + balance + " " + currency;

      await connectDemo();
    } catch {
      el("accountStatus").textContent =
        "Unable to check account.";
    }
  }

  async function connectDemo() {
    demoConnected = false;
    clearQuote();

    el("quoteStatus").textContent =
      "Connecting demo trading account...";

    try {
      const response = await fetch("/api/demo-connection", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "same-origin",
        body: "{}"
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Demo connection failed."
        );
      }

      if (
        data.accountType !== "demo" ||
        data.accountId !== demoAccountId
      ) {
        throw new Error("Demo account mismatch.");
      }

      const url = new URL(data.wsUrl);

      if (
        url.protocol !== "wss:" ||
        url.hostname !== "api.derivws.com" ||
        url.pathname !== "/trading/v1/options/ws/demo"
      ) {
        throw new Error("Invalid demo trading endpoint.");
      }

      if (demoWs) demoWs.close();

      const socket = new WebSocket(data.wsUrl);
      demoWs = socket;

      socket.onopen = () => {
        if (demoWs !== socket) return;

        demoConnected = true;

        el("quoteStatus").textContent =
          "Demo account ready. Select RISE or FALL.";

        if (direction && symbol) requestQuote();
      };

      socket.onmessage = event => {
        if (demoWs !== socket) return;

        let data;

        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }

        if (data.error) {
          const message =
            data.error.message || "Deriv trading error.";

          if (data.req_id === buyRequest) {
            buying = false;
            buyRequest = 0;
            clearQuote();
            el("quoteStatus").textContent =
              "Purchase failed: " + message;
          } else if (data.req_id === quoteRequest) {
            clearQuote();
            el("quoteStatus").textContent = message;
          }

          setBuyEnabled();
          return;
        }

        if (
          data.msg_type === "proposal" &&
          data.req_id === quoteRequest
        ) {
          const proposal = data.proposal || {};

          if (
            !proposal.id ||
            !Number.isFinite(Number(proposal.ask_price))
          ) {
            clearQuote();
            el("quoteStatus").textContent =
              "Valid quote unavailable.";
            return;
          }

          quote = {
            id: proposal.id,
            ask: Number(proposal.ask_price),
            symbol,
            direction,
            amount: Number(el("amount").value),
            duration: Number(el("duration").value)
          };

          quoteTime = Date.now();

          el("askPrice").textContent =
            String(proposal.ask_price);

          el("payout").textContent =
            String(proposal.payout ?? "--");

          el("quoteStatus").textContent =
            "Demo quote received ✓";

          setBuyEnabled();
        }

        if (
          data.msg_type === "buy" &&
          data.req_id === buyRequest
        ) {
          buying = false;
          buyRequest = 0;

          const purchase = data.buy || {};
          clearQuote();

          if (purchase.contract_id) {
            el("quoteStatus").textContent =
              "DEMO PURCHASE SUCCESSFUL ✓ Contract: " +
              purchase.contract_id;
            checkBalance();
          } else {
            el("quoteStatus").textContent =
              "Purchase response received. Verify in Deriv.";
          }
        }
      };

      socket.onerror = () => {
        if (demoWs !== socket) return;

        demoConnected = false;
        clearQuote();
        el("quoteStatus").textContent =
          "Demo trading connection error.";
      };

      socket.onclose = () => {
        if (demoWs !== socket) return;

        demoConnected = false;
        clearQuote();

        el("quoteStatus").textContent =
          "Demo connection closed. Refresh to reconnect.";
      };
    } catch (error) {
      el("quoteStatus").textContent = error.message;
    }
  }

  async function checkBalance() {
    try {
      const response = await fetch("/api/account", {
        cache: "no-store"
      });

      if (!response.ok) return;

      const data = await response.json();
      const payload = data.accounts;

      const list = Array.isArray(payload)
        ? payload
        : payload?.data?.accounts ||
          payload?.accounts ||
          payload?.data ||
          [];

      if (!Array.isArray(list)) return;

      const account = list.find(a =>
        (a.account_id || a.id || a.loginid) ===
        demoAccountId
      );

      if (!account) return;

      const balance =
        account.balance?.balance ??
        account.balance?.amount ??
        account.balance;

      if (balance != null) {
        el("balance").textContent =
          "Balance: " + balance + " " +
          (account.currency ||
            account.balance?.currency || "");
      }
    } catch {
      // Keep the last displayed balance.
    }
  }

  function requestQuote() {
    clearQuote();

    if (!direction || !symbol) return;

    const amount = Number(el("amount").value);
    const duration = Number(el("duration").value);

    if (
      !Number.isFinite(amount) ||
      amount < 0.35 ||
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > 10
    ) {
      el("quoteStatus").textContent =
        "Enter a valid amount and 1–10 ticks.";
      return;
    }

    if (!demoConnected) {
      el("quoteStatus").textContent =
        "Waiting for demo trading connection...";
      return;
    }

    quoteRequest = nextId();

    const sent = send(demoWs, {
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
      ? "Requesting demo quote..."
      : "Demo connection unavailable.";
  }

  function drawChart() {
    const w = chart.width;
    const h = chart.height;

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
      const x = i * w / (prices.length - 1);
      const y = h - 15 -
        ((price - min) / range) * (h - 30);

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();
  }

  function selectSymbol(value) {
    if (subscription) {
      send(publicWs, { forget: subscription });
      subscription = null;
    }

    symbol = value;
    prices = [];
    drawChart();
    clearQuote();

    el("selectedMarket").textContent =
      markets.selectedOptions[0]?.textContent || "--";

    el("livePrice").textContent = "--";
    el("priceStatus").textContent =
      "Waiting for prices...";

    if (!symbol) return;

    send(publicWs, {
      ticks: symbol,
      subscribe: 1,
      req_id: nextId()
    });

    if (direction) requestQuote();
  }

  function connectPublic(appId) {
    clearTimeout(reconnectTimer);

    status.textContent = "Connecting to Deriv...";

    const endpoint =
      "wss://api.derivws.com/trading/v1/options/ws/public";

    const url = appId
      ? endpoint + "?app_id=" + encodeURIComponent(appId)
      : endpoint;

    const socket = new WebSocket(url);
    publicWs = socket;

    socket.onopen = () => {
      if (publicWs !== socket) return;

      status.textContent = "Connected to Deriv ✓";

      send(socket, {
        active_symbols: "brief",
        req_id: 1
      });
    };

    socket.onmessage = event => {
      if (publicWs !== socket) return;

      let data;

      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (data.error) {
        if (data.req_id === 1) {
          marketStatus.textContent = data.error.message;
        } else {
          el("priceStatus").textContent =
            data.error.message;
        }
        return;
      }

      if (data.msg_type === "active_symbols") {
        const list = (data.active_symbols || []).filter(
          item => item.symbol || item.underlying_symbol
        );

        markets.innerHTML = "";

        list.forEach(item => {
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
          list.length + " markets loaded";

        if (list.length) {
          const preferred = list.find(item =>
            (item.symbol || item.underlying_symbol) ===
            "1HZ100V"
          );

          markets.value = preferred
            ? preferred.symbol ||
              preferred.underlying_symbol
            : markets.options[0].value;

          selectSymbol(markets.value);
        }
      }

      if (data.msg_type === "tick" && data.tick) {
        if (data.tick.symbol !== symbol) return;

        if (data.subscription?.id) {
          subscription = data.subscription.id;
        }

        const price = Number(data.tick.quote);

        if (!Number.isFinite(price)) return;

        el("livePrice").textContent =
          String(data.tick.quote);

        el("priceStatus").textContent =
          "Market is live ●";

        prices.push(price);

        if (prices.length > 80) prices.shift();

        drawChart();
      }
    };

    socket.onerror = () => {
      if (publicWs === socket) {
        status.textContent = "Connection error";
      }
    };

    socket.onclose = () => {
      if (publicWs !== socket) return;

      status.textContent = "Reconnecting...";
      subscription = null;
      clearQuote();

      reconnectTimer = setTimeout(
        () => connectPublic(appId),
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
    if (
      buying ||
      !demoConnected ||
      !quote ||
      Date.now() - quoteTime >= 15000
    ) {
      clearQuote();
      el("quoteStatus").textContent =
        "Quote expired. Request a new quote.";
      return;
    }

    if (
      quote.symbol !== symbol ||
      quote.direction !== direction ||
      quote.amount !== Number(el("amount").value) ||
      quote.duration !== Number(el("duration").value)
    ) {
      requestQuote();
      return;
    }

    const confirmed = window.confirm(
      "DEMO TRADE ONLY\n\n" +
      "Account: " + demoAccountId + "\n" +
      "Market: " + symbol + "\n" +
      "Direction: " + direction + "\n" +
      "Maximum purchase price: $" +
      quote.ask.toFixed(2) + "\n\n" +
      "Purchase this demo contract?"
    );

    if (!confirmed) return;

    buying = true;
    setBuyEnabled();

    buyRequest = nextId();

    const sent = send(demoWs, {
      buy: quote.id,
      price: quote.ask,
      req_id: buyRequest
    });

    if (sent) {
      el("quoteStatus").textContent =
        "Submitting demo purchase...";
    } else {
      buying = false;
      buyRequest = 0;
      clearQuote();
      el("quoteStatus").textContent =
        "Connection lost. Purchase not confirmed.";
    }
  };

  el("logoutBtn").onclick = async () => {
    if (demoWs) demoWs.close();

    await fetch("/logout", {
      method: "POST",
      credentials: "same-origin"
    });

    location.reload();
  };

  checkAccount();

  try {
    const response = await fetch("/api/config");
    const config = await response.json();

    connectPublic(config.appId);

    if (!config.configured) {
      el("accountStatus").textContent =
        "Set DERIV_CLIENT_ID in Render.";
    }
  } catch {
    status.textContent =
      "Server configuration unavailable.";
  }
});
          
