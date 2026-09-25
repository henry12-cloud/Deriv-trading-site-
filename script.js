// ======================================
// DERIV TRADING SITE - CLEAN SCRIPT
// ======================================

// ======================================
// ELEMENTS
// ======================================

const connectionStatus =
    document.getElementById("connectionStatus");

const marketSelect =
    document.getElementById("marketSelect");

const marketStatus =
    document.getElementById("marketStatus");

const selectedMarket =
    document.getElementById("selectedMarket");

const livePrice =
    document.getElementById("livePrice");

const chartPrice =
    document.getElementById("chartPrice");

const chartStatus =
    document.getElementById("chartStatus");

const lastUpdate =
    document.getElementById("lastUpdate");

const tradeStatus =
    document.getElementById("tradeStatus");

const proposalStatus =
    document.getElementById("proposalStatus");

const askPrice =
    document.getElementById("askPrice");

const payout =
    document.getElementById("payout");

const tradeAmount =
    document.getElementById("tradeAmount");

const tradeDuration =
    document.getElementById("tradeDuration");

const riseButton =
    document.getElementById("riseButton");

const fallButton =
    document.getElementById("fallButton");

const loginButton =
    document.getElementById("loginButton");

const accountStatus =
    document.getElementById("accountStatus");

const accountBalance =
    document.getElementById("accountBalance");

const chart =
    document.getElementById("chart");


// ======================================
// DERIV CONNECTION
// ======================================

const APP_ID =
    "34qPaViEQZZw84Mc5thoO";

const WS_URL =
    "wss://api.derivws.com/trading/v1/options/ws/public?app_id=" +
    APP_ID;

let socket;


// ======================================
// CHART
// ======================================

let priceHistory = [];

function drawChart() {

    if (!chart) {
        return;
    }

    const ctx =
        chart.getContext("2d");

    const width =
        chart.width;

    const height =
        chart.height;

    ctx.clearRect(
        0,
        0,
        width,
        height
    );

    if (priceHistory.length < 2) {
        return;
    }

    const min =
        Math.min(...priceHistory);

    const max =
        Math.max(...priceHistory);

    const range =
        max - min || 1;

    ctx.beginPath();

    priceHistory.forEach(
        function (price, index) {

            const x =
                (index /
                (priceHistory.length - 1)) *
                width;

            const y =
                height -
                ((price - min) / range) *
                (height - 20) -
                10;

            if (index === 0) {

                ctx.moveTo(x, y);

            } else {

                ctx.lineTo(x, y);

            }
        }
    );

    ctx.stroke();
}


// ======================================
// CONNECT
// ======================================

