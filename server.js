const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();

app.use(express.json());
// Temporary server-side sessions.
// For production, use a persistent session store.
const sessions = new Map();

function getSession(req) {
    const match = (req.headers.cookie || "")
        .match(/(?:^|;\s*)tradedollars_session=([^;]+)/);

    if (!match) return null;

    const session = sessions.get(match[1]);

    if (!session || Date.now() >= session.expiresAt) {
        if (match) sessions.delete(match[1]);
        return null;
    }

    return session;
}

// ======================================
// DERIV OAUTH SETTINGS
// ======================================

const CLIENT_ID = process.env.CLIENT_ID;

const REDIRECT_URI =
    "https://tradedollars.onrender.com/oauth/callback";

// ======================================
// SERVE WEBSITE
// ======================================

app.use(express.static(__dirname));

app.get("/", function (req, res) {
    res.sendFile(
        path.join(__dirname, "index.html")
    );
});

// ======================================
// START DERIV LOGIN
// ======================================

app.get("/login", function (req, res) {

    const state =
        crypto.randomBytes(32).toString("hex");

    const codeVerifier =
        crypto.randomBytes(32).toString("base64url");

    const codeChallenge =
        crypto
            .createHash("sha256")
            .update(codeVerifier)
            .digest("base64url");

    const oauthData =
        Buffer.from(
            JSON.stringify({
                state: state,
                codeVerifier: codeVerifier
            })
        ).toString("base64url");

    res.setHeader(
        "Set-Cookie",
        "deriv_oauth=" +
        oauthData +
        "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600"
    );

    const authURL =
        new URL(
            "https://auth.deriv.com/oauth2/auth"
        );

    authURL.searchParams.set(
        "response_type",
        "code"
    );

    authURL.searchParams.set(
        "client_id",
        CLIENT_ID
    );

    authURL.searchParams.set(
        "redirect_uri",
        REDIRECT_URI
    );

authURL.searchParams.set(
    "scope",
    "trade"
);

    authURL.searchParams.set(
        "state",
        state
    );

    authURL.searchParams.set(
        "code_challenge",
        codeChallenge
    );

    authURL.searchParams.set(
        "code_challenge_method",
        "S256"
    );

    res.redirect(
        authURL.toString()
    );
});

// ======================================
// DERIV OAUTH CALLBACK
// ======================================

app.get(
    "/oauth/callback",
    async function (req, res) {

        const code = req.query.code;
        const returnedState = req.query.state;
        const error = req.query.error;

        if (error) {

            return res.status(400).send(
                "Deriv login was cancelled or failed: " +
                error
            );
        }

        if (!code || !returnedState) {

            return res.status(400).send(
                "Missing authorization code or state."
            );
        }

        // Read OAuth cookie
        const cookieHeader =
            req.headers.cookie || "";

        const cookieMatch =
            cookieHeader.match(
                /(?:^|;\s*)deriv_oauth=([^;]+)/
            );

        if (!cookieMatch) {

            return res.status(400).send(
                "OAuth session cookie is missing. Please start the login again."
            );
        }

        let oauthData;

        try {

            oauthData =
                JSON.parse(
                    Buffer.from(
                        cookieMatch[1],
                        "base64url"
                    ).toString("utf8")
                );

        } catch (error) {

            return res.status(400).send(
                "Invalid OAuth session."
            );
        }

        // Verify OAuth state
        if (
            !oauthData.state ||
            oauthData.state !== returnedState
        ) {

            return res.status(400).send(
                "Invalid or expired OAuth state."
            );
        }

        try {

            // ==================================
            // EXCHANGE CODE FOR ACCESS TOKEN
            // ==================================

            const tokenResponse =
                await fetch(
                    "https://auth.deriv.com/oauth2/token",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/x-www-form-urlencoded"
                        },

                        body:
                            new URLSearchParams({

                                grant_type:
                                    "authorization_code",

                                client_id:
                                    CLIENT_ID,

                                code:
                                    code,

                                code_verifier:
                                    oauthData.codeVerifier,

                                redirect_uri:
                                    REDIRECT_URI
                            })
                    }
                );

            const tokenData =
                await tokenResponse.json();

            console.log(
                "DERIV TOKEN RESPONSE:",
                {
                    success:
                        tokenResponse.ok,

                    expires_in:
                        tokenData.expires_in
                }
            );

            if (!tokenResponse.ok) {

                return res.status(400).send(
                    "Deriv token exchange failed."
                );
            }

            if (!tokenData.access_token) {

                return res.status(400).send(
                    "No access token was returned."
                );
            }
          const sessionId = crypto.randomBytes(32).toString("hex");

sessions.set(sessionId, {
    accessToken: tokenData.access_token,
    expiresAt: Date.now() +
        (tokenData.expires_in || 3600) * 1000
});

console.log("DERIV LOGIN SUCCESS");

            // ==================================
            // CLEAR OAUTH COOKIE
            // ==================================

            res.setHeader("Set-Cookie", [
    "deriv_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
    `tradedollars_session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${tokenData.expires_in || 3600}`
]);

            // ==================================
            // OAUTH SUCCESS
            // ==================================

            res.redirect(
                "https://tradedollars.onrender.com/?oauth=success"
            );

        } catch (error) {

            console.error(
                "OAUTH ERROR:",
                error
            );

            res.status(500).send(
                "Server error during Deriv login."
            );
        }
    }
);
// ======================================
// ACCOUNT STATUS
// ======================================

app.get("/account-status", function (req, res) {

    const session = getSession(req);

    if (session) {
        return res.json({
            connected: true
        });
    }

    return res.json({
        connected: false
    });
});
// ======================================
// ACCOUNT BALANCE
// ======================================

app.get("/account-balance", async function (req, res) {

    const session = getSession(req);

    if (!session) {
        return res.status(401).json({
            connected: false,
            balance: null
        });
    }

    try {

        const response = await fetch(
            "https://api.derivws.com/trading/v1/options/accounts",
            {
                method: "GET",
                headers: {
                    "Authorization":
                        "Bearer " + session.accessToken
                }
            }
        );

        const data = await response.json();

        console.log(
            "DERIV BALANCE RESPONSE:",
            data
        );

        if (!response.ok) {
            return res.status(response.status).json({
                connected: true,
                balance: null,
                error:
                    "Unable to retrieve account balance."
            });
        }

        const accounts = Array.isArray(data.data)
            ? data.data
            : [data.data];

        const account = accounts.find(
            function (item) {
                return item && item.status === "active";
            }
        ) || accounts[0];

        if (!account) {
            return res.json({
                connected: true,
                balance: null,
                error:
                    "No trading account was found."
            });
        }

        return res.json({
            connected: true,
            balance: account.balance,
            currency: account.currency,
            accountId: account.account_id,
            accountType: account.account_type
        });

    } catch (error) {

        console.error(
            "BALANCE ERROR:",
            error
        );

        return res.status(500).json({
            connected: true,
            balance: null,
            error:
                "Server error retrieving balance."
        });
    }
});
// ======================================
// START SERVER
// ======================================

const PORT =
    process.env.PORT || 3000;

app.listen(
    PORT,
    function () {

        console.log(
            "Backend running on port " +
            PORT
        );
    }
);
