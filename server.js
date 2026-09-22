const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();

app.use(express.json());

// ======================================
// DERIV OAUTH SETTINGS
// ======================================

const CLIENT_ID = "34qPaViEQZZw84Mc5thoO";

const REDIRECT_URI =
    "https://tradedollars.onrender.com/oauth/callback";
// ======================================
// TEMPORARY PKCE STORAGE
// ======================================

const oauthRequests = new Map();

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

    oauthRequests.set(state, {
        codeVerifier: codeVerifier
    });

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

    res.redirect(authURL.toString());
});

// ======================================
// DERIV OAUTH CALLBACK
// ======================================

app.get("/oauth/callback", async function (req, res) {

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

    const savedRequest =
        oauthRequests.get(returnedState);

    if (!savedRequest) {
        return res.status(400).send(
            "Invalid or expired OAuth state."
        );
    }

    oauthRequests.delete(returnedState);

    try {

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
                                savedRequest.codeVerifier,

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
                success: tokenResponse.ok,
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

        // Do NOT send the access token to the browser.
        res.send(
            "<h2>Deriv account connected ✓</h2>" +
            "<p>OAuth login was successful.</p>" +
            "<p>You can close this page.</p>"
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
