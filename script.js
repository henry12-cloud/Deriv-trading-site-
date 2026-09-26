"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const API =
    "wss://api.derivws.com/trading/v1/options/ws/public";

  const el = (id) => document.getElementById(id);

  const connectionStatus = el("connectionStatus");
  const accountStatus = el("accountStatus");
  const accountId = el("accountId");
  const balance = el("balance");

  const marketSelect = el("marketSelect");
  const marketStatus = el("marketStatus");
  const selectedMarket = el("selectedMarket");

  const livePrice = el("livePrice");
  const priceStatus = el("priceStatus");

  const quoteStatus = el("quoteStatus");
  const askPrice = el("askPrice");
  const payout = el("payout");

  const amountInput = el("amount");
  const durationInput = el("duration");

  const riseButton = el("riseButton");
  const fallButton = el("fallButton");
  const buyButton = el("buyButton");

  let ws = null;
  let markets = [];
  let currentSymbol = null;
  let currentContractType = null;
  let requestId = 1;

  function setText(element, value) {
    if (element) {
      element.textContent = value;
    }
  }

  function nextRequestId() {
    return requestId++;
  }

  function connect() {
    setText(connectionStatus, "Connecting to Deriv...");

    ws = new WebSocket(API);

    ws.onopen = () => {
      setText(connectionStatus, "Connected to Deriv ✓");

      requestMarkets();
    };

    ws.onmessage = (event) => {
      let data;

      try {
        data = JSON.parse(event.data);
      } catch (error) {
        console.error("Invalid JSON:", error);
        return;
      }

      console.log("Deriv:", data);

      if (data.error) {
        handleDerivError(data.error);
        return;
      }

      if (data.msg_type === "active_symbols") {
        handleMarkets(data.active_symbols || []);
        return;
      }

      if (data.msg_type === "tick") {
        handleTick(data);
        return;
      }

      if (data.msg_type === "proposal") {
        handleProposal(data);
        return;
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      setText(connectionStatus, "Deriv connection error");
    };

    ws.onclose = () => {
      console.log("Deriv WebSocket closed");
    };
  }

  function requestMarkets() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    setText(marketStatus, "Loading markets...");

    ws.send(
      JSON.stringify({
        active_symbols: "brief",
        req_id: nextRequestId()
      })
    );
  }

  function handleMarkets(list) {
    markets = list.filter(
      (market) =>
        market &&
        typeof market.symbol === "string" &&
        market.symbol.length > 0
    );

    if (!markets.length) {
      setText(marketStatus, "No markets returned by Deriv");
      return;
    }

    marketSelect.innerHTML = "";

    markets.forEach((market) => {
      const option = document.createElement("option");

      option.value = market.symbol;

      option.textContent =
        market.display_name ||
        market.name ||
        market.symbol;

      marketSelect.appendChild(option);
    });

    setText(
      marketStatus,
      `${markets.length} markets loaded`
    );

    /*
     * Prefer Volatility 100 (1s) if available.
     * Otherwise use the first valid market.
     */
    const preferred = markets.find(
      (market) =>
        market.symbol === "1HZ100V" ||
        market.display_name === "Volatility 100 (1s) Index"
    );

    const selected = preferred || markets[0];

    currentSymbol = selected.symbol;

    marketSelect.value = currentSymbol;

    updateSelectedMarket();

    subscribeToMarket(currentSymbol);
  }

  function updateSelectedMarket() {
    if (!currentSymbol) {
      setText(selectedMarket, "--");
      return;
    }

    const market = markets.find(
      (item) => item.symbol === currentSymbol
    );

    if (!market) {
      setText(selectedMarket, currentSymbol);
      return;
    }

    setText(
      selectedMarket,
      market.display_name ||
        market.name ||
        market.symbol
    );
  }

  function subscribeToMarket(symbol) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    if (!symbol) {
      setText(selectedMarket, "--");
      return;
    }

    currentSymbol = symbol;

    updateSelectedMarket();

    setText(livePrice, "--");
    setText(priceStatus, "Waiting for live prices...");

    ws.send(
      JSON.stringify({
        ticks: symbol,
        subscribe: 1,
        req_id: nextRequestId()
      })
    );
  }

  function handleTick(data) {
    if (!data.tick) {
      return;
    }

    const quote = data.tick.quote;

    if (quote === undefined || quote === null) {
      return;
    }

    setText(livePrice, quote);
    setText(priceStatus, "Live market price ✓");
  }

  function requestProposal(contractType) {
    if (!currentSymbol) {
      setText(quoteStatus, "Select a valid market first.");
      return;
    }

    const amount = Number(
      amountInput ? amountInput.value : 1
    );

    const duration = Number(
      durationInput ? durationInput.value : 15
    );

    if (!Number.isFinite(amount) || amount <= 0) {
      setText(quoteStatus, "Enter a valid trade amount.");
      return;
    }

    if (!Number.isInteger(duration) || duration <= 0) {
      setText(quoteStatus, "Enter a valid duration.");
      return;
    }

    currentContractType = contractType;

    setText(quoteStatus, "Requesting quote...");
    setText(askPrice, "--");
    setText(payout, "--");

    /*
     * IMPORTANT:
     * Deriv's current API uses underlying_symbol,
     * NOT symbol.
     */
    const request = {
      proposal: 1,
      amount: amount,
      basis: "stake",
      contract_type: contractType,
      currency: "USD",
      duration: duration,
      duration_unit: "t",
      underlying_symbol: currentSymbol,
      req_id: nextRequestId()
    };

    console.log("Proposal request:", request);

    ws.send(JSON.stringify(request));
  }

  function handleProposal(data) {
    if (!data.proposal) {
      setText(quoteStatus, "Quote response was incomplete.");
      return;
    }

    const proposal = data.proposal;

    const price =
      proposal.ask_price !== undefined
        ? proposal.ask_price
        : "--";

    const potentialPayout =
      proposal.payout !== undefined
        ? proposal.payout
        : "--";

    setText(askPrice, price);
    setText(payout, potentialPayout);
    setText(quoteStatus, "Quote received ✓");
  }

  function handleDerivError(error) {
    console.error("Deriv API error:", error);

    const message =
      error.message ||
      error.code ||
      "Deriv request failed.";

    setText(quoteStatus, message);
  }

  if (marketSelect) {
    marketSelect.addEventListener("change", () => {
      const symbol = marketSelect.value;

      if (!symbol) {
        currentSymbol = null;
        setText(selectedMarket, "--");
        return;
      }

      subscribeToMarket(symbol);
    });
  }

  if (riseButton) {
    riseButton.addEventListener("click", () => {
      requestProposal("CALL");
    });
  }

  if (fallButton) {
    fallButton.addEventListener("click", () => {
      requestProposal("PUT");
    });
  }

  if (buyButton) {
    buyButton.addEventListener("click", () => {
      setText(
        quoteStatus,
        "Purchasing is disabled until authenticated trading is configured and tested."
      );
    });
  }

  /*
   * The OAuth/account section is handled by the server.
   * Do not overwrite the successful account information.
   */
  if (accountStatus) {
    console.log("Account status element ready.");
  }

  if (accountId) {
    console.log("Account ID element ready.");
  }

  if (balance) {
    console.log("Balance element ready.");
  }

  connect();
});
