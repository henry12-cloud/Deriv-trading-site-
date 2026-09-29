
"use strict";

/*
 * TRADEDOLLARS
 * Dashboard and demo trading integration
 */

(() => {
  const $ = (id) => document.getElementById(id);

  const ui = {
    connection: $("connectionStatus"),
    account: $("accountStatus"),
    accountId: $("accountId"),
    balance: $("balance"),
    login: $("loginBtn"),
    logout: $("logoutBtn"),
    marketStatus: $("marketStatus"),
    market: $("marketSelect"),
    selectedMarket: $("selectedMarket"),
    price: $("livePrice"),
    priceStatus: $("priceStatus"),
    chart: $("chart"),
    amount: $("amount"),
    duration: $("duration"),
    rise: $("riseBtn"),
    fall: $("fallBtn"),
    direction: $("directionStatus"),
    quote: $("quoteStatus"),
    ask: $("askPrice"),
    payout: $("payout"),
    buy: $("buyBtn"),
    open: $("openContracts"),
    history: $("tradeHistory"),
    wins: $("wins"),
    losses: $("losses"),
    profit: $("totalProfit")
  };

  let appId = "";
  let publicSocket = null;
  let tradingSocket = null;
  let tradingReady = false;
  let demoAccount = false;
  let currency = "USD";
  let symbol = "";
  let direction = "";
  let quote = null;
  let quoteRequest = 0;
  let requestId = 100;
  let tickSubscription = null;
  let prices = [];
  let contracts = new Map();
  let buying = false;
  let quoteTimer = null;
  let publicReconnect = null;
  let tradingReconnect = null;
  let publicPing = null;
  let tradingPing = null;
  let accountId = "";
  let buyRequest = 0;
  let quoteSocket = null;
  let pendingPurchase = null;
  let openSubscriptions = new Set();

  function text(element, value) {
    if (element) {
      element.textContent = String(value);
    }
  }

  function money(value) {
    const number = Number(value);

    return Number.isFinite(number)
      ? number.toFixed(2) + " " + currency
      : "--";
  }

  function send(socket, message) {
    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN
    ) {
      return false;
    }

    socket.send(JSON.stringify(message));
    return true;
  }

  function nextId() {
    return ++requestId;
  }

  function showError(message) {
    text(ui.quote, message);
  }

  function updateBuyButton() {
    if (!ui.buy) return;

    const valid =
      demoAccount &&
      tradingReady &&
      quote &&
      quote.id &&
      !buying &&
      quoteSocket === tradingSocket;

    ui.buy.disabled = !valid;

    ui.buy.textContent = buying
      ? "PURCHASING..."
      : "CONFIRM DEMO BUY";
  }

  /*
   * ACCOUNT AND CONFIGURATION
   */

  async function getJSON(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      ...options
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "Request failed"
      );
    }

    return data;
  }

  async function loadAccount() {
    try {
      const data = await getJSON("/api/account");

      if (!data.connected || !data.account) {
        throw new Error("No connected account");
      }

      const account = data.account;

      accountId = String(
        account.loginid || account.id || ""
      );

      const selected = data.accounts?.find(
        (item) => item.id === accountId
      );

      demoAccount = Boolean(selected?.is_demo);

      currency = account.currency || "USD";

      text(
        ui.account,
        demoAccount
          ? "Demo account connected ✓"
          : "Account connected — demo trading unavailable"
      );

      text(ui.accountId, accountId);
      text(ui.balance, money(account.balance));

      if (ui.login) ui.login.hidden = true;
      if (ui.logout) ui.logout.hidden = false;

      if (demoAccount) {
        await connectTrading();
      }
    } catch (error) {
      demoAccount = false;
      tradingReady = false;

      text(
        ui.account,
        "Please log in with Deriv"
      );

      text(ui.accountId, "--");
      text(ui.balance, "--");

      if (ui.login) ui.login.hidden = false;
      if (ui.logout) ui.logout.hidden = true;
    }

    updateBuyButton();
  }

  async function loadConfig() {
    try {
      const config = await getJSON("/api/config");

      appId = String(config.app_id || "");

      if (!/^\d+$/.test(appId)) {
        throw new Error("Deriv app ID is missing");
      }

      connectPublic();
    } catch (error) {
      text(ui.connection, error.message);
    }
  }

  if (ui.login) {
    ui.login.onclick = () => {
      location.href = "/login";
    };
  }

  if (ui.logout) {
    ui.logout.onclick = () => {
      location.href = "/logout";
    };
  }

  /*
   * PUBLIC MARKET CONNECTION
   */

  function connectPublic() {
    clearTimeout(publicReconnect);

    const url =
      "wss://api.derivws.com/" +
      "trading/v1/options/ws/public?app_id=" +
      encodeURIComponent(appId);

    const ws = new WebSocket(url);
    publicSocket = ws;

    text(ui.connection, "Connecting...");

    ws.onopen = () => {
      if (ws !== publicSocket) return;

      text(ui.connection, "Connected to Deriv ✓");

      send(ws, {
        active_symbols: "brief",
        req_id: nextId()
      });

      clearInterval(publicPing);

      publicPing = setInterval(() => {
        send(ws, { ping: 1 });
      }, 30000);
    };

    ws.onmessage = (event) => {
      if (ws !== publicSocket) return;

      let data;

      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (data.error) {
        if (data.req_id === quoteRequest) {
          clearQuote();
          showError(data.error.message);
        } else {
          text(
            ui.connection,
            data.error.message
          );
        }

        return;
      }

      if (data.msg_type === "active_symbols") {
        handleMarkets(data);
      }

      if (data.msg_type === "tick") {
        handleTick(data);
      }

      if (data.msg_type === "proposal") {
        handleQuote(data, ws);
      }
    };

    ws.onerror = () => {
      text(ui.connection, "Connection error");
    };

    ws.onclose = () => {
      if (ws !== publicSocket) return;

      clearInterval(publicPing);
      text(ui.connection, "Reconnecting...");

      publicReconnect = setTimeout(
        connectPublic,
        4000
      );
    };
  }

  /*
   * MARKETS
   */

  function handleMarkets(data) {
    const markets = data.active_symbols || [];

    if (!Array.isArray(markets) || !markets.length) {
      text(ui.marketStatus, "No markets available");
      return;
    }

    if (!ui.market) return;

    ui.market.innerHTML = "";

    markets.sort((a, b) =>
      String(a.display_name || a.symbol)
        .localeCompare(
          String(b.display_name || b.symbol)
        )
    );

    for (const market of markets) {
      const option = document.createElement("option");

      option.value = market.symbol;
      option.textContent =
        market.display_name || market.symbol;

      ui.market.appendChild(option);
    }

    text(
      ui.marketStatus,
      markets.length + " markets loaded ✓"
    );

    const preferred = markets.find(
      (market) => market.symbol === "1HZ100V"
    );

    ui.market.value = preferred
      ? preferred.symbol
      : markets[0].symbol;

    changeMarket();
  }

  function changeMarket() {
    if (!ui.market) return;

    if (tickSubscription) {
      send(publicSocket, {
        forget: tickSubscription
      });

      tickSubscription = null;
    }

    symbol = ui.market.value;
    prices = [];

    text(
      ui.selectedMarket,
      ui.market.selectedOptions[0]?.textContent ||
      symbol
    );

    text(ui.price, "--");
    text(ui.priceStatus, "Waiting for prices...");

    clearQuote();
    drawChart();

    send(publicSocket, {
      ticks: symbol,
      subscribe: 1,
      req_id: nextId()
    });

    scheduleQuote();
  }

  if (ui.market) {
    ui.market.addEventListener(
      "change",
      changeMarket
    );
  }

  /*
   * LIVE TICKS
   */

  function handleTick(data) {
    const tick = data.tick;

    if (!tick || tick.symbol !== symbol) {
      return;
    }

    if (data.subscription?.id) {
      tickSubscription = data.subscription.id;
    }

    const price = Number(tick.quote);

    if (!Number.isFinite(price)) return;

    prices.push(price);

    if (prices.length > 100) {
      prices.shift();
    }

    text(ui.price, tick.quote);
    text(ui.priceStatus, "Live prices ✓");

    drawChart();
  }

  function drawChart() {
    const canvas = ui.chart;

    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 260;
    const ratio = window.devicePixelRatio || 1;

    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (prices.length < 2) return;

    const minimum = Math.min(...prices);
    const maximum = Math.max(...prices);
    const range = maximum - minimum || 1;
    const padding = 15;

    ctx.beginPath();
    ctx.strokeStyle = "#00e6a8";
    ctx.lineWidth = 2;

    prices.forEach((price, index) => {
      const x =
        padding +
        index / (prices.length - 1) *
        (width - padding * 2);

      const y =
        height -
        padding -
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

  window.addEventListener("resize", drawChart);

  /*
   * AUTHENTICATED DEMO CONNECTION
   */

  async function connectTrading() {
    if (!demoAccount || !accountId) return;

    clearTimeout(tradingReconnect);
    tradingReady = false;
    updateBuyButton();

    try {
      const result = await getJSON(
        "/api/trading-connection",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            account_id: accountId
          })
        }
      );

      if (!result.is_demo) {
        throw new Error(
          "Only demo trading is enabled."
        );
      }

      const url = new URL(result.url);

      if (
        url.protocol !== "wss:" ||
        url.hostname !== "api.derivws.com" ||
        !url.pathname.endsWith("/ws/demo")
      ) {
        throw new Error(
          "Invalid demo trading connection"
        );
      }

      const ws = new WebSocket(result.url);
      tradingSocket = ws;

      ws.onopen = () => {
        if (ws !== tradingSocket) return;

        tradingReady = true;

        text(
          ui.account,
          "Demo trading connected ✓"
        );

        send(ws, {
          balance: 1,
          subscribe: 1,
          req_id: nextId()
        });

        send(ws, {
          portfolio: 1,
          req_id: nextId()
        });

        for (const contract of contracts.values()) {
          if (contract.status === "open") {
            subscribeContract(contract.id);
          }
        }

        clearInterval(tradingPing);

        tradingPing = setInterval(() => {
          send(ws, { ping: 1 });
        }, 30000);

        scheduleQuote();
        updateBuyButton();
      };

      ws.onmessage = (event) => {
        if (ws !== tradingSocket) return;

        let data;

        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }

        if (data.error) {
          handleTradingError(data);
          return;
        }

        switch (data.msg_type) {
          case "balance":
            if (data.balance) {
              text(
                ui.balance,
                money(data.balance.balance)
              );
            }
            break;

          case "proposal":
            handleQuote(data, ws);
            break;

          case "buy":
            handleBuy(data);
            break;

          case "proposal_open_contract":
            handleContract(data);
            break;

          case "portfolio":
            handlePortfolio(data);
            break;
        }
      };

      ws.onerror = () => {
        text(
          ui.account,
          "Demo connection error"
        );
      };

      ws.onclose = () => {
        if (ws !== tradingSocket) return;

        tradingReady = false;
        quote = null;
        buying = false;
        openSubscriptions.clear();

        clearInterval(tradingPing);
        updateBuyButton();

        text(
          ui.account,
          "Reconnecting demo account..."
        );

        tradingReconnect = setTimeout(
          connectTrading,
          5000
        );
      };
    } catch (error) {
      text(ui.account, error.message);

      tradingReconnect = setTimeout(
        connectTrading,
        8000
      );
    }
  }

  function handleTradingError(data) {
    const message =
      data.error.message || "Trading error";

    if (data.req_id === buyRequest) {
      buying = false;
      pendingPurchase = null;
      updateBuyButton();
      showError("Purchase failed: " + message);
      return;
    }

    if (data.req_id === quoteRequest) {
      clearQuote();
      showError("Quote error: " + message);
      return;
    }

    text(ui.account, message);
  }

  /*
   * RISE / FALL
   */

  function selectDirection(value) {
    direction = value;

    ui.rise?.classList.toggle(
      "selected",
      value === "CALL"
    );

    ui.fall?.classList.toggle(
      "selected",
      value === "PUT"
    );

    text(
      ui.direction,
      value === "CALL"
        ? "RISE selected"
        : "FALL selected"
    );

    scheduleQuote();
  }

  if (ui.rise) {
    ui.rise.onclick = () => {
      selectDirection("CALL");
    };
  }

  if (ui.fall) {
    ui.fall.onclick = () => {
      selectDirection("PUT");
    };
  }

  /*
   * QUOTES
   */

  function clearQuote() {
    quote = null;
    quoteRequest = 0;
    quoteSocket = null;

    text(ui.quote, "Waiting for quote...");
    text(ui.ask, "--");
    text(ui.payout, "--");

    updateBuyButton();
  }

  function scheduleQuote() {
    clearTimeout(quoteTimer);
    clearQuote();

    quoteTimer = setTimeout(
      requestQuote,
      400
    );
  }

  function requestQuote() {
    if (!symbol || !direction || buying) {
      return;
    }

    const amount = Number(ui.amount?.value);
    const duration = Number(ui.duration?.value);

    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > 10
    ) {
      showError(
        "Enter a valid amount and 1–10 ticks."
      );
      return;
    }

    const ws =
      tradingReady && demoAccount
        ? tradingSocket
        : publicSocket;

    quoteRequest = nextId();
    quoteSocket = ws;

    text(ui.quote, "Requesting quote...");

    const success = send(ws, {
      proposal: 1,
      amount,
      basis: "stake",
      contract_type: direction,
      currency,
      duration,
      duration_unit: "t",
      underlying_symbol: symbol,
      req_id: quoteRequest
    });

    if (!success) {
      showError("Waiting for connection...");
    }
  }

  function handleQuote(data, ws) {
    if (
      data.req_id !== quoteRequest ||
      ws !== quoteSocket
    ) {
      return;
    }

    const result = data.proposal;

    if (!result) return;

    quote = {
      id: result.id,
      ask: Number(result.ask_price),
      payout: Number(result.payout),
      symbol,
      direction,
      amount: Number(ui.amount?.value),
      duration: Number(ui.duration?.value),
      receivedAt: Date.now()
    };

    text(ui.quote, "Quote received ✓");
    text(ui.ask, money(quote.ask));
    text(ui.payout, money(quote.payout));

    updateBuyButton();
  }

  ui.amount?.addEventListener(
    "input",
    scheduleQuote
  );

  ui.duration?.addEventListener(
    "input",
    scheduleQuote
  );

  /*
   * DEMO PURCHASE
   */

  function buyContract() {
    if (
      !demoAccount ||
      !tradingReady ||
      !quote ||
      buying ||
      quoteSocket !== tradingSocket
    ) {
      return;
    }

    if (Date.now() - quote.receivedAt > 10000) {
      scheduleQuote();
      showError(
        "Quote expired. Requesting a fresh quote."
      );
      return;
    }

    const price = Number(quote.ask);

    if (!Number.isFinite(price) || price <= 0) {
      showError("Invalid purchase price");
      return;
    }

    buying = true;
    buyRequest = nextId();

    pendingPurchase = { ...quote };

    updateBuyButton();

    const success = send(tradingSocket, {
      buy: quote.id,
      price,
      req_id: buyRequest
    });

    if (!success) {
      buying = false;
      pendingPurchase = null;
      updateBuyButton();

      showError("Trading connection unavailable");
      return;
    }

    text(ui.quote, "Submitting demo purchase...");
  }

  if (ui.buy) {
    ui.buy.onclick = buyContract;
  }

  function handleBuy(data) {
    if (data.req_id !== buyRequest) return;

    buying = false;

    const result = data.buy;

    if (!result?.contract_id) {
      pendingPurchase = null;
      updateBuyButton();
      showError("Purchase was not confirmed");
      return;
    }

    const id = String(result.contract_id);

    contracts.set(id, {
      id,
      symbol:
        pendingPurchase?.symbol || symbol,
      contract_type:
        pendingPurchase?.direction || direction,
      buy_price: Number(
        result.buy_price ??
        pendingPurchase?.ask ??
        0
      ),
      profit: 0,
      status: "open",
      currency
    });

    pendingPurchase = null;

    clearQuote();
    renderTrades();

    text(
      ui.quote,
      "Demo contract purchased ✓"
    );

    subscribeContract(id);

    send(tradingSocket, {
      balance: 1,
      req_id: nextId()
    });
  }

  /*
   * OPEN CONTRACTS
   */

  function subscribeContract(id) {
    if (
      !tradingReady ||
      openSubscriptions.has(String(id))
    ) {
      return;
    }

    const success = send(tradingSocket, {
      proposal_open_contract: 1,
      contract_id: Number(id),
      subscribe: 1,
      req_id: nextId()
    });

    if (success) {
      openSubscriptions.add(String(id));
    }
  }

  function handlePortfolio(data) {
    const positions =
      data.portfolio?.contracts || [];

    if (!Array.isArray(positions)) return;

    for (const item of positions) {
      const id = String(item.contract_id || "");

      if (!id) continue;

      if (!contracts.has(id)) {
        contracts.set(id, {
          id,
          symbol:
            item.underlying_symbol ||
            item.symbol ||
            "Market",
          contract_type:
            item.contract_type || "Contract",
          buy_price: Number(item.buy_price || 0),
          profit: 0,
          status: "open",
          currency
        });
      }

      subscribeContract(id);
    }

    renderTrades();
  }

  function handleContract(data) {
    const result = data.proposal_open_contract;

    if (!result?.contract_id) return;

    const id = String(result.contract_id);

    const previous = contracts.get(id) || {};

    const sold =
      result.is_sold === 1 ||
      result.is_sold === true;

    const expired =
      result.is_expired === 1 ||
      result.is_expired === true;

    const rawStatus = String(
      result.status || ""
    ).toLowerCase();

    const settled =
      sold ||
      rawStatus === "won" ||
      rawStatus === "lost" ||
      rawStatus === "sold" ||
      (expired && result.sell_price != null);


    const buyPrice = Number(
      result.buy_price ??
      previous.buy_price ??
      0
    );

    const sellPrice = Number(result.sell_price);

    const reportedProfit = Number(result.profit);

    const hasProfit =
      result.profit !== undefined &&
      result.profit !== null &&
      Number.isFinite(reportedPr
