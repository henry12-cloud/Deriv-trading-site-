document.body.insertAdjacentHTML(
    "afterbegin",
    "<h2 style='color:red;text-align:center'>NEW SCRIPT IS RUNNING</h2>"
);

const connectionStatus = document.getElementById("connectionStatus");
const accountStatus = document.getElementById("accountStatus");
const marketSelect = document.getElementById("marketSelect");
const selectedMarket = document.getElementById("selectedMarket");
const livePrice = document.getElementById("livePrice");
const chartPrice = document.getElementById("chartPrice");
const chartStatus = document.getElementById("chartStatus");
const tradeAmount = document.getElementById("tradeAmount");
const tradeDuration = document.getElementById("tradeDuration");
const buyButton = document.getElementById("buyButton");
const proposalStatus = document.getElementById("proposalStatus");
const sellButton = document.getElementById("sellButton");
const loginButton = document.getElementById("loginButton");
const askPrice = document.getElementById("askPrice");
const payout = document.getElementById("payout");
const chartTime = document.getElementById("chartTime");
const marketStatus = document.getElementById("marketStatus");
const chart = document.getElementById("chart");

let prices = [];

/* Connect to Deriv */
const ws = new WebSocket(
    "wss://api.derivws.com/trading/v1/options/ws/public?app_id=34qPaViEQZZw84Mc5thoO"
);

/* Connection opened */
ws.onopen = function () {

    connectionStatus.textContent =
        "Connected to Deriv ✓";

    marketStatus.textContent =
        "Connection successful. Loading markets...";

    ws.send(JSON.stringify({
        active_symbols: "brief",
        req_id: 1
    }));
};

    connectionStatus.textContent =
        "Connected to Deriv ✓";

    console.log("CONNECTED");

    ws.send(JSON.stringify({
        active_symbols: "brief",
        req_id: 1
    }));
};

/* Messages from Deriv */
ws.onmessage = function (event) {

    const data = JSON.parse(event.data);

    console.log("DERIV RESPONSE:", data);

    /* Error */
    if (data.error) {

        console.log("DERIV ERROR:", data.error);

        proposalStatus.textContent =
            "Deriv error: " + data.error.message;

        return;
    }

    /* Markets */
    if (data.active_symbols) {

        marketSelect.innerHTML = "";

        data.active_symbols.forEach(function (market) {

            const option =
                document.createElement("option");

            option.value =
    market.underlying_symbol;

option.textContent =
    market.underlying_symbol_name;
          
            marketSelect.appendChild(option);
        });
 
        marketStatus.textContent =
            data.active_symbols.length +
            " markets loaded";

        if (data.active_symbols.length > 0) {

            subscribeToMarket(
                data.active_symbols[0].underlying_symbol,
                data.active_symbols[0].underlying_symbol_name
            );
        }
    }

    /* Proposal / quote */
    if (data.proposal) {

        proposalStatus.textContent =
            "Quote: Received ✓";

        askPrice.textContent =
            "Ask Price: " +
            data.proposal.ask_price;

        payout.textContent =
            "Potential Payout: " +
            data.proposal.payout;

        console.log(
            "PROPOSAL:",
            data.proposal
        );
    }

    /* Live tick */
    if (data.tick) {

        chartStatus.textContent =
            "Market is live ●";

        chartTime.textContent =
            "Last update: " +
            new Date().toLocaleTimeString();

        const currentPrice =
            Number(data.tick.quote);

        livePrice.textContent =
            currentPrice.toFixed(2);

        chartPrice.textContent =
            currentPrice.toFixed(2);

        prices.push(currentPrice);

        if (prices.length > 30) {
            prices.shift();
        }

        drawChart();
    }
};

/* Subscribe to selected market */
function subscribeToMarket(symbol, name) {

    selectedMarket.textContent =
        "Selected market: " + name;

    ws.send(JSON.stringify({
        ticks: symbol,
        subscribe: 1
    }));
}

/* Market changed */
marketSelect.addEventListener(
    "change",
    function () {

        prices = [];

        const selectedOption =
            marketSelect.options[
                marketSelect.selectedIndex
            ];

        subscribeToMarket(
            marketSelect.value,
            selectedOption.textContent
        );
    }
);

