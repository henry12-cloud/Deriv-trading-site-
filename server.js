
/* =========================================================
   TRADEDOLLARS — SERVER.JS
   Deriv OAuth + sessions + account verification
   Demo quote connection only
   REAL-MONEY ORDER PLACEMENT DISABLED
   ========================================================= */

"use strict";

const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const path = require("path");

const app = express();

app.set("trust proxy", 1);

const PORT = Number(process.env.PORT) || 10000;

const CLIENT_ID =
  process.env.DERIV_CLIENT_ID ||
  process.env.CLIENT_ID ||
  "";

const DERIV_APP_ID = process.env.DERIV_APP_ID || "";

const BASE_URL = (
  process.env.BASE_URL ||
  "https://tradedollars.onrender.com"
).replace(/\/+$/, "");

const REDIRECT_URI = `${BASE_URL}/oauth/callback`;

const SESSION_SECRET = process.env.SESSION_SECRET || "";

const DERIV_API = "https://api.derivws.com";
const AUTH_URL = "https://auth.deriv.com/oauth2/auth";
const TOKEN_URL = "https://auth.deriv.com/oauth2/token";

// Keep real-money trading disabled.
const ENABLE_REAL_TRADING = false;

/* ---------------- STARTUP VALIDATION ---------------- */

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error(
    "STARTUP ERROR: Set SESSION_SECRET in Render to a stable, random secret of at least 32 characters."
  );
  process.exit(1);
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error("STARTUP ERROR: Invalid PORT.");
  process.exit(1);
}

/* ---------------- MIDDLEWARE ---------------- */

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

app.use(
  session({
    name: "tradedollars.sid",
    secret: SESSION_SECRET,
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
    },
    signal: AbortSignal.timeout(15000)
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const apiMessage =
      result?.errors?.[0]?.message ||
      result?.error?.message ||
      result?.message ||
      `Deriv API request failed (${response.status}).`;

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
    id: String(
      account.account_id ||
      account.id ||
      account.loginid ||
      ""
    ),
    balance: account.balance ?? null,
    currency: account.currency || "USD",
    account_type: String(
      account.account_type || ""
    ).toLowerCase(),
    status: String(account.status || "active").toLowerCase()
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
    return (
      String(account.account_type || "").toLowerCase() === "demo"
    );
  });

  if (!demo) {
    const error = new Error(
      "No demo Options account was returned by Deriv."
    );

    error.status = 404;
    throw error;
  }

  const account = normalizeAccount(demo);

  if (!account.id) {
    const error = new Error(
      "Deriv returned a demo account without an account ID."
    );

    error.status = 502;
    throw error;
  }

  // Store only the selected demo account in this session.
  req.session.accountId = account.id;
  req.session.account = {
    account_id: account.id,
    account_type: "demo",
    balance: account.balance,
    currency: account.currency,
    status: account.status
  };

  return account;
}

function sendApiError(res, error) {
  console.error("API error:", error.message);

  const status = Number(error.status);

  return res.status(
    status >= 400 && status <= 599 ? status : 500
  ).json({
    error: error.message || "Server error."
  });
}

function requireDemoMode(req, res, next) {
  const mode = String(req.query.mode || "demo").toLowerCase();

  if (mode !== "demo") {
    return res.status(403).json({
      error: "Only demo-account mode is permitted. Real-money trading is disabled."
    });
  }

  next();
}

/* ---------------- HEALTH ---------------- */

app.get("/health", (req, res) => {
  res.set("Cache-Control", "no-store");

  res.json({
    ok: true,
    app: "Tradedollars",
    real_trading_enabled: false
  });
});

/* ---------------- FRONTEND CONFIG ---------------- */

app.get("/api/config", (req, res) => {
  res.set("Cache-Control", "no-store");

  res.json({
    configured: Boolean(
      CLIENT_ID &&
      DERIV_APP_ID &&
      BASE_URL &&
      SESSION_SECRET
    ),
    app_id: DERIV_APP_ID,
    real_trading_enabled: false
  });
});

