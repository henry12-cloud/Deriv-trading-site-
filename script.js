
"use strict";

// TRADEDOLLARS - PUBLIC MARKET CONNECTION
// Trading is disabled until server authentication is verified.

document.addEventListener("DOMContentLoaded", () => {
  const API =
    "wss://api.derivws.com/trading/v1/options/ws/public";

  const el = id => document.getElementById(id);

  const connectionStatus = el("connectionStatus");
  const marketSelect = el("marketSelect");
  const marketStatus = el("marketStatus");
  const selectedMarket = el("selectedMarket");
  const livePrice = el("livePrice");
  const chartPrice = el("chartPrice");
  const chartStatus = el("chartStatus");
  const lastUpdate = el("lastUpdate") || el("chartTime");
  const tradeStatus = el("tradeStatus");
  const askPrice = el("askPrice");
  const payout = el("payout");
  const amountInput = el("tradeAmount");
  const durationInput = el("duration");
  const riseButton = el("riseButton");
  const fallButton = el("fallButton");
  const loginButton = el("loginButton");
  const accountStatus = el("accountStatus");
  const balance = el("balance");
  const canvas = el("chart");

  let socket = null;
  let markets = [];
  let currentSymbol = "";
  let tickSubscription = null;
  let prices = [];
  let reconnectTimer = null;
  let requestId = 10;

  function show(element, message) {
    if (element) element.textContent = message;
  }

  function send(request) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      show(connectionStatus, "Deriv is disconnected");
      return false;
    }

    socket.send(JSON.stringify(request));
    return true;
  }

  function connect() {
    clearTimeout(reconnectTimer);

    show(connectionStatus, "Connecting to Deriv...");

    socket = new WebSocket(API);

    socket.onopen = () => {
      show(connectionStatus, "Connected to Deriv ✓");

      send({
        active_symbols: "brief",
        req_id: 1
      });
    };

    socket.onmessage = event => {
      let data;

      try {
        data = JSON.parse(event.data);
      } catch (error) {
        show(connectionStatus, "Invalid server response");
        return;
      }

      if (data.error) {
        const message = data.error.message || "Unknown API error";

        if (data.echo_req?.proposal) {
          show(tradeStatus, "Quote error: " + message);
        } else {
          show(marketStatus, "API error: " + message);
        }
        return;
      }

      switch (data.msg_type) {
        case "active_symbols":
          loadMarkets(data.active_symbols || []);
          break;

        case "tick":
          if (
            data.tick &&
            data.tick.symbol === currentSymbol
          ) {
            updatePrice(data.tick);
          }

          if (data.subscription?.id) {
            tickSubscription = data.subscription.id;
          }
          break;

        case "history":
          if (data.history?.prices) {
            prices = data.history.prices
              .map(Number)
              .filter(Number.isFinite)
              .slice(-100);

            drawChart();
          }
          break;

        case "contracts_for":
          handleContracts(data.contracts_for);
          break;

        case "proposal":
          handleProposal(data.proposal);
          break;
      }
    };

    socket.onerror = () => {
      show(connectionStatus, "Connection error");
    };

    socket.onclose = () => {
      show(connectionStatus, "Disconnected - reconnecting...");
      tickSubscription = null;

      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 5000);
    };
  }

  function loadMarkets(symbols) {
    markets = symbols.filter(
      market => market.symbol && market.display_name
    );

    if (!marketSelect) {
      show(marketStatus, "Market selector missing");
      return;
    }

    marketSelect.innerHTML = "";

    markets.forEach(market => {
      const option = document.createElement("option");

      option.value = market.symbol;
      option.textContent = market.display_name;

      marketSelect.appendChild(option);
    });

    show(marketStatus, markets.length + " markets loaded");

    if (!markets.length) {
      show(marketStatus, "No markets returned by Deriv");
      return;
    }

    const preferred = markets.find(
      market => market.symbol === "1HZ100V"
    );

    selectMarket(preferred?.symbol || markets[0].symbol);
  }

  function selectMarket(symbol) {
    if (!symbol) return;

    if (tickSubscription) {
      send({
        forget: tickSubscription,
        req_id: ++requestId
      });
      tickSubscription = null;
    }

    currentSymbol = symbol;
    prices = [];

    const market = markets.find(
      item => item.symbol === symbol
    );

    if (marketSelect) marketSelect.value = symbol;

    show(selectedMarket, market?.display_name || symbol);
    show(livePrice, "--");
    show(chartPrice, "--");
    show(lastUpdate, "--");
    show(tradeStatus, "Select RISE or FALL for a quote");
    show(askPrice, "--");
    show(payout, "--");

    drawChart();

    send({
      ticks: symbol,
      subscribe: 1,
      req_id: ++requestId
    });

    send({
      ticks_history: symbol,
      count: 100,
      end: "latest",
      style: "ticks",
      req_id: ++requestId
    });
  }

  function updatePrice(tick) {
    const price = Number(tick.quote);

    if (!Number.isFinite(price)) return;

    const formatted = price.toFixed(
      Number.isInteger(tick.pip_size)
        ? tick.pip_size
        : 2
    );

    show(livePrice, formatted);
    show(chartPrice, formatted);
    show(chartStatus, "Market is live ●");
    show(lastUpdate, new Date().toLocaleTimeString());

    prices.push(price);

    if (prices.length > 100) prices.shift();

    drawChart();
  }

  function drawChart() {
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (prices.length < 2) return;

    const minimum = Math.min(...prices);
    const maximum = Math.max(...prices);
    const range = maximum - minimum || 1;
    const padding = 25;

    ctx.beginPath();
    ctx.strokeStyle = "#16a34a";
    ctx.lineWidth = 2;

    prices.forEach((price, index) => {
      const x = padding +
        (index / (prices.length - 1)) *
        (width - padding * 2);

      const y = height - padding -
        ((price - minimum) / range) *
        (height - padding * 2);

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();
  }

  function requestQuote(direction) {
    if (!currentSymbol) {
      show(tradeStatus, "Select a market first");
      return;
    }

    const amount = Number(amountInput?.value || 1);
    const duration = Number(durationInput?.value || 15);

    if (!Number.isFinite(amount) || amount <= 0) {
      show(tradeStatus, "Enter a valid trade amount");
      return;
    }

    if (!Number.isInteger(duration) || duration <= 0) {
      show(tradeStatus, "Enter a valid duration");
      return;
    }

    show(
      tradeStatus,
      "Checking " + direction + " contracts..."
    );

    send({
      contracts_for: currentSymbol,
      req_id: direction === "CALL" ? 20 : 21
    });
  }

  function handleContracts(result) {
    const available = result?.available || [];

    show(
      marketStatus,
      available.length + " contracts available ✓"
    );

    show(
      tradeStatus,
      "Contract information received. " +
      "Authenticated quote integration is pending."
    );
  }

  function handleProposal(proposal) {
    if (!proposal) return;

    show(tradeStatus, "Quote received ✓");
    show(askPrice, proposal.ask_price ?? "--");
    show(payout, proposal.payout ?? "--");
  }

  if (marketSelect) {
    marketSelect.addEventListener("change", event => {
      selectMarket(event.target.value);
    });
  }

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

  if (loginButton) {
    loginButton.addEventListener("click", () => {
      show(
        accountStatus,
        "Login requires verified server configuration"
      );
    });
  }

  show(accountStatus, "Account: Not connected");
  show(balance, "--");

  connect();
});
     
