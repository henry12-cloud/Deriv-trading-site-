
/* =========================================================
   TRADEDOLLARS — SERVER.JS
   OAuth login + demo account + trading connection
   REAL-MONEY TRADING DISABLED
   ========================================================= */

"use strict";

const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const path = require("path");

const app = express();

app.set("trust proxy", 1);

const PORT = process.env.PORT || 10000;

const CLIENT_ID =
  process.env.DERIV_CLIENT_ID ||
  process.env.CLIENT_ID ||
  "";

const DERIV_APP_ID = process.env.DERIV_APP_ID || "";

const BASE_URL = (
  process.env.BASE_URL ||
  "https://tradedollars.onrender.com"
).replace(/\/$/, "");

const REDIRECT_URI = `${BASE_URL}/oauth/callback`;

const SESSION_SECRET = process.env.SESSION_SECRET || "";

const DERIV_API = "https://api.derivws.com";
const AUTH_URL = "https://auth.deriv.com/oauth2/auth";
const TOKEN_URL = "https://auth.deriv.com/oauth2/token";


const ENABLE_REAL_TRADING =
  process.env.ENABLE_REAL_TRADING === "true";


/* ---------------- BASIC CONFIGURATION ---------------- */

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

if (!SESSION_SECRET) {
  console.error(
    "WARNING: SESSION_SECRET is missing from environment variables."
  );
}

app.use(
  session({
    name: "tradedollars.sid",
    secret: SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

/* ---------------- HELPER FUNCTIONS ---------------- */

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomString(bytes = 48) {
  return base64Url(crypto.randomBytes(bytes));
}

function sha256Base64Url(value) {
  return base64Url(
    crypto.createHash("sha256").update(value).digest()
  );
}

function requireLogin(req, res, next) {
  if (!req.session || !req.session.accessToken) {
    return res.status(401).json({
      authenticated: false,
      error: "Please log in with Deriv."
    });
  }

  next();
}

function bearerHeaders(req) {
  return {
    Authorization: `Bearer ${req.session.accessToken}`,
    "Content-Type": "application/json"
  };
}

async function derivRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {})
    }
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const apiMessage =
      result?.errors?.[0]?.message ||
      result?.error?.message ||
      result?.message ||
      `Deriv API request failed (${response.status})`;

    const error = new Error(apiMessage);
    error.status = response.status;
    error.details = result;

    throw error;
  }

  return result;
}

function accountListFromResponse(result) {
  const data = result?.data;

  if (Array.isArray(data)) return data;

  if (Array.isArray(data?.accounts)) return data.accounts;

  if (Array.isArray(result?.accounts)) return result.accounts;

  if (data && typeof data === "object" && data.account_id) {
    return [data];
  }

  return [];
}

function normalizeAccount(account) {
  return {
    id: account.account_id || account.id || "",
    balance: account.balance ?? 0,
    currency: account.currency || "USD",
    account_type: String(account.account_type || "").toLowerCase(),
    status: account.status || "active"
  };
}

async function getDemoAccount(req) {
  const result = await derivRequest(
    `${DERIV_API}/trading/v1/options/accounts`,
    {
      method: "GET",
      headers: bearerHeaders(req)
    }
  );

  const accounts = accountListFromResponse(result);

  const demo = accounts.find(account => {
    return String(account.account_type || "").toLowerCase() === "demo";
  });

  if (!demo) {
    const error = new Error(
      "No demo Options account was returned by Deriv."
    );

    error.status = 404;
    throw error;
  }

  const account = normalizeAccount(demo);

  req.session.accountId = account.id;
  req.session.account = account;

  return account;
}

function sendApiError(res, error) {
  console.error("API error:", error.message);

  return res.status(error.status || 500).json({
    error: error.message || "Server error",
    ...(error.details ? { details: error.details } : {})
  });
}

/* ---------------- HEALTH ---------------- */

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    app: "Tradedollars",
    real_trading_enabled: ENABLE_REAL_TRADING
  });
});

