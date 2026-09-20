const connectionStatus = document.getElementById("connectionStatus");
const marketSelect = document.getElementById("marketSelect");
const selectedMarket = document.getElementById("selectedMarket");
const livePrice = document.getElementById("livePrice");
const chartPrice = document.getElementById("chartPrice");
const marketStatus = document.getElementById("marketStatus");
const lastUpdate = document.getElementById("lastUpdate");

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

        connectionStatus.textContent =
            "Deriv error: " + data.error.message;

        return;
    }


    if (data.msg_type === "active_symbols") {

        if (
            !data.active_symbols ||
            data.active_symbols.length === 0
        ) {

            marketStatus.textContent =
                "Deriv returned an empty market list";

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

        const price = data.tick.quote;

        livePrice.textContent =
            "Live Price: " + price;

        chartPrice.textContent =
            "Current Price: " + price;

        lastUpdate.textContent =
            "Last update: " +
            new Date().toLocaleTimeString();
    }
};


socket.onerror = function () {

    connectionStatus.textContent =
        "Connection error";

};


socket.onclose = function () {

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


        selectedMarket.textContent =
            "Selected market: " + name;


        livePrice.textContent =
            "Live Price: Loading...";


        chartPrice.textContent =
            "Current Price: Loading...";


        socket.send(JSON.stringify({

            ticks: symbol,

            subscribe: 1

        }));

    }
);