/* ---------------- DERIV LOGIN ---------------- */

app.get("/login", (req, res) => {
  if (!CLIENT_ID) {
    return res.status(500).send(
      "Deriv OAuth is not configured. Check DERIV_CLIENT_ID in Render."
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
      console.error("Could not save login session:", error.message);

      return res.status(500).send(
        "Could not start Deriv login. Check the server logs."
      );
    }

    return res.redirect(url.toString());
  });
});

/* ---------------- OAUTH CALLBACK ---------------- */

app.get("/oauth/callback", async (req, res) => {
  try {
    if (req.query.error) {
      return res.status(400).send(
        "Deriv login failed. Please return to Tradedollars and try again."
      );
    }

    const code = req.query.code;
    const returnedState = req.query.state;

    if (
      typeof code !== "string" ||
      typeof returnedState !== "string"
    ) {
      return res.status(400).send(
        "Missing authorization code or state. Please log in again."
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
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier
      }),
      signal: AbortSignal.timeout(15000)
    });

    const tokenData = await tokenResponse.json().catch(() => ({}));

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error("OAuth token exchange failed:", {
        status: tokenResponse.status,
        error: tokenData.error || tokenData.message || "Unknown error"
      });

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
        console.error(
          "Could not save authenticated session:",
          error.message
        );

        return res.status(500).send(
          "Login succeeded but the session could not be saved. Please try again."
        );
      }

      return res.redirect("/");
    });
  } catch (error) {
    console.error("OAuth callback error:", error.message);

    return res.status(500).send(
      "An error occurred while completing Deriv login. Please try again."
    );
  }
});

/* ---------------- SESSION STATUS ---------------- */

app.get("/api/session", (req, res) => {
  res.set("Cache-Control", "no-store");

  const authenticated = Boolean(req.session?.accessToken);

  res.json({
    authenticated,
    account_id: authenticated
      ? req.session.accountId || null
      : null,
    account: authenticated
      ? req.session.account || null
      : null
  });
});


/* ---------------- ACCOUNT DETAILS ---------------- */

app.get(
  "/api/account",
  requireLogin,
  async (req, res) => {
    res.set("Cache-Control", "no-store");

    try {
      const mode = String(
        req.query.mode || "demo"
      ).toLowerCase();

      if (mode !== "demo" && mode !== "real") {
        return res.status(400).json({
          connected: false,
          error: "Invalid account mode.",
          real_trading_enabled: false
        });
      }

      let account;

      if (mode === "demo") {
        // Preserve the existing demo-account selection.
        account = await getDemoAccount(req);
      } else {
        // Read-only lookup: do not store the real account
        // as the session's selected trading account.
        const result = await derivRequest(
          `${DERIV_API}/trading/v1/options/accounts`,
          {
            method: "GET",
            headers: bearerHeaders(req)
          }
        );

        const accounts = accountListFromResponse(result);

        const realAccount = accounts.find(item => {
          return (
            String(item.account_type || "").toLowerCase() === "real"
          );
        });

        if (!realAccount) {
          return res.status(404).json({
            connected: false,
            error: "No real Options account was returned by Deriv.",
            real_trading_enabled: false
          });
        }

        account = normalizeAccount(realAccount);

        if (!account.id) {
          return res.status(502).json({
            connected: false,
            error: "Deriv returned a real account without an account ID.",
            real_trading_enabled: false
          });
        }
      }

      return res.json({
        connected: true,
        account: {
          account_id: account.id,
          account_type: mode,
          balance: account.balance,
          currency: account.currency,
          status: account.status
        },
        read_only: mode === "real",
        real_trading_enabled: false
      });
    } catch (error) {
      return sendApiError(res, error);
    }
  }
);