/* Draw chart */
function drawChart() {

    if (!chart) return;

    const ctx = chart.getContext("2d");

    ctx.clearRect(
        0,
        0,
        chart.width,
        chart.height
    );

    if (prices.length < 2) return;

    const min =
        Math.min(...prices);

    const max =
        Math.max(...prices);

    const range =
        max - min || 1;

    ctx.beginPath();

    ctx.strokeStyle = "lime";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    prices.forEach(
        function (value, index) {

            const x =
                (index / (prices.length - 1)) *
                chart.width;

            const y =
                chart.height -
                ((value - min) / range) *
                chart.height;

            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
    );

    ctx.stroke();
}
/* WebSocket error */
/* WebSocket error */
ws.onerror = function () {

    connectionStatus.textContent =
        "Deriv connection failed";

    marketStatus.textContent =
        "Could not connect to Deriv WebSocket.";
};

    connectionStatus.textContent =
        "WebSocket connection error";

    console.log("WebSocket error:", error);
};

/* WebSocket closed */
ws.onclose = function (event) {

    connectionStatus.textContent =
        "Deriv connection closed";

    marketStatus.textContent =
        "WebSocket closed. Code: " +
        event.code;
};

    connectionStatus.textContent =
        "Connection closed";

    console.log(
        "WebSocket closed:",
        event.code,
        event.reason
    );
};
/* BUY button */
buyButton.addEventListener(
    "click",
    function () {

        const symbol =
            marketSelect.value;

        const amount =
            Number(tradeAmount.value);

        proposalStatus.textContent =
            "Requesting BUY quote...";

        ws.send(JSON.stringify({

            proposal: 1,

            amount: amount,

            basis: "stake",

            contract_type: "CALL",

            currency: "USD",

            duration: Number(tradeDuration.value),

            duration_unit: "t",

            underlying_symbol: symbol
        }));
    }
);
/* SELL button */
sellButton.addEventListener(
    "click",
    function () {

        const symbol =
            marketSelect.value;

        const amount =
            Number(tradeAmount.value);

        proposalStatus.textContent =
            "Requesting SELL quote...";

        ws.send(JSON.stringify({

            proposal: 1,

            amount: amount,

            basis: "stake",

            contract_type: "PUT",

            currency: "USD",

            duration: Number(tradeDuration.value),

            duration_unit: "t",

            underlying_symbol: symbol
        }));
    }
);
/* LOGIN WITH DERIV */

loginButton.addEventListener("click", async function () {

    const CLIENT_ID =
        "34qPaViEQZZw84Mc5thoO";

    const REDIRECT_URI =
        "https://henry12-cloud.github.io/Deriv-trading-site-/";

    /* Create PKCE code verifier */
    const characters =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

    const randomBytes =
        crypto.getRandomValues(new Uint8Array(64));

    let codeVerifier = "";

    randomBytes.forEach(function (byte) {
        codeVerifier +=
            characters[byte % characters.length];
    });

    /* Create PKCE code challenge */
    const hash =
        await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(codeVerifier)
        );

    const codeChallenge =
        btoa(
            String.fromCharCode(
                ...new Uint8Array(hash)
            )
        )
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    /* Create security state */
    const stateBytes =
        crypto.getRandomValues(
            new Uint8Array(16)
        );

    let state = "";

    stateBytes.forEach(function (byte) {
        state +=
            byte.toString(16).padStart(2, "0");
    });

    /* Save security information */
    sessionStorage.setItem(
        "pkce_code_verifier",
        codeVerifier
    );

    sessionStorage.setItem(
        "oauth_state",
        state
    );

    /* Create Deriv login URL */
    const authUrl =
        new URL(
            "https://auth.deriv.com/oauth2/auth"
        );

    authUrl.searchParams.set(
        "response_type",
        "code"
    );

    authUrl.searchParams.set(
        "client_id",
        CLIENT_ID
    );

    authUrl.searchParams.set(
        "redirect_uri",
        REDIRECT_URI
    );

    authUrl.searchParams.set(
        "scope",
        "trade"
    );

    authUrl.searchParams.set(
        "state",
        state
    );

    authUrl.searchParams.set(
        "code_challenge",
        codeChallenge
    );

    authUrl.searchParams.set(
        "code_challenge_method",
        "S256"
    );

    window.location.href =
        authUrl.toString();
});
/* DERIV OAUTH CALLBACK */

const urlParams =
    new URLSearchParams(window.location.search);

const authorizationCode =
    urlParams.get("code");

const returnedState =
    urlParams.get("state");

if (authorizationCode && returnedState) {

    const savedState =
        sessionStorage.getItem("oauth_state");

    if (returnedState !== savedState) {

        accountStatus.textContent =
            "Login security check failed";

        console.log("OAuth state mismatch");

    } else {

        accountStatus.textContent =
            "Deriv login successful ✓";

        console.log(
            "Authorization code received"
        );

        /*
         * The authorization code must be
         * exchanged for tokens by a secure
         * backend server.
         */
    }
    
