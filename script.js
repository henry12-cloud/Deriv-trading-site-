(() => {
  "use strict";

  const state = {
    appId: null,
    connected: false,
    account: null,

    markets: [],
    symbol: null,

    price: null,
    prices: [],

    direction: null,
    proposal: null,

    tradingEnabled: false,

    socket: null,
    tradingSocket: null,

    contracts: new Map(),

    requestId: 1
  };


  const ui = {
    connectionStatus:
      document.getElementById("connectionStatus"),

    accountStatus:
      document.getElementById("accountStatus"),

    accountId:
      document.getElementById("accountId"),

    balance:
      document.getElementById("balance"),

    loginBtn:
      document.getElementById("loginBtn"),

    logoutBtn:
      document.getElementById("logoutBtn"),

    marketStatus:
      document.getElementById("marketStatus"),

    marketSelect:
      document.getElementById("marketSelect"),

    selectedMarket:
      document.getElementById("selectedMarket"),

    livePrice:
      document.getElementById("livePrice"),

    priceStatus:
      document.getElementById("priceStatus"),

    chart:
      document.getElementById("chart"),

    amount:
      document.getElementById("amount"),

    duration:
      document.getElementById("duration"),

    riseBtn:
      document.getElementById("riseBtn"),

    fallBtn:
      document.getElementById("fallBtn"),

    directionStatus:
      document.getElementById("directionStatus"),

    quoteStatus:
      document.getElementById("quoteStatus"),

    askPrice:
      document.getElementById("askPrice"),

    payout:
      document.getElementById("payout"),

    buyBtn:
      document.getElementById("buyBtn"),

    tradeMessage:
      document.getElementById("tradeMessage"),

    openContracts:
      document.getElementById("openContracts"),

    wins:
      document.getElementById("wins"),

    losses:
      document.getElementById("losses"),

    totalProfit:
      document.getElementById("totalProfit"),

    tradeHistory:
      document.getElementById("tradeHistory")
  };


  function setText(element, value) {
    if (!element) {
      return;
    }

    element.textContent =
      value === undefined ||
      value === null
        ? "--"
        : String(value);
  }


  function money(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return "--";
    }

    return number.toFixed(2);
  }


  function nextId() {
    return state.requestId++;
  }


  function send(socket, message) {
    if (
      socket &&
      socket.readyState === WebSocket.OPEN
    ) {
      socket.send(
        JSON.stringify(message)
      );

      return true;
    }

    return false;
  }


  /* =======================================================
     CONFIG
  ======================================================= */

  async function loadConfig() {
    try {
      const response =
        await fetch(
          "/api/config",
          {
            cache: "no-store"
          }
        );

      if (!response.ok) {
        throw new Error(
          "Config request failed"
        );
      }

      const config =
        await response.json();

      state.appId =
        config.app_id || null;

      state.tradingEnabled =
        config.real_trading_enabled === true;

      if (!state.appId) {
        setText(
          ui.connectionStatus,
          "Server configuration error"
        );

        return false;
      }

      setText(
        ui.connectionStatus,
        "Connected to Deriv ✓"
      );

      return true;

    } catch (error) {
      console.error(
        "Config error:",
        error
      );

      setText(
        ui.connectionStatus,
        "Unable to connect to server"
      );

      return false;
    }
  }


  /* =======================================================
     ACCOUNT
  ======================================================= */

  async function loadAccount() {
    try {
      setText(
        ui.accountStatus,
        "Checking account..."
      );

      const response =
        await fetch(
          "/api/account",
          {
            cache: "no-store"
          }
        );

      if (response.status === 401) {
        state.connected = false;
        state.account = null;

        setText(
          ui.accountStatus,
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

        if (ui.loginBtn) {
          ui.loginBtn.hidden = false;
        }

        if (ui.logoutBtn) {
          ui.logoutBtn.hidden = true;
        }

        updateBuyButton();

        return;
      }

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
          "Account request failed"
        );
      }

      state.connected =
        data.connected === true;

      state.account =
        data.account || null;

      if (state.account) {
        setText(
          ui.accountStatus,
          "Connected to Deriv ✓"
        );

        setText(
          ui.accountId,
          state.account.id || "--"
        );

        if (
          state.account.balance !== null &&
          state.account.balance !== undefined
        ) {
          setText(
            ui.balance,
            `${money(state.account.balance)} ${state.account.currency || "USD"}`
          );
        } else {
          setText(
            ui.balance,
            "--"
          );
        }

        if (ui.loginBtn) {
          ui.loginBtn.hidden = true;
        }

        if (ui.logoutBtn) {
          ui.logoutBtn.hidden = false;
        }

      } else {
        setText(
          ui.accountStatus,
          "No account found"
        );
      }

      updateBuyButton();

    } catch (error) {
      console.error(
        "Account error:",
        error
      );

      setText(
        ui.accountStatus,
        "Unable to check account"
      );
    }
  }


  /* =======================================================
     PUBLIC DERIV CONNECTION
  ======================================================= */

  function connectPublicSocket() {
    if (state.socket) {
      try {
        state.socket.close();
      } catch (_) {}
    }

    const url =
      "wss://api.derivws.com/trading/v1/options/ws/public";

    state.socket =
      new WebSocket(url);

    state.socket.onopen = () => {
      setText(
        ui.marketStatus,
        "Loading markets..."
      );

      send(
        state.socket,
        {
          active_symbols: "brief",
          req_id: nextId()
        }
      );
    };


    state.socket.onmessage = event => {
      try {
        const data =
          JSON.parse(
            event.data
          );

        handlePublicMessage(data);

      } catch (error) {
        console.error(
          "Public message error:",
          error
        );
      }
    };


    state.socket.onerror = error => {
      console.error(
        "Public WebSocket error:",
        error
      );

      setText(
        ui.connectionStatus,
        "Deriv market connection error"
      );
    };


    state.socket.onclose = () => {
      setText(
        ui.priceStatus,
        "Market connection closed"
      );
    };
  }


  /* =======================================================
     PUBLIC MESSAGES
  ======================================================= */

  function handlePublicMessage(data) {
    if (data.active_symbols) {
      loadMarkets(
        data.active_symbols
      );

      return;
    }

    if (data.tick) {
      handleTick(
        data.tick
      );

      return;
    }

    if (data.proposal) {
      handleProposal(
        data.proposal
      );

      return;
    }

    if (data.error) {
      console.error(
        "Deriv error:",
        data.error
      );

      setText(
        ui.quoteStatus,
        data.error.message ||
        "Quote error"
      );
    }
  }


  /* =======================================================
     MARKETS
  ======================================================= */

  function loadMarkets(list) {
    if (!Array.isArray(list)) {
      setText(
        ui.marketStatus,
        "No markets returned by Deriv"
      );

      return;
    }

    state.markets =
      list.filter(
        market =>
          market &&
          market.underlying_symbol
      );

    if (!state.markets.length) {
      setText(
        ui.marketStatus,
        "No markets returned by Deriv"
      );

      return;
    }

    if (ui.marketSelect) {
      ui.marketSelect.innerHTML = "";

      for (const market of state.markets) {
        const option =
          document.createElement("option");

        option.value =
          market.underlying_symbol;

        option.textContent =
          market.underlying_symbol_name ||
          market.underlying_symbol;

        ui.marketSelect.appendChild(
          option
        );
      }
    }

    const preferred =
      state.markets.find(
        market =>
          market.underlying_symbol === "1HZ100V"
      );

    state.symbol =
      preferred
        ? preferred.underlying_symbol
        : state.markets[0].underlying_symbol;

    if (ui.marketSelect) {
      ui.marketSelect.value =
        state.symbol;
    }

    updateSelectedMarket();

    setText(
      ui.marketStatus,
      `${state.markets.length} markets loaded`
    );

    subscribeToMarket();
  }


  function updateSelectedMarket() {
    const market =
      state.markets.find(
        item =>
          item.underlying_symbol === state.symbol
      );

    setText(
      ui.selectedMarket,
      market
        ? (
            market.underlying_symbol_name ||
            market.display_name ||
            market.name ||
            market.underlying_symbol
          )
        : "--"
    );
  }


  function subscribeToMarket() {
    if (
      !state.socket ||
      !state.symbol
    ) {
      return;
    }

    state.prices = [];
    state.proposal = null;

    send(
      state.socket,
      {
        forget_all: "ticks",
        req_id: nextId()
      }
    );

    send(
      state.socket,
      {
        ticks: state.symbol,
        subscribe: 1,
        req_id: nextId()
      }
    );

    requestProposal();
  }


  /* =======================================================
     TICKS
  ======================================================= */

  function handleTick(tick) {
    if (
      tick.symbol &&
      tick.symbol !== state.symbol
    ) {
      return;
    }

    const quote =
      Number(tick.quote);

    if (!Number.isFinite(quote)) {
      return;
    }

    state.price =
      quote;

    state.prices.push(
      quote
    );

    if (state.prices.length > 60) {
      state.prices.shift();
    }

    setText(
      ui.livePrice,
      quote
    );

    setText(
      ui.priceStatus,
      "Live price ✓"
    );

    drawChart();
  }


  /* =======================================================
     CHART
  ======================================================= */

  function drawChart() {
    if (!ui.chart) {
      return;
    }

    const canvas =
      ui.chart;

    const rect =
      canvas.getBoundingClientRect();

    const ratio =
      window.devicePixelRatio || 1;

    canvas.width =
      Math.max(
        1,
        Math.floor(
          rect.width * ratio
        )
      );

    canvas.height =
      Math.max(
        1,
        Math.floor(
          rect.height * ratio
        )
      );

    const ctx =
      canvas.getContext("2d");

    if (!ctx) {
      return;
    }

    ctx.setTransform(
      ratio,
      0,
      0,
      ratio,
      0,
      0
    );

    const width =
      rect.width;

    const height =
      rect.height;

    ctx.clearRect(
      0,
      0,
      width,
      height
    );

    const values =
      state.prices;

    if (values.length < 2) {
      return;
    }

    const min =
      Math.min(...values);

    const max =
      Math.max(...values);

    const range =
      max - min || 1;

    ctx.beginPath();

    values.forEach(
      (value, index) => {
        const x =
          (
            index /
            (values.length - 1)
          ) * width;

        const y =
          height -
          (
            (value - min) /
            range
          ) *
          (height - 20) -
          10;

        if (index === 0) {
          ctx.moveTo(
            x,
            y
          );
        } else {
          ctx.lineTo(
            x,
            y
          );
        }
      }
    );

    ctx.stroke();
  }


  /* =======================================================
     DIRECTION
  ======================================================= */

  function selectDirection(direction) {
    state.direction =
      direction;

    state.proposal = null;

    setText(
      ui.directionStatus,
      `Selected: ${direction}`
    );

    requestProposal();

    updateBuyButton();
  }


  /* =======================================================
     PROPOSAL
  ======================================================= */

  function requestProposal() {
  if (
    !state.socket ||
    state.socket.readyState !== WebSocket.OPEN ||
    !state.symbol ||
    !state.direction
  ) {
    return;
  }

  const amount =
    Number(
      ui.amount?.value
    );

  const duration =
    Number(
      ui.duration?.value
    );

  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    setText(
      ui.quoteStatus,
      "Enter valid trade details."
    );
    return;
  }

  const contractType =
    state.direction === "RISE"
      ? "CALL"
      : "PUT";

  state.proposal = null;
  state.proposalId = null;
  state.askPrice = 0;
  state.payout = 0;

  send(
    state.socket,
    {
      proposal: 1,
      amount,
      basis: "stake",
      contract_type: contractType,
      currency: "USD",
      duration,
      duration_unit: "t",
      symbol: state.symbol,
      req_id: nextId()
    }
  );

  setText(
    ui.quoteStatus,
    "Requesting..."
  );

  setText(
    ui.askPrice,
    "--"
  );

  setText(
    ui.payout,
    "--"
  );

  updateBuyButton();
  }

  function handleProposal(proposal) {
  
function handleProposal(proposal) {
  if (!proposal) {
    return;
  }

  state.proposal = proposal;

  const proposalId =
    proposal.id ??
    proposal.proposal_id ??
    "";

  const askPrice =
    Number(
      proposal.ask_price ??
      proposal.display_value ??
      proposal.buy_price ??
      0
    );

  const payout =
    Number(
      proposal.payout ??
      proposal.sell_price ??
      0
    );

  state.proposalId = proposalId;
  state.askPrice = askPrice;
  state.payout = payout;

  if (ui.quoteStatus) {
    ui.quoteStatus.textContent = "Quote received ✓";
  }

  if (ui.askPrice) {
    ui.askPrice.textContent =
      askPrice > 0
        ? askPrice.toFixed(2)
        : "--";
  }

  if (ui.payout) {
    ui.payout.textContent =
      payout > 0
        ? payout.toFixed(2)
        : "--";
  }

  updateBuyButton();
}

  /* =======================================================
     BUY BUTTON
  ======================================================= */

  function updateBuyButton() {
    if (!ui.buyBtn) {
      return;
    }

    const ready =
      state.connected &&
      state.tradingEnabled &&
      state.direction &&
      state.proposal;

    ui.buyBtn.disabled = !ready;

    setText(
      ui.tradeMessage,
      ready
        ? "Ready to trade."
        : "Trading is currently disabled."
    );
  }


  /* =======================================================
     AUTHENTICATED TRADING CONNECTION
  ======================================================= */

  async function connectTradingSocket() {
    try {
      const response =
        await fetch(
          "/api/trading-connection",
          {
            cache: "no-store"
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        setText(
          ui.tradeMessage,
          data.error ||
          "Unable to connect trading account."
        );

        return false;
      }

      if (!data.ws_url) {
        setText(
          ui.tradeMessage,
          "Trading connection URL missing."
        );

        return false;
      }

      if (state.tradingSocket) {
        try {
          state.tradingSocket.close();
        } catch (_) {}
      }

      state.tradingSocket =
        new WebSocket(data.ws_url);

      state.tradingSocket.onopen = () => {
        console.log(
          "Authenticated Deriv connection opened."
        );
      };

      state.tradingSocket.onmessage =
        event => {
          try {
            const result =
              JSON.parse(event.data);

            handleTradingMessage(result);

          } catch (error) {
            console.error(
              "Trading message error:",
              error
            );
          }
        };

      state.tradingSocket.onerror =
        error => {
          console.error(
            "Trading WebSocket error:",
            error
          );

          setText(
            ui.tradeMessage,
            "Trading connection error."
          );
        };

      state.tradingSocket.onclose = () => {
        console.log(
          "Authenticated Deriv connection closed."
        );
      };

      return true;

    } catch (error) {
      console.error(
        "Trading connection error:",
        error
      );

      setText(
        ui.tradeMessage,
        "Trading connection failed."
      );

      return false;
    }
  }


  /* =======================================================
     EXECUTE BUY
  ======================================================= */

  async function executeBuy() {
    if (
      !state.connected ||
      !state.tradingEnabled ||
      !state.proposal ||
      !state.direction
    ) {
      setText(
        ui.tradeMessage,
        "Trading is not ready."
      );

      return;
    }

    const proposalId =
      state.proposal.id;

    const askPrice =
      Number(
        state.proposal.ask_price
      );

    if (!proposalId) {
      setText(
        ui.tradeMessage,
        "Proposal ID is missing."
      );

      return;
    }

    if (
      !Number.isFinite(askPrice) ||
      askPrice <= 0
    ) {
      setText(
        ui.tradeMessage,
        "Invalid proposal price."
      );

      return;
    }

    setText(
      ui.tradeMessage,
      "Connecting trading account..."
    );

    if (
      !state.tradingSocket ||
      state.tradingSocket.readyState !==
        WebSocket.OPEN
    ) {
      const connected =
        await connectTradingSocket();

      if (!connected) {
        return;
      }

      const opened =
        await waitForSocketOpen(
          state.tradingSocket
        );

      if (!opened) {
        setText(
          ui.tradeMessage,
          "Trading connection timed out."
        );

        return;
      }
    }

    setText(
      ui.tradeMessage,
      "Placing trade..."
    );

    const sent =
      send(
        state.tradingSocket,
        {
          buy: String(proposalId),
          price: askPrice,
          req_id: nextId()
        }
      );

    if (!sent) {
      setText(
        ui.tradeMessage,
        "Trading connection is not ready."
      );

      return;
    }

    if (ui.buyBtn) {
      ui.buyBtn.disabled = true;
    }
  }


  function waitForSocketOpen(socket) {
    return new Promise(resolve => {
      if (
        socket &&
        socket.readyState ===
          WebSocket.OPEN
      ) {
        resolve(true);
        return;
      }

      if (!socket) {
        resolve(false);
        return;
      }

      const timeout =
        setTimeout(
          () => {
            resolve(false);
          },
          10000
        );

      const previousOpen =
        socket.onopen;

      socket.onopen =
        event => {
          clearTimeout(timeout);

          if (
            typeof previousOpen ===
              "function"
          ) {
            previousOpen(event);
          }

          resolve(true);
        };
    });
  }


  /* =======================================================
     TRADING MESSAGES
  ======================================================= */

  function handleTradingMessage(result) {
    if (result.error) {
      console.error(
        "Trading API error:",
        result.error
      );

      setText(
        ui.tradeMessage,
        result.error.message ||
        "Trading error"
      );

      updateBuyButton();

      return;
       }

    if (result.buy) {
      handleBuyResponse(
        result.buy
      );

      return;
    }

    if (result.proposal_open_contract) {
      handleContract(
        result.proposal_open_contract
      );

      return;
    }

    if (result.balance) {
      const balance =
        Number(
          result.balance.balance
        );

      if (Number.isFinite(balance)) {
        const currency =
          result.balance.currency ||
          state.account?.currency ||
          "USD";

        setText(
          ui.balance,
          `${money(balance)} ${currency}`
        );
      }
    }
  }


  /* =======================================================
     BUY RESPONSE
  ======================================================= */

  function handleBuyResponse(buy) {
    const id =
      String(
        buy.contract_id ||
        buy.transaction_id ||
        ""
      );

    if (!id) {
      setText(
        ui.tradeMessage,
        "Trade accepted but contract ID is missing."
      );

      updateBuyButton();

      return;
    }

    const buyPrice =
      Number(
        buy.buy_price
      );

    state.contracts.set(
      id,
      {
        id,

        symbol:
          state.symbol ||
          "Market",

        contract_type:
          state.direction ||
          "Contract",

        buy_price:
          Number.isFinite(buyPrice)
            ? buyPrice
            : 0,

        profit: null,

        status:
          "open",

        currency:
          state.account?.currency ||
          "USD",

        sell_price: null,

        payout: null,

        entry_spot: null,

        exit_spot: null
      }
    );

    setText(
      ui.tradeMessage,
      `Trade opened ✓ Contract ${id}`
    );

    renderTrades();

    subscribeContract(id);

    state.proposal = null;

    updateBuyButton();
  }


  /* =======================================================
     CONTRACT SUBSCRIPTION
  ======================================================= */

  function subscribeContract(id) {
    if (
      !state.tradingSocket ||
      state.tradingSocket.readyState !==
        WebSocket.OPEN
    ) {
          return;
    }

    send(
      state.tradingSocket,
      {
        proposal_open_contract: 1,
        contract_id: id,
        subscribe: 1,
        req_id: nextId()
      }
    );
  }


  /* =======================================================
     CONTRACT RESULT
  ======================================================= */

  function handleContract(result) {
    const id =
      String(
        result.contract_id ||
        result.id ||
        ""
      );

    if (!id) {
      return;
    }

    const previous =
      state.contracts.get(id) ||
      {
        id,

        symbol:
          state.symbol ||
          "Market",

        contract_type:
          state.direction ||
          "Contract",

        buy_price: 0,

        profit: null,

        status: "open",

        currency:
          state.account?.currency ||
          "USD"
      };

    const buyPrice =
      Number(
        result.buy_price
      );

    const previousBuyPrice =
      Number(
        previous.buy_price
      );

    const finalBuyPrice =
      Number.isFinite(buyPrice)
        ? buyPrice
        : (
            Number.isFinite(
              previousBuyPrice
            )
              ? previousBuyPrice
              : 0
          );

    const profitValue =
      Number(
        result.profit
      );

    const finalProfit =
      Number.isFinite(profitValue)
        ? profitValue
        : previous.profit;

    const resultStatus =
      String(
        result.status ||
        ""
      ).toLowerCase();

    const status =
      resultStatus ||
      (
        result.is_sold

            ? "sold"
          : previous.status
      );

    const sellPrice =
      Number(
        result.sell_price
      );

    const payout =
      Number(
        result.payout
      );

    const updated = {
      ...previous,

      id,

      buy_price:
        finalBuyPrice,

      profit:
        finalProfit,

      status,

      sell_price:
        Number.isFinite(sellPrice)
          ? sellPrice
          : previous.sell_price,

      payout:
        Number.isFinite(payout)
          ? payout
          : previous.payout,

      entry_spot:
        result.entry_tick ??
        result.entry_spot ??
        previous.entry_spot,

      exit_spot:
        result.exit_tick ??
        result.exit_spot ??
        previous.exit_spot
    };

    state.contracts.set(
      id,
      updated
    );

    renderTrades();

    const finished =
      result.is_sold === 1 ||
      result.is_sold === true ||
      status === "sold" ||
      status === "won" ||
      status === "lost" ||
      status === "expired";

    if (finished) {
      if (
        Number.isFinite(finalProfit)
      ) {
        if (finalProfit > 0) {
          setText(
            ui.tradeMessage,
            `Trade won ✓ Profit ${money(finalProfit)}`
          );
        } else if (finalProfit < 0) {
          setText(
            ui.tradeMessage,
            `Trade lost. Result ${money(finalProfit)}`
          );
        } else {
          setText(
            ui.tradeMessage,
            "Trade finished. Profit 0.00"
          );
        }
      } else {
        setText(
          ui.tradeMessage,
          "Trade finished."
        );
      }

      updateBuyButton();
    }
  }


  /* =======================================================
     TRADE DISPLAY
  ======================================================= */

  function renderTrades() {
    const contracts =
      Array.from(
        state.contracts.values()
      );

    const open =
      contracts.filter(
        contract =>
          !isFinished(contract)
      );

    const finished =
      contracts.filter(
        contract =>
          isFinished(contract)
      );
    if (ui.openContracts) {
      ui.openContracts.innerHTML = "";

      if (!open.length) {
        const empty =
          document.createElement("div");

        empty.textContent =
          "No open contracts.";

        ui.openContracts.appendChild(
          empty
        );

      } else {
        for (const contract of open) {
          const box =
            document.createElement("div");

          box.className =
            "open-contract";

          const title =
            document.createElement("strong");

          title.textContent =
            `${contract.contract_type} — ${contract.symbol}`;

          const details =
            document.createElement("div");

          details.textContent =
            `Contract: ${contract.id} | Buy: ${money(contract.buy_price)}`;

          box.appendChild(title);
          box.appendChild(details);

          ui.openContracts.appendChild(
            box
          );
        }
      }
    }

    let wins = 0;
    let losses = 0;
    let totalProfit = 0;

    for (const contract of finished) {
      const profit =
        Number(
          contract.profit
        );

      if (!Number.isFinite(profit)) {
        continue;
      }

      totalProfit += profit;

      if (profit > 0) {
        wins++;
      } else if (profit < 0) {
        losses++;
      }
    }

    setText(ui.wins, wins);
    setText(ui.losses, losses);

    setText(
      ui.totalProfit,
      money(totalProfit)
    );

    if (ui.tradeHistory) {
      ui.tradeHistory.innerHTML = "";

      if (!finished.length) {
        const empty =
          document.createElement("div");

        empty.textContent =
          "No completed trades yet.";

        ui.tradeHistory.appendChild(
          empty
        );

      } else {
        const sorted =
          finished.slice().reverse();

        for (const contract of sorted) {
          const row =
            document.createElement("div");

          row.className =
            "trade-history-row";

          const profit =
            Number(
              contract.profit
            );

          const resultText =
            Number.isFinite(profit)
              ? (
                  profit > 0
                    ? `+${money(profit)}`
                    : money(profit)
                )
              : "--";

          row.textContent =
            `${contract.contract_type} | ${contract.symbol} | ${resultText}`;

          ui.tradeHistory.appendChild(
            row
          );
        }
      }
    }
  }


  function isFinished(contract) {
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


  /* =======================================================
     LOGOUT
  ======================================================= */

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

    state.connected = false;
    state.account = null;
    state.proposal = null;

    state.contracts.clear();

    if (state.tradingSocket) {
      try {
        state.tradingSocket.close();
      } catch (_) {}
    }

    state.tradingSocket = null;

    setText(
      ui.accountStatus,
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

    if (ui.loginBtn) {
      ui.loginBtn.hidden = false;
    }

    if (ui.logoutBtn) {
      ui.logoutBtn.hidden = true;
    }

    renderTrades();

    updateBuyButton();
  }


  /* =======================================================
     EVENTS
  ======================================================= */

  function setupEvents() {
    if (ui.riseBtn) {
      ui.riseBtn.addEventListener(
        "click",
        () => {
          selectDirection("RISE");
        }
      );
    }

    if (ui.fallBtn) {
      ui.fallBtn.addEventListener(
        "click",
        () => {
          selectDirection("FALL");
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
        () => {
          window.location.href =
            "/login";
        }
      );
    }
        if (ui.marketSelect) {
      ui.marketSelect.addEventListener(
        "change",
        () => {
          state.symbol =
            ui.marketSelect.value;

          updateSelectedMarket();

          subscribeToMarket();
        }
      );
    }

    if (ui.amount) {
      ui.amount.addEventListener(
        "input",
        requestProposal
      );

      ui.amount.addEventListener(
        "change",
        requestProposal
      );
    }

    if (ui.duration) {
      ui.duration.addEventListener(
        "input",
        requestProposal
      );

      ui.duration.addEventListener(
        "change",
        requestProposal
      );
    }

    window.addEventListener(
      "resize",
      drawChart
    );
  }


  /* =======================================================
     START
  ======================================================= */

  async function start() {
    setupEvents();

    renderTrades();

    const configReady =
      await loadConfig();

    if (!configReady) {
      return;
    }

    await loadAccount();

    connectPublicSocket();
  }


  start();

})();