function connectToDeriv() {

    connectionStatus.textContent =
        "Connecting to Deriv...";

    socket =
        new WebSocket(WS_URL);


    socket.onopen =
        function () {

            connectionStatus.textContent =
                "Connected to Deriv ✓";

            loadMarkets();

        };


    socket.onmessage =
        function (event) {

            let data;

            try {

                data =
                    JSON.parse(event.data);

            } catch (error) {

                return;
            }


            // ------------------------------
            // MARKETS
            // ------------------------------

            if (
                data.msg_type ===
                "active_symbols"
            ) {

                const markets =
                    data.active_symbols || [];

                marketSelect.innerHTML = "";

                markets.forEach(
                    function (market) {

                        const option =
                            document.createElement(
                                "option"
                            );

                        option.value =
                            market.symbol;

                        option.textContent =
                            market.display_name ||
                            market.symbol;

                        marketSelect.appendChild(
                            option
                        );

                    }
                );


                marketStatus.textContent =
                    markets.length +
                    " markets loaded";


                if (markets.length > 0) {

                    // Prefer Volatility 100 (1s)
                    const preferred =
                        markets.find(
                            function (market) {

                                return (
                                    market.symbol ===
                                    "1HZ100V"
                                );

                            }
                        );


                    if (preferred) {

                        marketSelect.value =
                            preferred.symbol;

                    }


                    updateSelectedMarket();

                }

                return;
            }


            // ------------------------------
            // TICK / LIVE PRICE
            // ------------------------------

            if (
                data.msg_type ===
                "tick"
            ) {

                if (
                    data.tick &&
                    data.tick.quote !== undefined
                ) {

                    const price =
                        Number(
                            data.tick.quote
                        );

                    livePrice.textContent =
                        price;

                    chartPrice.textContent =
                        price;


                    priceHistory.push(
                        price
                    );


                    if (
                        priceHistory.length >
                        50
                    ) {

                        priceHistory.shift();

                    }


                    drawChart();


                    if (chartStatus) {

                        chartStatus.textContent =
                            "Market is live ●";

                    }


                    if (lastUpdate) {

                        lastUpdate.textContent =
                            "Last update: " +
                            new Date().toLocaleTimeString();

                    }

                }

                return;
            }


            // ------------------------------
            // CONTRACTS
            // ------------------------------

            if (
                data.msg_type ===
                "contracts_for"
            ) {

                const contracts =
                    data.contracts_for || {};

                const available =
                    contracts.available || [];

                if (available.length > 0) {

                    tradeStatus.textContent =
                        available.length +
                        " contracts available ✓";

                } else {

                    tradeStatus.textContent =
                        "No contracts available.";

                }

                return;
            }


            // ------------------------------
            // PROPOSAL / QUOTE
            // ------------------------------

            if (
                data.msg_type ===
                "proposal"
            ) {

                if (!data.proposal) {

                    tradeStatus.textContent =
                        "No quote received.";

                    return;
                }


                const proposal =
                    data.proposal;


                if (askPrice) {

                    askPrice.textContent =
                        proposal.ask_price ??
                        "--";

                }


                if (payout) {

                    payout.textContent =
                        proposal.payout ??
                        "--";

                }


                if (proposalStatus) {

                    proposalStatus.textContent =
                        "Quote received ✓";

                }


                tradeStatus.textContent =
                    "Quote received ✓";

                return;
            }


            // ------------------------------
            // API ERROR
            // ------------------------------

            if (data.error) {

                tradeStatus.textContent =
                    data.error.message ||
                    "Deriv API error.";

                console.log(
                    "DERIV ERROR:",
                    data.error
                );

            }

        };


    socket.onerror =
        function () {

            connectionStatus.textContent =
                "Connection error";

        };


    socket.onclose =
        function () {

            connectionStatus.textContent =
                "Disconnected from Deriv";

        };

}


// ======================================
// LOAD MARKETS
// ======================================

function loadMarkets() {

    socket.send(
        JSON.stringify({

            active_symbols:
                "brief",

            req_id:
                1

        })
    );

}


// ======================================
// SELECT MARKET
// ======================================

function updateSelectedMarket() {

    const symbol =
        marketSelect.value;

    if (!symbol) {

        selectedMarket.textContent =
            "None";

        return;
    }


    const selectedOption =
        marketSelect.options[
            marketSelect.selectedIndex
        ];


    selectedMarket.textContent =
        selectedOption.textContent;


    priceHistory = [];


    // Subscribe to live price
    socket.send(
        JSON.stringify({

            ticks:
                symbol,

            subscribe:
                1,

            req_id:
                2

        })
    );

}


marketSelect.addEventListener(
    "change",
    updateSelectedMarket
);


// ======================================
// REQUEST PROPOSAL
// ======================================

function requestProposal(
    contractType
) {

    const symbol =
        marketSelect.value;

    const amount =
        Number(
            tradeAmount.value
        );

    const duration =
        Number(
            tradeDuration.value
        );


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


    if (
        !socket ||
        socket.readyState !==
        WebSocket.OPEN
    ) {

        tradeStatus.textContent =
            "Not connected to Deriv.";

        return;
    }


    tradeStatus.textContent =
        "Checking contracts...";


    askPrice.textContent =
        "--";

    payout.textContent =
        "--";


    // First check available contracts
    socket.send(
        JSON.stringify({

            contracts_for:
                symbol,

            req_id:
                20

        })
    );


    // Request quote
    setTimeout(
        function () {

            tradeStatus.textContent =
                "Requesting quote...";


            socket.send(
                JSON.stringify({

                    proposal:
                        1,

                    amount:
                        amount,

                    basis:
                        "stake",

                    contract_type:
                        contractType,

                    currency:
                        "USD",

                    duration:
                        duration,

                    duration_unit:
                        "t",

                    underlying_symbol:
                        symbol,

                    subscribe:
                        0,

                    req_id:
                        contractType ===
                        "CALL"
                            ? 10
                            : 11

                })
            );

        },
        300
    );

}


