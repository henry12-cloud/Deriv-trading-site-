"use strict";

/* =========================================================
   TRADEDOLLARS - CLEAN WORKING SCRIPT
   ========================================================= */


/* ---------------------------------------------------------
   HTML ELEMENTS
--------------------------------------------------------- */

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

const balance =
    document.getElementById("balance");


/* ---------------------------------------------------------
   VARIABLES
--------------------------------------------------------- */

let socket = null;

let markets = [];

let selectedSymbol = "";

let requestId = 1;


/* ---------------------------------------------------------
   TEXT HELPER
--------------------------------------------------------- */

function setText(element, value) {

    if (element) {
        element.textContent = value;
    }

}


/* ---------------------------------------------------------
   REQUEST ID
--------------------------------------------------------- */

function nextRequestId() {

    requestId++;

    return requestId;

}


/* ---------------------------------------------------------
   CONNECT TO DERIV
--------------------------------------------------------- */

function connectToDeriv() {

    console.log("Starting Deriv connection...");

    setText(
        connectionStatus,
        "Connecting to Deriv..."
    );

    setText(
        marketStatus,
        "Loading markets..."
    );


    /*
       IMPORTANT:
       This is the public Deriv Options WebSocket.
    */

    const url =
        "wss://api.derivws.com/trading/v1/options/ws/public";


    try {

        socket =
            new WebSocket(url);

    } catch (error) {

        console.error(
            "WebSocket error:",
            error
        );

        setText(
            connectionStatus,
            "Connection failed"
        );

        return;

    }


    /* -----------------------------------------------------
       CONNECTED
    ----------------------------------------------------- */

    socket.onopen = function () {

        console.log(
            "Connected to Deriv"
        );

        setText(
            connectionStatus,
            "Connected to Deriv ✓"
        );

        setText(
            marketStatus,
            "Loading markets..."
        );


        /*
           Request active markets.
        */

        socket.send(
            JSON.stringify({

                active_symbols:
                    "brief",

                req_id:
                    nextRequestId()

            })
        );

    };


    /* -----------------------------------------------------
       MESSAGES
    ----------------------------------------------------- */

    socket.onmessage = function (event) {

        let data;


        try {

            data =
                JSON.parse(
                    event.data
                );

        } catch (error) {

            console.error(
                "JSON error:",
                error
            );

            return;

        }


        console.log(
            "DERIV MESSAGE:",
            data
        );


        /* -------------------------------------------------
           API ERROR
        ------------------------------------------------- */

        if (data.error) {

            console.error(
                "DERIV ERROR:",
                data.error
            );

            setText(
                tradeStatus,
                data.error.message ||
                "Deriv error"
            );

            return;

        }


        /* -------------------------------------------------
           ACTIVE MARKETS
        ------------------------------------------------- */

        if (
            data.msg_type ===
            "active_symbols"
        ) {

            if (
                !Array.isArray(
                    data.active_symbols
                )
            ) {

                setText(
                    marketStatus,
                    "No markets found"
                );

                return;

            }


            markets =
                data.active_symbols;


            console.log(
                "Markets:",
                markets.length
            );


            marketSelect.innerHTML =
                "";


            markets.forEach(
                function (market) {

                    const symbol =
                        market.underlying_symbol;

                    const name =
                        market.underlying_symbol_name ||
                        symbol;


                    if (!symbol) {
                        return;
                    }


                    const option =
                        document.createElement(
                            "option"
                        );


                    option.value =
                        symbol;


                    option.textContent =
                        name;


                    marketSelect.appendChild(
                        option
                    );

                }
            );


            if (markets.length === 0) {

                setText(
                    marketStatus,
                    "No markets available"
                );

                return;

            }


            /*
               Prefer Volatility 100 (1s).
            */

            let selected =
                markets.find(
                    function (market) {

                        const name =
                            (
                                market.underlying_symbol_name ||
                                ""
                            ).toLowerCase();


                        return (
                            name.includes(
                                "volatility 100"
                            ) &&
                            name.includes(
                                "(1s)"
                            )
                        );

                    }
                );


            /*
               Otherwise use first market.
            */

            if (!selected) {

                selected =
                    markets[0];

            }


            selectedSymbol =
                selected.underlying_symbol;


            marketSelect.value =
                selectedSymbol;


            setText(
                selectedMarket,
                selected.underlying_symbol_name ||
                selectedSymbol
            );


            setText(
                marketStatus,
                markets.length +
                " markets loaded"
            );


            /*
               Subscribe to live price.
            */

            subscribeToMarket(
                selectedSymbol
            );

        }


        /* -------------------------------------------------
           LIVE PRICE
        ------------------------------------------------- */

        if (
            data.msg_type ===
            "tick"
        ) {

            if (!data.tick) {
                return;
            }


            const price =
                data.tick.quote;


            setText(
                livePrice,
                price
            );


            setText(
                chartPrice,
                price
            );


            setText(
                lastUpdate,
                new Date()
                    .toLocaleTimeString()
            );


            setText(
                chartStatus,
                "Market is live ●"
            );

        }


        /* -------------------------------------------------
           CONTRACTS
        ------------------------------------------------- */

        if (
            data.msg_type ===
            "contracts_for"
        ) {

            console.log(
                "CONTRACTS:",
                data
            );


            if (
                data.contracts_for &&
                Array.isArray(
                    data.contracts_for.available
                )
            ) {

                const count =
                    data.contracts_for
                        .available
                        .length;


                setText(
                    tradeStatus,
                    count +
                    " contracts available ✓"
                );

            }

        }


        /* -------------------------------------------------
           PROPOSAL
        ------------------------------------------------- */

        if (
            data.msg_type ===
            "proposal"
        ) {

            console.log(
                "PROPOSAL:",
                data
            );


            if (!data.proposal) {

                setText(
                    tradeStatus,
                    "No quote received"
                );

                return;

            }


            const proposal =
                data.proposal;


            setText(
                askPrice,
                proposal.ask_price ??
                "--"
            );


            setText(
                payout,
                proposal.payout ??
                "--"
            );


            setText(
                tradeStatus,
                "Quote received ✓"
            );

        }

    };


    /* -----------------------------------------------------
       ERROR
    ----------------------------------------------------- */

    socket.onerror =
        function (error) {

            console.error(
                "Socket error:",
                error
            );


            setText(
                connectionStatus,
                "Connection error"
            );

        };


    /* -----------------------------------------------------
       CLOSED
    ----------------------------------------------------- */

    socket.onclose =
        function () {

            console.log(
                "Socket closed"
            );


            setText(
                connectionStatus,
                "Disconnected from Deriv"
            );

        };

}


