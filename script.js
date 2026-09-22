nst connectionStatus = document.getElementById("connectionStatus");
const marketSelect = document.getElementById("marketSelect");
const selectedMarket = document.getElementById("selectedMarket");
const loginButton = document.getElementById("loginButton");
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

const socket = new WebSocket(
    "wss://api.derivws.com/trading/v1/options/ws/public?app_id=34qPaViEQZZw84Mc5thoO"
);

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

socket.onmessage = function (event) {

    console.log("DERIV RESPONSE:", event.data);

    const data = JSON.parse(event.data);

if (data.error) {

    console.log("DERIV ERROR:", data.error);

    tradeStatus.textContent =
        "Trade error: " + data.error.message;

    return;
}
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

        data.active_symbols.forEach(function (market) {

            const option =
                document.createElement("option");

            option.value =
                market.underlying_symbol;

            option.textContent =
                market.underlying_symbol_name ||
                market.underlying_symbol;

            marketSelect.appendChild(option);
        });

        marketStatus.textContent =
            data.active_symbols.length +
            " markets loaded";

        marketSelect.dispatchEvent(
            new Event("change")
        );
    }

    if (data.msg_type === "tick") {

        if (!data.tick) {
            return;
        }

        const price = data.tick.quote;

        livePrice.textContent =
            "Live Price: " + price;

        chartPrice.textContent =
            "Current Price: " + price;

        lastUpdate.textContent =
            "Last update: " +
            new Date().toLocaleTimeString();
    }

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

        if (!available || available.length === 0) {

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
// ===============================
// ACCOUNT AUTHORIZATION
// ===============================

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

        const proposal = data.proposal;

        askPrice.textContent =
            "Ask Price: " +
            (proposal.ask_price ?? "--");

        payout.textContent =
            "Potential Payout: " +
            (proposal.payout ?? "--");

        tradeStatus.textContent =
            "Quote received ✓";
    }
};

socket.onerror = function (error) {

    console.log("WEBSOCKET ERROR:", error);
    connectionStatus.textContent =
        "Connection error";
};

socket.onclose = function () {

    console.log("CONNECTION CLOSED");

    connectionStatus.textContent =
        "Disconnected from Deriv";
};

marketSelect.addEventListener(
    "change",
    function () {

        const symbol =
            marketSelect.value;

        const name =
            marketSelect.options[
                marketSelect.selectedIndex
            ].text;

        if (!symbol) {
            return;
        }

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
// ===============================
// RISE / FALL PROPOSALS
// ===============================

const tradeAmount = document.getElementById("tradeAmount");
const tradeDuration = document.getElementById("tradeDuration");
const riseButton = document.getElementById("riseButton");
const fallButton = document.getElementById("fallButton");
const tradeStatus = document.getElementById("tradeStatus");

function requestProposal(contractType) {

    const symbol = marketSelect.value;
    const amount = Number(tradeAmount.value);
    const duration = Number(tradeDuration.value);

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
        "Requesting " + contractType + " quote...";

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


// RISE button
riseButton.addEventListener("click", function () {

    requestProposal("CALL");

});

fallButton.addEventListener("click", function () {

    requestProposal("PUT");

});

// ===============================
// DERIV LOGIN
// ===============================

loginButton.addEventListener("click", function () {

    tradeStatus.textContent =
        "Opening Deriv login...";

    window.open(
        "https://oauth.deriv.com/oauth2/authorize?app_id=34qPaViEQZZw84Mc5thoO&l=en&brand=deriv",
        "_blank"
    );

});
// ===============================
// CHECK DERIV LOGIN RESULT
// ===============================

const urlParams = new URLSearchParams(
    window.location.search
);

const acct1 = urlParams.get("acct1");
const token1 = urlParams.get("token1");

if (acct1 && token1) {

    accountStatus.textContent =
        "Account: " + acct1;

    accountBalance.textContent =
        "Balance: Loading...";

    tradeStatus.textContent =
        "Deriv account connected ✓";

    socket.send(JSON.stringify({
        authorize: token1,
        req_id: 100
    }));
                }