// ======================================
// RISE BUTTON
// ======================================

riseButton.addEventListener(
    "click",
    function () {

        requestProposal(
            "CALL"
        );

    }
);


// ======================================
// FALL BUTTON
// ======================================

fallButton.addEventListener(
    "click",
    function () {

        requestProposal(
            "PUT"
        );

    }
);


// ======================================
// DERIV LOGIN - OAUTH 2.0 + PKCE
// ======================================

const CLIENT_ID =
    "34qPaViEQZZw84Mc5thoO";

const REDIRECT_URI =
    "https://henry12-cloud.github.io/Deriv-trading-site-/";


function base64UrlEncode(buffer) {

    return btoa(
        String.fromCharCode(
            ...new Uint8Array(buffer)
        )
    )
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

}


function generateCodeVerifier() {

    const characters =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
        "abcdefghijklmnopqrstuvwxyz" +
        "0123456789-._~";

    const random =
        crypto.getRandomValues(
            new Uint8Array(64)
        );

    return Array.from(random)
        .map(
            function (value) {

                return characters[
                    value % characters.length
                ];

            }
        )
        .join("");

}


async function generateCodeChallenge(
    verifier
) {

    const data =
        new TextEncoder().encode(
            verifier
        );

    const hash =
        await crypto.subtle.digest(
            "SHA-256",
            data
        );

    return base64UrlEncode(hash);

}


// ======================================
// LOGIN BUTTON
// ======================================

loginButton.addEventListener(
    "click",
    async function () {

        try {

            accountStatus.textContent =
                "Opening Deriv login...";


            const codeVerifier =
                generateCodeVerifier();


            const codeChallenge =
                await generateCodeChallenge(
                    codeVerifier
                );


            const stateArray =
                crypto.getRandomValues(
                    new Uint8Array(16)
                );


            const state =
                Array.from(stateArray)
                    .map(
                        function (byte) {

                            return byte
                                .toString(16)
                                .padStart(
                                    2,
                                    "0"
                                );

                        }
                    )
                    .join("");


            sessionStorage.setItem(
                "pkce_code_verifier",
                codeVerifier
            );


            sessionStorage.setItem(
                "oauth_state",
                state
            );


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

        } catch (error) {

            console.error(error);

            accountStatus.textContent =
                "Unable to start Deriv login.";

        }

    }
);


// ======================================
// HANDLE OAUTH CALLBACK
// ======================================

function checkLoginCallback() {

    const params =
        new URLSearchParams(
            window.location.search
        );


    const error =
        params.get("error");


    const code =
        params.get("code");


    const returnedState =
        params.get("state");


    if (error) {

        accountStatus.textContent =
            "Deriv login was cancelled.";

        return;

    }


    if (!code) {

        return;

    }


    const savedState =
        sessionStorage.getItem(
            "oauth_state"
        );


    if (
        !returnedState ||
        returnedState !== savedState
    ) {

        accountStatus.textContent =
            "Login verification failed.";

        return;

    }


    const codeVerifier =
        sessionStorage.getItem(
            "pkce_code_verifier"
        );


    if (!codeVerifier) {

        accountStatus.textContent =
            "Login session expired.";

        return;

    }


    accountStatus.textContent =
        "Deriv login successful ✓";


    sessionStorage.removeItem(
        "oauth_state"
    );

}


// ======================================
// CHECK LOGIN CALLBACK
// ======================================

checkLoginCallback();

// ======================================
// CHECK LOGIN RESULT
// ======================================

function checkLogin() {

    const params =
        new URLSearchParams(
            window.location.search
        );


    const code =
        params.get("code");


    const state =
        params.get("state");


    if (
        code &&
        state
    ) {

        const savedState =
            sessionStorage.getItem(
                "oauth_state"
            );


        if (
            state ===
            savedState
        ) {

            accountStatus.textContent =
                "Deriv login successful ✓";

            sessionStorage.removeItem(
                "oauth_state"
            );


            window.history.replaceState(
                {},
                document.title,
                window.location.pathname
            );

        } else {

            accountStatus.textContent =
                "Login state verification failed.";

        }

    }

}


// ======================================
// START
// ======================================

checkLogin();

connectToDeriv();
