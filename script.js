const connectionStatus = document.getElementById("connectionStatus");
const marketSelect = document.getElementById("marketSelect");
const marketStatus = document.getElementById("marketStatus");
const selectedMarket = document.getElementById("selectedMarket");
const livePrice = document.getElementById("livePrice");
const chartPrice = document.getElementById("chartPrice");
const lastUpdate = document.getElementById("lastUpdate");

const ws = new WebSocket(
    "wss://api.derivws.com/trading/v1/options/ws/public"
);

ws.onopen = function () {

    console.log("DERIV CONNECTED");

    connectionStatus.textContent = "Connected to Deriv ✓";

    marketStatus.textContent = "Loading markets...";

    ws.send(JSON.stringify({
        active_symbols: "brief",
        contract_type: ["CALL", "PUT"]
    }));
};


ws.onmessage = function (event) {

    console.log("DERIV RESPONSE:", event.data);

    const data = JSON.parse(event.data);

    if (data.error) {
        connectionStatus.textContent =
            "Deriv Error: " + data.error.message;

        console.log("DERIV ERROR:", data.error);

        return;
    }


    if (data.msg_type === "active_symbols") {

        console.log("MARKETS:", data.active_symbols);

        marketSelect.innerHTML = "";

        if (
            !data.active_symbols ||
            data.active_symbols.length === 0
        ) {

            marketStatus.textContent =
                "Deriv returned no markets.";

            return;
        }


        data.active_symbols.forEach(function (market) {

            const option = document.createElement("option");

            option.value = market.underlying_symbol;

            option.textContent =
                market.underlying_symbol_name ||
                market.underlying_symbol;

            marketSelect.appendChild(option);
        });


        marketStatus.textContent =
            data.active_symbols.length + " markets loaded";

        selectMarket();

    }
};


function selectMarket() {

    const symbol = marketSelect.value;

    if (!symbol) {
        return;
    }

    const name =
        marketSelect.options[
            marketSelect.selectedIndex
        ].textContent;

    selectedMarket.textContent =
        "Selected market: " + name;

    livePrice.textContent =
        "Live Price: Loading...";

    chartPrice.textContent =
        "Current Price: Loading...";

    lastUpdate.textContent =
        "Last update: Loading...";


    ws.send(JSON.stringify({
        ticks: symbol,
        subscribe: 1
    }));
}


marketSelect.addEventListener(
    "change",
    function () {

        selectMarket();

    }
);


ws.onclose = function () {

    connectionStatus.textContent =
        "Disconnected from Deriv";

};


ws.onerror = function (error) {

    console.log("WEBSOCKET ERROR:", error);

    connectionStatus.textContent =
        "WebSocket connection error";

};
