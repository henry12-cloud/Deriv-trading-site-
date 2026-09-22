const connectionStatus = document.getElementById("connectionStatus");
const marketSelect = document.getElementById("marketSelect");
const loginButton = document.getElementById("loginButton");
const selectedMarket = document.getElementById("selectedMarket");
const accountStatus = document.getElementById("accountStatus");
const accountBalance = document.getElementById("accountBalance");
const livePrice = document.getElementById("livePrice");
const chartPrice = document.getElementById("chartPrice");
const marketStatus = document.getElementById("marketStatus");
const lastUpdate = document.getElementById("lastUpdate");

const tradeAmount = document.getElementById("tradeAmount");
const tradeDuration = document.getElementById("tradeDuration");
const riseButton = document.getElementById("riseButton");
const fallButton = document.getElementById("fallButton");
const tradeStatus = document.getElementById("tradeStatus");

const askPrice = document.getElementById("askPrice");
const payout = document.getElementById("payout");


// ======================================
// DERIV WEBSOCKET CONNECTION
// ======================================

const socket = new WebSocket(
    "wss://api.derivws.com/trading/v1/options/ws/public?app_id=34qPaViEQZZw84Mc5thoO"
);

// ======================================
// CONNECTION OPEN
// ======================================

socket.onopen = function () {

    console.log("CONNECTED TO DERIV");

    connectionStatus.textContent =
        "Connected to Deriv ✓";

    marketStatus.textContent =
        "Loading markets...";

    socket.send(JSON.stringify({
        active_symbols: "brief",
        req_id: 1
    }));
};


// ======================================
// CONNECTION ERROR
// ======================================

socket.onerror = function (error) {

    console.log(
        "DERIV CONNECTION ERROR:",
        error
    );

    connectionStatus.textContent =
        "Deriv connection error";
};


// ======================================
// CONNECTION CLOSED
// ======================================

socket.onclose = function () {

    console.log(
        "DERIV CONNECTION CLOSED"
    );

    connectionStatus.textContent =
        "Deriv connection closed";
};


// ======================================
// DERIV MESSAGES
// ======================================

socket.onmessage = function (event) {

    console.log(
        "DERIV RESPONSE:",
        event.data
    );

    const data = JSON.parse(event.data);


    // ==================================
    // DERIV ERROR
    // ==================================

    if (data.error) {

        console.log(
            "DERIV ERROR:",
            data.error
        );

        tradeStatus.textContent =
            "Trade error: " +
            data.error.message;

        return;
    }


    // ==================================
    // MARKETS
    // ==================================

    if (data.msg_type === "active_symbols") {

        console.log(
            "MARKETS RECEIVED:",
            data.active_symbols
        );

        if (
            !data.active_symbols ||
            data.active_symbols.length === 0
        ) {

            marketStatus.textContent =
                "No markets returned";

            return;
        }

        marketSelect.innerHTML = "";

        data.active_symbols.forEach(
            function (market) {

                const option =
                    document.createElement("option");

                option.value =
                    market.underlying_symbol;

                option.textContent =
                    market.underlying_symbol_name ||
                    market.display_name ||
                    market.underlying_symbol;

                marketSelect.appendChild(
                    option
                );
            }
        );

        marketStatus.textContent =
            data.active_symbols.length +
            " markets loaded";

        marketSelect.dispatchEvent(
            new Event("change")
        );
    }


    // ==================================
    // LIVE PRICE
    // ==================================

    if (data.msg_type === "tick") {

        if (!data.tick) {
            return;
        }

        const price =
            data.tick.quote;

        livePrice.textContent =
            "Live Price: " + price;

        chartPrice.textContent =
            "Current Price: " + price;

        lastUpdate.textContent =
            "Last update: " +
            new Date().toLocaleTimeString();
    }


    // ==================================
    // CONTRACT INFORMATION
    // ==================================

    if (data.msg_type === "contracts_for") {

        console.log(
            "CONTRACTS FOR:",
            data
        );

        if (!data.contracts_for) {

            tradeStatus.textContent =
                "No contract information returned.";

            return;
        }

        const available =
            data.contracts_for.available;

        if (
            !available ||
            available.length === 0
        ) {

            tradeStatus.textContent =
                "No RISE/FALL contracts available.";

            return;
        }

        console.log(
            "AVAILABLE CONTRACTS:",
            available
        );

        tradeStatus.textContent =
            available.length +
            " contracts available ✓";
    }


    // ==================================
    // ACCOUNT AUTHORIZATION
    // ==================================

    if (data.msg_type === "authorize") {

        console.log(
            "ACCOUNT AUTHORIZED:",
            data
        );

        if (data.authorize) {

            accountStatus.textContent =
                "Account: " +
                (data.authorize.loginid || "--");

            accountBalance.textContent =
                "Balance: " +
                (data.authorize.balance || "--") +
                " " +
                (data.authorize.currency || "");

            tradeStatus.textContent =
                "Account connected ✓";
        }
    }


    // ==================================
    // PROPOSAL / QUOTE
    // ==================================

    if (data.msg_type === "proposal") {

        console.log(
            "PROPOSAL RECEIVED:",
            data
        );

        if (!data.proposal) {

            tradeStatus.textContent =
                "No quote received.";

            return;
        }

        const proposal =
            data.proposal;

        askPrice.textContent =
            proposal.ask_price ?? "--";

        payout.textContent =
            proposal.payout ?? "--";

        tradeStatus.textContent =
            "Quote received ✓";
    }
};