/* ---------------- ACCOUNT VERIFICATION ---------------- */

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

    return res.json({
      verified: true,
      count: accounts.length,
      accounts: accounts.map(item => {
        const account = normalizeAccount(item);

        return {
          account_type: account.account_type,
          currency: account.currency,
          status: account.status,
          account_id: account.id
            ? "..." + account.id.slice(-4)
            : null
        };
      }),
      real_trading_enabled: false
    });
  } catch (error) {
    return sendApiError(res, error);
  }
});

/* ---------------- REAL ACCOUNT SAFETY BLOCK ---------------- */

// Real account checks and real WebSocket credentials are deliberately
// unavailable while real-money trading is disabled.

app.get(
  "/api/real-connection-check",
  requireLogin,
  (req, res) => {
    res.set("Cache-Control", "no-store");

    return res.status(403).json({
      verified: false,
      connected: false,
      error: "Real-account connection checks are disabled while real-money trading is off.",
      real_trading_enabled: false,
      socket_opened: false,
      order_placed: false
    });
  }
);

app.get(
  "/api/real-trading-connection",
  requireLogin,
  (req, res) => {
    res.set("Cache-Control", "no-store");

    return res.status(403).json({
      connected: false,
      error: "Real-money trading is disabled.",
      real_trading_enabled: false
    });
  }
);

/* ---------------- LEGACY ACCOUNT STATUS ---------------- */

app.get("/account-status", requireLogin, async (req, res) => {
  res.set("Cache-Control", "no-store");

  try {
    const account = await getDemoAccount(req);

    return res.json({
      connected: true,
      account: {
        account_id: account.id,
        account_type: "demo",
        balance: account.balance,
        currency: account.currency,
        status: account.status
      }
    });
  } catch (error) {
    return sendApiError(res, error);
  }
});

/* ---------------- DEMO QUOTE CONNECTION ---------------- */

app.get(
  "/api/trading-connection",
  requireLogin,
  requireDemoMode,
  async (req, res) => {
    res.set("Cache-Control", "no-store");

    try {
      const account = await getDemoAccount(req);

      if (account.status !== "active") {
        return res.status(403).json({
          connected: false,
          error: "The demo account is not active."
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
          connected: false,
          error: "Deriv did not return a WebSocket URL."
        });
      }

      let parsedUrl;

      try {
        parsedUrl = new URL(wsUrl);
      } catch {
        return res.status(502).json({
          connected: false,
          error: "Deriv returned an invalid WebSocket URL."
        });
      }

      const validDemoUrl =
        parsedUrl.protocol === "wss:" &&
        parsedUrl.hostname === "api.derivws.com" &&
        parsedUrl.pathname === "/trading/v1/options/ws/demo" &&
        parsedUrl.searchParams.has("otp");

      if (!validDemoUrl) {
        return res.status(403).json({
          connected: false,
          error: "Deriv did not return the expected demo WebSocket endpoint."
        });
      }

      return res.json({
        connected: true,
        account_id: account.id,
        account_type: "demo",
        ws_url: wsUrl,
        real_trading_enabled: false
      });
    } catch (error) {
      return sendApiError(res, error);
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
      console.error("Logout error:", error.message);

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

    return res.json({ success: true });
  });
}

app.get("/logout", destroySession);
app.post("/logout", destroySession);

/* ---------------- PROTECT SERVER FILES ---------------- */

// Do not serve server-side configuration or source files to visitors.
app.use((req, res, next) => {
  const blockedFiles = new Set([
    "/server.js",
    "/package.json",
    "/package-lock.json",
    "/.env"
  ]);

  if (blockedFiles.has(req.path)) {
    return res.sendStatus(404);
  }

  next();
});

/* ---------------- STATIC WEBSITE ---------------- */

app.use(
  express.static(path.join(__dirname), {
    index: "index.html",
    dotfiles: "deny",
    etag: true,
    setHeaders(res) {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    }
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
  console.log("Real-money trading enabled: false");
});
