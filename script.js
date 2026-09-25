* {
    box-sizing: border-box;
}

body {
    font-family: Arial, sans-serif;
    background: #f5f5f5;
    color: #222;
    margin: 0;
    padding: 20px;
}

h1 {
    margin-top: 0;
}

h2 {
    margin-top: 25px;
    margin-bottom: 10px;
}

select {
    display: block;
    width: 100%;
    max-width: 500px;
    height: 45px;
    padding: 8px 12px;
    font-size: 16px;
    background: white;
    color: #222;
    border: 2px solid #333;
    border-radius: 6px;
    appearance: auto;
}

option {
    background: white;
    color: #222;
}

input {
    padding: 8px;
    font-size: 16px;
}

button {
    padding: 12px 20px;
    font-size: 16px;
    cursor: pointer;
    margin-right: 8px;
}

#connectionStatus {
    padding: 15px;
    background: white;
    border-radius: 8px;
    border: 1px solid #ddd;
    font-weight: bold;
}

#marketStatus {
    margin-top: 10px;
}

#selectedMarket {
    font-weight: bold;
}

#livePrice,
#chartPrice,
#lastUpdate,
#proposalStatus,
#tradeStatus,
#accountStatus,
#accountBalance {
    margin-top: 10px;
}

/* TRADEDOLLARS - FINAL DASHBOARD DESIGN */

:root {
    color-scheme: dark;
}

* {
    box-sizing: border-box;
}

body {
    margin: 0;
    padding: 20px;
    background: #0b1120;
    color: #f1f5f9;
    font-family: Arial, sans-serif;
    line-height: 1.5;
}

h1, h2, h3 {
    color: #f8fafc;
}

h1 {
    text-align: center;
    font-size: 30px;
    letter-spacing: 1px;
    margin-bottom: 5px;
}

h2 {
    font-size: 20px;
    margin-top: 0;
}

section {
    background: #172338;
    border: 1px solid #293b54;
    border-radius: 16px;
    padding: 20px;
    margin: 18px auto;
    max-width: 950px;
    box-shadow: 0 8px 24px rgba(0,0,0,.2);
}

input, select {
    background: #0f172a;
    color: white;
    border: 1px solid #475569;
    border-radius: 9px;
    padding: 12px;
    font-size: 16px;
    max-width: 100%;
}

button {
    padding: 13px 22px;
    border: none;
    border-radius: 10px;
    color: white;
    background: #2563eb;
    font-size: 16px;
    font-weight: bold;
    cursor: pointer;
    transition: .2s;
}

button:active {
    transform: scale(.97);
}

button:disabled {
    opacity: .45;
    cursor: not-allowed;
}

#riseButton {
    background: #059669;
}

#fallButton {
    background: #dc2626;
}

#riseButton, #fallButton {
    min-height: 52px;
    margin: 8px 5px 8px 0;
}

#connectionStatus,
#marketStatus,
#accountStatus,
#tradeStatus {
    font-weight: bold;
}

#livePrice, #chartPrice {
    font-size: 26px;
    font-weight: bold;
    color: #34d399;
    overflow-wrap: anywhere;
}

#chart {
    display: block;
    width: 100%;
    max-width: 600px;
    height: auto;
    margin: 15px auto;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 12px;
}

@media (max-width: 600px) {
    body {
        padding: 12px;
    }

    section {
        padding: 15px;
        margin: 12px auto;
    }

    h1 {
        font-size: 25px;
    }

    input, select {
        width: 100%;
        margin: 6px 0;
    }

    #riseButton, #fallButton {
        width: calc(50% - 10px);
        padding: 14px 6px;
    }
        }
