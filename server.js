"use strict";

const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.DERIV_CLIENT_ID;
const BASE_URL = (process.env.BASE_URL || "").replace(/\/$/, "");

if (!CLIENT_ID) {
    console.error("ERROR: DERIV_CLIENT_ID is missing.");
}

if (!BASE_URL) {
    console.error("ERROR: BASE_URL is missing.");
}

const REDIRECT_URI = BASE_URL + "/callback";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the website
app.use(express.static(__dirname));

// Temporary in-memory sessions
const sessions = new Map();

function createSession(tokenData) {
    const sessionId = crypto.randomBytes(32).toString("hex");

    sessions.set(sessionId, {
        access_token: tokenData.access_token,
        expires_in: tokenData.expires_in,
        created_at: Date.now()
    });

    return sessionId;
}

function getSession(req) {
    const cookie = req.headers.cookie || "";

    const match = cookie.match(
        /(?:^|;\s*)tradedollars_session=([^;]+)/
    );

    if (!match) {
        return null;
    }

    return sessions.get(match[1]) || null;
}

// Health check
app.get("/health", (req, res) => {
    res.json({
        ok: true,
        service: "Tradedollars",
        oauth_configured: !!CLIENT_ID && !!BASE_URL,
        redirect_uri: REDIRECT_URI
    });
});

// Start OAuth login
app.get("/login", (req, res) => {
    if (!CLIENT_ID || !BASE_URL) {
        return res.status(500).send(
            "OAuth is not configured. Check DERIV_CLIENT_ID and BASE_URL in Render."
        );
    }

    const state = crypto.randomBytes(32).toString("hex");

    // Store state temporarily in an HTTP-only cookie.
    res.cookie("oauth_state", state, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 10 * 60 * 1000
    });

    const params = new URLSearchParams();

    params.set("response_type", "code");
    params.set("client_id", CLIENT_ID);
    params.set("redirect_uri", REDIRECT_URI);
    params.set("scope", "trade");
    params.set("state", state);

    // PKCE
    const codeVerifier = crypto.randomBytes(48).toString("base64url");

    const codeChallenge = crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");

    res.cookie("pkce_verifier", codeVerifier, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 10 * 60 * 1000
    });

    params.set("code_challenge", codeChallenge);
    params.set("code_challenge_method", "S256");

    const authUrl =
        "https://auth.deriv.com/oauth2/auth?" +
        params.toString();

    res.redirect(authUrl);
});

// OAuth callback
app.get("/callback", async (req, res) => {
    try {
        const { code, state, error, error_description } = req.query;

        if (error) {
            return res.status(400).send(`
                <html>
                <head>
                    <title>Deriv Login Error</title>
                    <meta name="viewport" content="width=device-width,initial-scale=1">
                </head>
                <body style="font-family:Arial;padding:30px">
                    <h2>Deriv login failed</h2>
                    <p>${error}</p>
                    <p>${error_description || ""}</p>
                    <p><a href="/">Return to Tradedollars</a></p>
                </body>
                </html>
            `);
        }

        if (!code || !state) {
            return res.status(400).send(`
                <html>
                <body style="font-family:Arial;padding:30px">
                    <h2>Missing OAuth response</h2>
                    <p>No authorization code or state was received.</p>
                    <p><a href="/">Return to Tradedollars</a></p>
                </body>
                </html>
            `);
        }

        const cookies = req.headers.cookie || "";

        const stateMatch = cookies.match(
            /(?:^|;\s*)oauth_state=([^;]+)/
        );

        const verifierMatch = cookies.match(
            /(?:^|;\s*)pkce_verifier=([^;]+)/
        );

        const savedState = stateMatch
            ? decodeURIComponent(stateMatch[1])
            : null;

        const codeVerifier = verifierMatch
            ? decodeURIComponent(verifierMatch[1])
            : null;

        if (!savedState || state !== savedState) {
            return res.status(400).send(`
                <html>
                <body style="font-family:Arial;padding:30px">
                    <h2>Security check failed</h2>
                    <p>OAuth state did not match.</p>
                    <p>Please start the login again.</p>
                    <p><a href="/">Return to Tradedollars</a></p>
                </body>
                </html>
            `);
        }

        if (!codeVerifier) {
            return res.status(400).send(`
                <html>
                <body style="font-family:Arial;padding:30px">
                    <h2>Login session expired</h2>
                    <p>Please click Login with Deriv and try again.</p>
                    <p><a href="/">Return to Tradedollars</a></p>
                </body>
                </html>
            `);
        }

        // Exchange authorization code for access token
        const tokenResponse = await fetch(
            "https://auth.deriv.com/oauth2/token",
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded"
                },
                body: new URLSearchParams({
                    grant_type: "authorization_code",
                    client_id: CLIENT_ID,
                    code: code,
                    code_verifier: codeVerifier,
                    redirect_uri: REDIRECT_URI
                })
            }
        );

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok || !tokenData.access_token) {
            console.error("Token exchange failed:", tokenData);

            return res.status(400).send(`
                <html>
                <body style="font-family:Arial;padding:30px">
                    <h2>Deriv token exchange failed</h2>
                    <pre>${JSON.stringify(tokenData, null, 2)}</pre>
                    <p><a href="/">Return to Tradedollars</a></p>
                </body>
                </html>
            `);
        }

        const sessionId = createSession(tokenData);

        res.setHeader(
            "Set-Cookie",
            [
                `tradedollars_session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600`,
                "oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
                "pkce_verifier=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
            ]
        );

        res.redirect("/?login=success");
    } catch (error) {
        console.error("OAuth callback error:", error);

        res.status(500).send(`
            <html>
            <body style="font-family:Arial;padding:30px">
                <h2>Login error</h2>
                <p>${error.message}</p>
                <p><a href="/">Return to Tradedollars</a></p>
            </body>
            </html>
        `);
    }
});

// Return login/account status
app.get("/api/account", async (req, res) => {
    const session = getSession(req);

    if (!session) {
        return res.json({
            connected: false
        });
    }

    try {
        const response = await fetch(
            "https://api.derivws.com/trading/v1/options/accounts",
            {
                headers: {
                    Authorization:
                        `Bearer ${session.access_token}`
                }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        res.json({
            connected: true,
            data
        });
    } catch (error) {
        res.status(500).json({
            connected: false,
            error: error.message
        });
    }
});

// Logout
app.get("/logout", (req, res) => {
    const cookie = req.headers.cookie || "";

    const match = cookie.match(
        /(?:^|;\s*)tradedollars_session=([^;]+)/
    );

    if (match) {
        sessions.delete(match[1]);
    }

    res.setHeader(
        "Set-Cookie",
        "tradedollars_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
    );

    res.redirect("/");
});

// SPA fallback
app.get("/{*splat}", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
    console.log(`Tradedollars running on port ${PORT}`);
    console.log(`BASE_URL: ${BASE_URL}`);
    console.log(`REDIRECT_URI: ${REDIRECT_URI}`);
});
  