/* ---------------------------------------------------------
   SUBSCRIBE TO MARKET
--------------------------------------------------------- */

function subscribeToMarket(symbol) {

    if (!socket) {
        return;
    }


    if (
        socket.readyState !==
        WebSocket.OPEN
    ) {

        return;

    }


    if (!symbol) {
        return;
    }


    selectedSymbol =
        symbol;


    console.log(
        "Subscribing:",
        symbol
    );


    /*
       Live price.
    */

    socket.send(
        JSON.stringify({

            ticks:
                symbol,

            subscribe:
                1,

            req_id:
                nextRequestId()

        })
    );


    /*
       Available contracts.
    */

    socket.send(
        JSON.stringify({

            contracts_for:
                symbol,

            req_id:
                nextRequestId()

        })
    );

}


/* ---------------------------------------------------------
   MARKET CHANGE
--------------------------------------------------------- */

if (marketSelect) {

    marketSelect.addEventListener(
        "change",
        function () {

            const symbol =
                marketSelect.value;


            if (!symbol) {
                return;
            }


            const market =
                markets.find(
                    function (item) {

                        return (
                            item.underlying_symbol ===
                            symbol
                        );

                    }
                );


            selectedSymbol =
                symbol;


            setText(
                selectedMarket,
                market?.underlying_symbol_name ||
                symbol
            );


            setText(
                livePrice,
                "--"
            );


            setText(
                chartPrice,
                "--"
            );


            setText(
                lastUpdate,
                "--"
            );


            setText(
                tradeStatus,
                "Waiting..."
            );


            setText(
                askPrice,
                "--"
            );


            setText(
                payout,
                "--"
            );


            subscribeToMarket(
                symbol
            );

        }
    );

}


/* ---------------------------------------------------------
   PROPOSAL REQUEST
--------------------------------------------------------- */