/* ---------------- FRONTEND CONFIG ---------------- */


app.get("/api/config", (req, res) => {
  res.set("Cache-Control", "no-store");

  res.json({
    configured: Boolean(
      CLIENT_ID && DERIV_APP_ID && BASE_URL && SESSION_SECRET
    ),
    app_id: DERIV_APP_ID,
    real_trading_enabled: ENABLE_REAL_TRADING
  });
});


/* ---------------- DERIV LOGIN ---------------- */

app.get("/login", (req, res) => {
  if (!CLIENT_ID) {
    return res.status(500).send(
      "Deriv OAuth is not configured. Check the CLIENT_ID environment variable."
    );
  }

  const state = randomString(24);
  const verifier = randomString(64);
  const challenge = sha256Base64Url(verifier);

  req.session.oauthState = state;
  req.session.codeVerifier = verifier;

  const url = new URL(AUTH_URL);

  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", "trade");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  req.session.save(error => {
    if (error) {
      console.error("Could not save login session:", error);
      return res.status(500).send("Could not start Deriv login.");
    }

    res.redirect(url.toString());
  });
});

/* ---------------- OAUTH CALLBACK ---------------- */

app.get("/oauth/callback", async (req, res) => {
  try {
    if (req.query.error) {
      return res.status(400).send(
        `Deriv login failed: ${String(req.query.error_description || req.query.error)}`
      );
    }

    const code = req.query.code;
    const returnedState = req.query.state;

    if (!code || !returnedState) {
      return res.status(400).send(
        "Missing authorization code or state."
      );
    }

    if (
      !req.session.oauthState ||
      returnedState !== req.session.oauthState
    ) {
      return res.status(400).send(
        "Login verification failed. Please start login again."
      );
    }

    const verifier = req.session.codeVerifier;

    if (!verifier) {
      return res.status(400).send(
        "Login verification expired. Please try again."
      );
    }

    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        code: String(code),
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier
      })
    });

    const tokenData = await tokenResponse.json().catch(() => ({}));

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error(
        "OAuth token exchange failed:",
        tokenData.error || tokenData.message || tokenResponse.status
      );

      return res.status(502).send(
        "Could not complete Deriv login. Please try again."
      );
    }

    req.session.accessToken = tokenData.access_token;
    req.session.tokenExpiresAt = tokenData.expires_in
      ? Date.now() + Number(tokenData.expires_in) * 1000
      : null;

    delete req.session.oauthState;
    delete req.session.codeVerifier;
    delete req.session.accountId;
    delete req.session.account;

    req.session.save(error => {
      if (error) {
        console.error("Could not save authenticated session:", error);
        return res.status(500).send(
          "Login succeeded but the session could not be saved."
        );
      }

      res.redirect("/");
    });
  } catch (error) {
    console.error("OAuth callback error:", error.message);

    res.status(500).send(
      "An error occurred while completing Deriv login."
    );
  }
});

/* ---------------- SESSION STATUS ---------------- */

app.get("/api/session", (req, res) => {
  res.set("Cache-Control", "no-store");

  const authenticated = Boolean(req.session?.accessToken);

  res.json({
    authenticated,
    account_id: req.session?.accountId || null,
    account: req.session?.account || null
  });
});

/* ---------------- DEMO ACCOUNT ---------------- */

