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

const chartTime =
    document.getElementById("chartTime");

const proposalStatus =
    document.getElementById("proposalStatus");

const askPrice =
    document.getElementById("askPrice");

const payout =
    document.getElementById("payout");

const tradeStatus =
    document.getElementById("tradeStatus");

const socket =
    new WebSocket(
        "wss://api.derivws.com/trading/v1/options/ws/public"
    );


socket.onopen = function () {

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

    const data = JSON.parse(event.data);

    console.log("DERIV RESPONSE:", data);


    if (data.error) {

        connectionStatus.textContent =
            "Deriv error";

        marketStatus.textContent =
            data.error.message;

        return;
    }


    if (data.msg_type === "active_symbols") {

        const markets =
            data.active_symbols || [];


        if (markets.length === 0) {

            marketStatus.textContent =
                "Deriv returned an empty market list.";

            return;
        }


        marketSelect.innerHTML = "";


        markets.forEach(function (market) {

            const option =
                document.createElement("option");

            option.value =
                market.underlying_symbol ||
                market.symbol;

            option.textContent =
                market.display_name ||
                market.name ||
                option.value;

            marketSelect.appendChild(option);

        });


        marketStatus.textContent =
            markets.length + " markets loaded";


        subscribeToMarket(
            marketSelect.value
        );

    }

};


function subscribeToMarket(symbol) {

    if (!symbol) {
        return;
    }


    selectedMarket.textContent =
        "Selected market: " + symbol;

    livePrice.textContent =
        "Live Price: Loading...";


    socket.send(JSON.stringify({

        ticks: symbol,

        subscribe: 1,

        req_id: 2

    }));

}


marketSelect.addEventListener(
    "change",
    function () {

        subscribeToMarket(
            marketSelect.value
        );

    }
);


socket.addEventListener(
    "message",
    function (event) {

        const data =
            JSON.parse(event.data);


        if (data.msg_type === "tick") {

            const quote =
                data.tick.quote;

            const symbol =
                data.tick.symbol;


            livePrice.textContent =
                "Live Price: " + quote;

            chartPrice.textContent =
                quote;

            chartStatus.textContent =
                "Market is live ●";

            chartTime.textContent =
                "Last update: " +
                new Date().toLocaleTimeString();


            console.log(
                "PRICE:",
                symbol,
                quote
            );

        }

    }
);


socket.onerror = function () {

    connectionStatus.textContent =
        "WebSocket connection error";

    marketStatus.textContent =
        "Could not connect to Deriv.";

};


socket.onclose = function () {

    connectionStatus.textContent =
        "Connection closed";

};


document.getElementById("loginButton")
    .addEventListener("click", function () {

        tradeStatus.textContent =
            "Login button ready.";

    });


document.getElementById("buyButton")
    .addEventListener("click", function () {

        tradeStatus.textContent =
            "BUY trading connection will be added next.";

    });


document.getElementById("sellButton")
    .addEventListener("click", function () {

        tradeStatus.textContent =
            "SELL trading connection will be added next.";

    });