function requestProposal(
    contractType
) {

    if (!socket) {

        setText(
            tradeStatus,
            "Not connected to Deriv"
        );

        return;

    }


    if (
        socket.readyState !==
        WebSocket.OPEN
    ) {

        setText(
            tradeStatus,
            "Waiting for Deriv connection..."
        );

        return;

    }


    if (!selectedSymbol) {

        setText(
            tradeStatus,
            "Please select a market first."
        );

        return;

    }


    const amount =
        Number(
            tradeAmount?.value || 1
        );


    const duration =
        Number(
            tradeDuration?.value || 15
        );


    if (
        !amount ||
        amount <= 0
    ) {

        setText(
            tradeStatus,
            "Please enter a valid trade amount."
        );

        return;

    }


    if (
        !duration ||
        duration <= 0
    ) {

        setText(
            tradeStatus,
            "Please enter a valid duration."
        );

        return;

    }


    setText(
        askPrice,
        "--"
    );


    setText(
        payout,
        "--"
    );


    setText(
        tradeStatus,
        "Requesting quote..."
    );


    /*
       CALL = RISE
       PUT  = FALL
    */

    const request = {

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
            "s",

        underlying_symbol:
            selectedSymbol,

        req_id:
            nextRequestId()

    };


    console.log(
        "PROPOSAL REQUEST:",
        request
    );


    socket.send(
        JSON.stringify(
            request
        )
    );

}


/* ---------------------------------------------------------
   RISE
--------------------------------------------------------- */

if (riseButton) {

    riseButton.addEventListener(
        "click",
        function () {

            requestProposal(
                "CALL"
            );

        }
    );

}


/* ---------------------------------------------------------
   FALL
--------------------------------------------------------- */

if (fallButton) {

    fallButton.addEventListener(
        "click",
        function () {

            requestProposal(
                "PUT"
            );

        }
    );

}


/* ---------------------------------------------------------
   LOGIN
--------------------------------------------------------- */

if (loginButton) {

    loginButton.addEventListener(
        "click",
        function () {

            if (
                typeof window.startDerivLogin ===
                "function"
            ) {

                window.startDerivLogin();

            } else {

                setText(
                    accountStatus,
                    "Login setup not connected yet"
                );

            }

        }
    );

}


/* ---------------------------------------------------------
   ACCOUNT LOGIN
--------------------------------------------------------- */

async function checkAccountStatus() {

    try {

        const response =
            await fetch(
                "/account-status",
                {
                    credentials: "include"
                }
            );


        const data =
            await response.json();


        if (
            data.connected
        ) {

            setText(
                accountStatus,
                "Account: Connected ✓"
            );


            await loadAccountBalance();


            return true;

        }


        setText(
            accountStatus,
            "Account: Not connected"
        );


        setText(
            balance,
            "--"
        );


        return false;

    } catch (error) {

        console.error(
            "ACCOUNT STATUS ERROR:",
            error
        );


        setText(
            accountStatus,
            "Account: Not connected"
        );


        return false;

    }

}


/* ---------------------------------------------------------
   LOAD BALANCE
--------------------------------------------------------- */

async function loadAccountBalance() {

    try {

        const response =
            await fetch(
                "/account-balance",
                {
                    credentials: "include"
                }
            );


        const data =
            await response.json();


        if (
            !response.ok ||
            !data.connected
        ) {

            setText(
                balance,
                "--"
            );

            return;

        }


        if (
            data.balance !== null &&
            data.balance !== undefined
        ) {

            setText(
                balance,
                data.balance +
                " " +
                (data.currency || "")
            );

        } else {

            setText(
                balance,
                "--"
            );

        }

    } catch (error) {

        console.error(
            "BALANCE ERROR:",
            error
        );


        setText(
            balance,
            "--"
        );

    }

}


/* ---------------------------------------------------------
   LOGIN BUTTON
--------------------------------------------------------- */

if (loginButton) {

    loginButton.addEventListener(
        "click",
        function () {

            window.location.href =
                "/login";

        }
    );

}


/* ---------------------------------------------------------
   CHECK OAUTH RESULT
--------------------------------------------------------- */

async function initializeAccount() {

    const params =
        new URLSearchParams(
            window.location.search
        );


    if (
        params.get("oauth") ===
        "success"
    ) {

        setText(
            accountStatus,
            "Account: Connected ✓"
        );


        /*
           Remove ?oauth=success
           from the address bar.
        */

        window.history.replaceState(
            {},
            document.titl
