const ws = new WebSocket(
    "wss://ws.binaryws.com/websockets/v3"
);

const price = document.getElementById("price");
const chart = document.getElementById("chart");

ws.onopen = function () {

    console.log("CONNECTED");

    price.textContent = "Connecting to Deriv...";

    ws.send(JSON.stringify({
        active_symbols: "brief",
        req_id: 1
    }));
};

ws.onmessage = function (event) {

    const data = JSON.parse(event.data);

    console.log(data);

    if (data.error) {

        price.textContent = "API Error";

        chart.textContent =
            data.error.message;

        console.log(
            "ERROR:",
            data.error.message
        );

        return;
    }

    if (data.msg_type === "active_symbols") {

        const markets =
            data.active_symbols || [];

        console.log(
            "MARKETS:",
            markets
        );

        if (markets.length === 0) {

            price.textContent =
                "0 markets";

            chart.textContent =
                "Deriv returned 0 markets.";

            return;
        }

        const market =
            markets[0];

        const symbol =
            market.underlying_symbol ||
            market.symbol;

        console.log(
            "USING:",
            symbol
        );

        price.textContent =
            "Loading price...";

        ws.send(JSON.stringify({
            ticks: symbol,
            subscribe: 1,
            req_id: 2
        }));
    }

    if (data.msg_type === "tick") {

        price.textContent =
            data.tick.quote;

        chart.innerHTML =
            "Market: " +
            data.tick.symbol +
            "<br><br>" +
            "Live Price: " +
            data.tick.quote;
    }
};

ws.onerror = function () {

    price.textContent =
        "WebSocket error";

    chart.textContent =
        "Could not connect to Deriv.";

    console.log("WEBSOCKET ERROR");
};

ws.onclose = function () {

    console.log("Connection closed");
};