app.get("/api/account", requireLogin, async (req, res) => {
  res.set("Cache-Control", "no-store");

  try {
    const account = await getDemoAccount(req);

    req.session.save(error => {
      if (error) {
        console.error("Account session save error:", error);
      }

      res.json({
        connected: true,
        account
      });
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

/* -------- TEMPORARY ACCOUNT VERIFICATION -------- */

app.get("/api/accounts-check", requireLogin, async (req, res) => {
  res.set("Cache-Control", "no-store");

  try {
    const result = await derivRequest(
      `${DERIV_API}/trading/v1/options/accounts`,
      {
        method: "GET",
        headers: bearerHeaders(req)
      }
    );

    const accounts = accountListFromResponse(result);

    res.json({
      verified: true,
      count: accounts.length,
      accounts: accounts.map(account => {
        const normalized = normalizeAccount(account);

        return {
          account_type: normalized.account_type,
          currency: normalized.currency,
          status: normalized.status,
          account_id: normalized.id
            ? "..." + normalized.id.slice(-4)
            : null
        };
      })
    });
  } catch (error) {
    sendApiError(res, error);
  }
});
       
/* ---------------- ACCOUNT STATUS ---------------- */

app.get("/account-status", requireLogin, async (req, res) => {
  try {
    const account = await getDemoAccount(req);

    res.json({
      connected: true,
      account
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

/* ---------------- DEMO TRADING CONNECTION ---------------- */

app.get(
  "/api/trading-connection",
  requireLogin,
  async (req, res) => {
    res.set("Cache-Control", "no-store");

    try {
      // Always resolve a demo account from Deriv.
      const account = await getDemoAccount(req);

      if (!account.id) {
        return res.status(400).json({
          error: "Demo account ID is missing."
        });
      }

      const result = await derivRequest(
        `${DERIV_API}/trading/v1/options/accounts/${encodeURIComponent(account.id)}/otp`,
        {
          method: "POST",
          headers: bearerHeaders(req)
        }
      );

      const data = result?.data || result;

      const wsUrl =
        data.url ||
        data.ws_url ||
        data.websocket_url ||
        null;

      if (!wsUrl) {
        return res.status(502).json({
          error: "Deriv did not return a WebSocket URL."
        });
      }


      // Enforce the exact demo WebSocket endpoint.
      let parsedWsUrl;

      try {
        parsedWsUrl = new URL(wsUrl);
      } catch {
        return res.status(502).json({
          error: "Invalid trading WebSocket URL."
        });
      }

      if (
        parsedWsUrl.protocol !== "wss:" ||
        parsedWsUrl.hostname !== "api.derivws.com" ||
        parsedWsUrl.pathname !==
          "/trading/v1/options/ws/demo" ||
        !parsedWsUrl.searchParams.has("otp")
      ) {
        return res.status(403).json({
          error: "Only authenticated demo trading is permitted."
        });
     }
   

      if (wsUrl.includes("/real")) {
        return res.status(403).json({
          error: "Real-money connections are disabled."
        });
      }

      res.json({
        connected: true,
        account_id: account.id,
        account_type: "demo",
        ws_url: wsUrl,
        real_trading_enabled: false
      });
    } catch (error) {
      sendApiError(res, error);
    }
  }
);

/* ---------------- LOGOUT ---------------- */

function destroySession(req, res) {
  if (!req.session) {
    return res.json({ success: true });
  }

  req.session.destroy(error => {
    if (error) {
      console.error("Logout error:", error);

      return res.status(500).json({
        success: false,
        error: "Could not log out."
      });
    }

    res.clearCookie("tradedollars.sid", {
      httpOnly: true,
      secure: true,
      sameSite: "lax"
    });

    res.json({ success: true });
  });
}

app.get("/logout", destroySession);
app.post("/logout", destroySession);

/* ---------------- STATIC WEBSITE ---------------- */

app.use(
  express.static(path.join(__dirname), {
    index: "index.html",
    etag: true
  })
);

/* ---------------- START SERVER ---------------- */

app.listen(PORT, () => {
  console.log("Tradedollars server started.");
  console.log(`Port: ${PORT}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`OAuth redirect: ${REDIRECT_URI}`);
  console.log(`Deriv client configured: ${Boolean(CLIENT_ID)}`);
  console.log(`Deriv app ID configured: ${Boolean(DERIV_APP_ID)}`);
  console.log(`Real-money trading enabled: ${ENABLE_REAL_TRADING}`);
});