// ======================================
// MARKET SELECTION
// ======================================

marketSelect.addEventListener(
    "change",
    function () {

        const symbol =
            marketSelect.value;

        const selectedOption =
            marketSelect.options[
                marketSelect.selectedIndex
            ];

        if (!symbol || !selectedOption) {
            return;
        }

        const name =
            selectedOption.text;

        selectedMarket.textContent =
            "Selected market: " + name;

        livePrice.textContent =
            "Live Price: Loading...";

        chartPrice.textContent =
            "Current Price: Loading...";

        console.log(
            "SUBSCRIBING TO:",
            symbol
        );

        socket.send(JSON.stringify({

            ticks: symbol,

            subscribe: 1

        }));
    }
);


// ======================================
// RISE / FALL PROPOSALS
// ======================================

function requestProposal(contractType) {

    const symbol =
        marketSelect.value;

    const amount =
        Number(tradeAmount.value);

    const duration =
        Number(tradeDuration.value);


    if (!symbol) {

        tradeStatus.textContent =
            "Please select a market first.";

        return;
    }


    if (!amount || amount <= 0) {

        tradeStatus.textContent =
            "Please enter a valid trade amount.";

        return;
    }


    if (!duration || duration <= 0) {

        tradeStatus.textContent =
            "Please enter a valid duration.";

        return;
    }


    tradeStatus.textContent =
        "Requesting " +
        contractType +
        " quote...";


    socket.send(JSON.stringify({

        proposal: 1,

        amount: amount,

        basis: "stake",

        contract_type: contractType,

        currency: "USD",

        duration: duration,

        duration_unit: "s",

        underlying_symbol: symbol,

        subscribe: 1,

        req_id: 10

    }));
}


// ======================================
// RISE BUTTON
// ======================================

riseButton.addEventListener(
    "click",
    function () {

        requestProposal("CALL");

    }
);


// ======================================
// FALL BUTTON
// ======================================

fallButton.addEventListener(
    "click",
    function () {

        requestProposal("PUT");

    }
);


// ======================================
// DERIV LOGIN
// ======================================

loginButton.addEventListener(
    "click",
    function () {

        tradeStatus.textContent =
            "Opening Deriv login...";

        window.location.href =
            "https://tradedollars.onrender.com/login";

    }
);

// ======================================
// CHECK DERIV ACCOUNT STATUS
// ======================================

async function checkAccountStatus() {

    try {

        const response =
            await fetch("/account-status");

        const data =
            await response.json();

        const accountStatus =
            document.getElementById("accountStatus");

        if (data.connected) {

            accountStatus.textContent =
                "Account: Connected to Deriv ✓";

        } else {

            accountStatus.textContent =
                "Account: Not connected";

        }

    } catch (error) {

        console.error(
            "Account status error:",
            error
        );

    }
}

checkAccountStatus();
