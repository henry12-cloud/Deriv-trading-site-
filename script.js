"use strict";

// =====================================================
// TRADEDOLLARS - DERIV THIRD-PARTY TRADING INTERFACE
// =====================================================

document.addEventListener("DOMContentLoaded", () => {

    // -------------------------------------------------
    // ELEMENTS
    // -------------------------------------------------

    const el = (id) => document.getElementById(id);

    const connectionStatus = el("connectionStatus");
    const marketSelect = el("marketSelect");
    const marketStatus = el("marketStatus");
    const selectedMarket = el("selectedMarket");

    const livePrice = el("livePrice");
    const chartPrice = el("chartPrice");
    const lastUpdate = el("lastUpdate");

    const quoteStatus = el("quoteStatus");
    const askPrice = el("askPrice");
    const potentialPayout = el("potentialPayout");

    const tradeAmount = el("tradeAmount");
    const duration = el("duration");

    const riseButton = el("riseButton");
    const fallButton = el("fallButton");

    const tradeStatus = el("tradeStatus");

    const loginButton = el("loginButton");
    const accountStatus = el("accountStatus");
    const balance = el("balance");

    const canvas = el("chart");

    // -------------------------------------------------
    // DERIV PUBLIC MARKET API
    // -------------------------------------------------

    const API =
        "wss://api.derivws.com/trading/v1/options/ws/public?app_id=34qPaViEQZZw84Mc5thoO";

    let socket = null;
    let markets = [];
    let currentSymbol = "";
    let currentPrice = null;

    // -------------------------------------------------
    // SAFE TEXT HELPER
    // -------------------------------------------------

    function setText(element, value) {
        if (element) {
            element.textContent = value;
        }
    }

    // -------------------------------------------------
    // STATUS
    // -------------------------------------------------

    setText(connectionStatus, "Connecting to Deriv...");
    setText(marketStatus, "Loading markets...");
    setText(selectedMarket, "Selected market: None");
    setText(livePrice, "Live Price: --");
    setText(chartPrice, "Current Price: --");
    setText(lastUpdate, "Last update: --");
    setText(quoteStatus, "Quote: Waiting...");
    setText(askPrice, "Ask Price: --");
    setText(potentialPayout, "Potential Payout: --");
    setText(accountStatus, "Account: Not connected");
    setText(balance, "Balance: --");

    // -------------------------------------------------
    // CONNECT
    // -------------------------------------------------

    function connect() {

        try {
            socket = new WebSocket(API);
        } catch (error) {
            setText(connectionStatus, "Connection failed");
            console.error(error);
            return;
        }

        socket.onopen = () => {

            setText(
                connectionStatus,
                "Connected to Deriv ✓"
            );

            socket.send(JSON.stringify({
                active_symbols: "brief",
                req_id: 1
            }));
        };

        socket.onmessage = (event) => {

            let data;

            try {
                data = JSON.parse(event.data);
            } catch (error) {
                console.error("Invalid Deriv message:", event.data);
                return;
            }

            console.log("DERIV:", data);

            // -----------------------------------------
            // MARKETS
            // -----------------------------------------

            if (data.msg_type === "active_symbols") {

                markets = data.active_symbols || [];

                setText(
                    marketStatus,
                    markets.length + " markets loaded"
                );

                if (!marketSelect) return;

                marketSelect.innerHTML = "";

                markets.forEach((market) => {

                    const option =
                        document.createElement("option");

                    option.value = market.symbol;

                    option.textContent =
                        market.display_name ||
                        market.symbol;

                    marketSelect.appendChild(option);
                });

                // Select Volatility 100 (1s) if available
                const preferred =
                    markets.find(
                        (m) =>
                            m.symbol === "1HZ100V" ||
                            (m.display_name || "")
                                .toLowerCase()
                                .includes("volatility 100 (1s)")
                    );

                if (preferred) {
                    marketSelect.value = preferred.symbol;
                }

                if (marketSelect.value) {
                    currentSymbol = marketSelect.value;
                    updateSelectedMarket();
                    subscribePrice(currentSymbol);
                }

                return;
            }

            // -----------------------------------------
            // LIVE QUOTE
            // -----------------------------------------

            if (data.msg_type === "tick") {

                const tick = data.tick;

                if (!tick) return;

                currentPrice = Number(tick.quote);

                setText(
                    livePrice,
                    "Live Price: " +
                    currentPrice.toFixed(2)
                );

                setText(
                    chartPrice,
                    "Current Price: " +
                    currentPrice.toFixed(2)
                );

                setText(
                    lastUpdate,
                    "Last update: " +
                    new Date().toLocaleTimeString()
                );

                drawChart(currentPrice);

                return;
            }

            // -----------------------------------------
            // CONTRACTS
            // -----------------------------------------

            if (data.msg_type === "contracts_for") {

                const available =
                    data.contracts_for?.available ||
                    [];

                setText(
                    tradeStatus,
                    available.length +
                    " contracts available ✓"
                );

                return;
            }

            // -----------------------------------------
            // PROPOSAL
            // -----------------------------------------

            if (data.msg_type === "proposal") {

                if (data.proposal) {

                    const proposal =
                        data.proposal;

                    const ask =
                        Number(proposal.ask_price);

                    const payout =
                        Number(proposal.payout);

                    if (!isNaN(ask)) {
                        setText(
                            askPrice,
                            "Ask Price: " +
                            ask.toFixed(2)
                        );
                    }

                    if (!isNaN(payout)) {
                        setText(
                            potentialPayout,
                            "Potential Payout: " +
                            payout.toFixed(2)
                        );
                    }

                    setText(
                        quoteStatus,
                        "Quote: Received ✓"
                    );

                    setText(
                        tradeStatus,
                        "Quote received ✓"
                    );
                }

                return;
            }

            // -----------------------------------------
            // API ERROR
            // -----------------------------------------

            if (data.error) {

                console.error(
                    "DERIV ERROR:",
                    data.error
                );

                setText(
                    tradeStatus,
                    "Error: " +
                    data.error.message
                );

                setText(
                    quoteStatus,
                    "Quote: Error"
                );

                return;
            }
        };

        socket.onerror = (error) => {

            console.error(
                "Deriv WebSocket error:",
                error
            );

            setText(
                connectionStatus,
                "Connection error"
            );
        };

        socket.onclose = () => {

            setText(
                connectionStatus,
                "Disconnected from Deriv"
            );
        };
    }

    // -------------------------------------------------
    // SUBSCRIBE TO PRICE
    // -------------------------------------------------

    function subscribePrice(symbol) {

        if (!socket) return;

        if (socket.readyState !== WebSocket.OPEN) {
            return;
        }

        socket.send(JSON.stringify({
            forget_all: "ticks"
        }));

        socket.send(JSON.stringify({
            ticks: symbol,
            subscribe: 1,
            req_id: 2
        }));

        currentSymbol = symbol;
    }

    // -------------------------------------------------
    // MARKET CHANGE
    // -------------------------------------------------

    if (marketSelect) {

        marketSelect.addEventListener(
            "change",
            () => {

                currentSymbol =
                    marketSelect.value;

                updateSelectedMarket();

                setText(
                    livePrice,
                    "Live Price: --"
                );

                setText(
                    chartPrice,
                    "Current Price: --"
                );

                currentPrice = null;

                subscribePrice(currentSymbol);
            }
        );
    }

    function updateSelectedMarket() {

        if (!marketSelect) return;

        const option =
            marketSelect.options[
                marketSelect.selectedIndex
            ];

        const name =
            option
                ? option.textContent
                : currentSymbol;

        setText(
            selectedMarket,
            "Selected market: " + name
        );
    }

    // -------------------------------------------------
    // REQUEST CONTRACTS
    // -------------------------------------------------

    function requestContracts() {

        if (!socket) return;

        if (socket.readyState !== WebSocket.OPEN) {
            setText(
                tradeStatus,
                "Waiting for Deriv connection..."
            );
            return;
        }

        if (!currentSymbol) {
            setText(
                tradeStatus,
                "Please select a market"
            );
            return;
        }

        socket.send(JSON.stringify({
            contracts_for: currentSymbol,
            req_id: 20
        }));

        setText(
            tradeStatus,
            "Checking available contracts..."
        );
    }

    // -------------------------------------------------
    // REQUEST PROPOSAL
    // -------------------------------------------------

    function requestProposal(contractType) {

        if (!socket) return;

        if (socket.readyState !== WebSocket.OPEN) {
            setText(
                tradeStatus,
                "Waiting for Deriv connection..."
            );
            return;
        }

        if (!currentSymbol) {
            setText(
                tradeStatus,
                "Please select a market"
            );
            return;
        }

        const amount =
            Number(
                tradeAmount?.value || 1
            );

        const durationValue =
            Number(
                duration?.value || 15
            );

        if (!amount || amount <= 0) {
            setText(
                tradeStatus,
                "Enter a valid trade amount"
            );
            return;
        }

        if (!durationValue || durationValue <= 0) {
            setText(
                tradeStatus,
                "Enter a valid duration"
            );
            return;
        }

        setText(
            quoteStatus,
            "Quote: Requesting..."
        );

        setText(
            tradeStatus,
            "Requesting quote..."
        );

        socket.send(JSON.stringify({
            proposal: 1,
            amount: amount,
            basis: "stake",
            contract_type: contractType,
            currency: "USD",
            duration: durationValue,
            duration_unit: "s",
            symbol: currentSymbol,
            req_id: 30
        }));
    }

    // -------------------------------------------------
    // RISE
    // -------------------------------------------------

    if (riseButton) {

        riseButton.addEventListener(
            "click",
            () => {

                requestContracts();

                setTimeout(() => {
                    requestProposal("CALL");
                }, 300);
            }
        );
    }

    // -------------------------------------------------
    // FALL
    // -------------------------------------------------

    if (fallButton) {

        fallButton.addEventListener(
            "click",
            () => {

                requestContracts();

                setTimeout(() => {
                    requestProposal("PUT");
                }, 300);
            }
        );
    }

    // -------------------------------------------------
    // SIMPLE CHART
    // -------------------------------------------------

    function drawChart(price) {

        if (!canvas) return;

        const ctx =
            canvas.getContext("2d");

        if (!ctx) return;

        const width =
            canvas.width;

        const height =
            canvas.height;

        ctx.clearRect(
            0,
            0,
            width,
            height
        );

        ctx.beginPath();

        const center =
            height / 2;

        const variation =
            Math.sin(Date.now() / 400) * 20;

        ctx.moveTo(
            0,
            center
        );

        for (
            let x = 0;
            x <= width;
            x += 10
        ) {

            const y =
                center +
                Math.sin(
                    (x + Date.now() / 10) / 35
                ) * variation;

            ctx.lineTo(x, y);
        }

        ctx.stroke();
    }

    // -------------------------------------------------
    // LOGIN
    // -------------------------------------------------

    if (loginButton) {

        loginButton.addEventListener(
            "click",
            () => {

                window.location.href =
                    "/login";
            }
        );
    }

    // -------------------------------------------------
    // ACCOUNT STATUS
    // -------------------------------------------------

    async function checkAccount() {

        try {

            const response =
                await fetch(
                    "/api/account",
                    {
                        credentials: "include"
                    }
                );

            const data =
                await response.json();

            if (!data.connected) {

                setText(
                    accountStatus,
                    "Account: Not connected"
                );

                setText(
                    balance,
                    "Balance: --"
                );

                return;
            }

            setText(
                accountStatus,
                "Account: Connected ✓"
            );

            if (loginButton) {

                loginButton.textContent =
                    "LOGGED IN ✓";

                loginButton.disabled =
                    true;
            }

            const accountData =
                data.data;

            let account = null;

            if (
                accountData &&
                Array.isArray(accountData.accounts)
            ) {
                account =
                    accountData.accounts[0];
            }

            if (
                account &&
                account.balance !== undefined
            ) {

                setText(
                    balance,
                    "Balance: " +
                    account.balance +
                    " " +
                    (account.currency || "")
                );
            }

        } catch (error) {

            console.error(
                "Account check error:",
                error
            );
        }
    }

    // -------------------------------------------------
    // LOGIN SUCCESS MESSAGE
    // -------------------------------------------------

    const url =
        new URL(window.location.href);

    if (
        url.searchParams.get("login") ===
        "success"
    ) {

        setText(
            accountStatus,
            "Deriv login successful ✓"
        );

        url.searchParams.delete("login");

        window.history.replaceState(
            {},
            document.title,
            url.pathname +
            url.search
        );
    }

    // -------------------------------------------------
    // START
    // -------------------------------------------------

    connect();

    checkAccount();

});
      
