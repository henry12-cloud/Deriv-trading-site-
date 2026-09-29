
"use strict";

const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(express.json({ limit: "20kb" }));

const CLIENT_ID =
  process.env.DERIV_CLIENT_ID ||
  process.env.CLIENT_ID ||
  "";

const BASE_URL = (
  process.env.BASE_URL ||
  "https://tradedollars.onrender.com"
).replace(/\/+$/, "");

const REDIRECT_URI =
  BASE_URL + "/oauth/callback";

const SESSION_SECRET =
  process.env.SESSION_SECRET || "";

const REAL_TRADING_ENABLED =
  process.env.ENABLE_REAL_TRADING === "true";

const API_BASE = "https://api.derivws.com";

app.use(
  session({
    name: "tradedollars.sid",
    secret:
      SESSION_SECRET ||
      crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: BASE_URL.startsWith("https://"),
      sameSite: "lax",
      maxAge: 60 * 60 * 1000
    }
  })
);

app.use(
  express.static(path.join(__dirname), {
    index: false,
    dotfiles: "deny"
  })
);

function makeRandom() {
  return crypto.randomBytes(32).toString("base64url");
}

function makeChallenge(verifier) {
  return crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function isLoggedIn(req) {
  return Boolean(
    req.session.accessToken &&
    req.session.expiresAt > Date.now()
  );
}

function requireLogin(req, res, next) {
  if (!isLoggedIn(req)) {
    return res.status(401).json({
      error: "Please log in with Deriv."
    });
  }

  next();
}

async function derivRequest(
  endpoint,
  accessToken,
  options = {}
) {
  const response = await fetch(API_BASE + endpoint, {
    ...options,
    headers: {
      Authorization: "Bearer " + accessToken,
      "Deriv-App-ID": CLIENT_ID,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(15000)
  });

  const result = await response.json();

  if (!response.ok || result.error) {
    throw new Error(
      result.error?.message ||
      result.errors?.[0]?.message ||
      "Deriv request failed."
    );
  }

  return result.data ?? result;
}

function getAccounts(result) {
  if (Array.isArray(result)) return result;

  if (Array.isArray(result.accounts)) {
    return result.accounts;
  }

  if (Array.isArray(result.items)) {
    return result.items;
  }

  return [];
}

function getAccountId(account) {
  return String(
    account.account_id ||
    account.accountId ||
    account.id ||
    account.loginid ||
    ""
  );
}

function isDemoAccount(account) {
  const description = String(
    account.account_type ||
    account.accountType ||
    account.type ||
    ""
  ).toLowerCase();

  return (
    description.includes("demo") ||
    description.includes("virtual") ||
    getAccountId(account).startsWith("VRTC")
  );
}

/*
 * WEBSITE
 */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    application: "Tradedollars"
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    app_id: CLIENT_ID,
    configured: Boolean(
      CLIENT_ID && SESSION_SECRET
    ),
    real_trading_enabled: REAL_TRADING_ENABLED
  });
});

/*
 * DERIV OAUTH LOGIN
 */

app.get("/login", async (req, res) => {
  if (!CLIENT_ID || !SESSION_SECRET) {
    return res.status(503).send(
      "Configure CLIENT_ID and SESSION_SECRET on Render."
    );
  }

  const verifier = makeRandom();
  const state = makeRandom();

  req.session.oauthVerifier = verifier;
  req.session.oauthState = state;

  try {
    await saveSession(req);
  } catch {
    return res.status(500).send(
      "Unable to start a login session."
    );
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "trade",
    state,
    code_challenge: makeChallenge(verifier),
    code_challenge_method: "S256"
  });

  res.redirect(
    "https://auth.deriv.com/oauth2/auth?" +
    params.toString()
  );
});

/*
 * OAUTH CALLBACK
 */

async function oauthCallback(req, res) {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send(
      "Deriv login was cancelled or rejected."
    );
  }

  if (
    typeof code !== "string" ||
    typeof state !== "string" ||
    !req.session.oauthState ||
    !req.session.oauthVerifier ||
    state !== req.session.oauthState
  ) {
    return res.status(400).send(
      "Invalid or expired login session. Please log in again."
    );
  }

  const verifier = req.session.oauthVerifier;

  delete req.session.oauthState;
  delete req.session.oauthVerifier;

  try {
    const response = await fetch(
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
          code,
          code_verifier: verifier,
          redirect_uri: REDIRECT_URI
        }),
        signal: AbortSignal.timeout(15000)
      }
    );

    const result = await response.json();

    if (!response.ok || !result.access_token) {
      throw new Error(
        result.error_description ||
        "Token exchange failed."
      );
    }

    req.session.accessToken = result.access_token;

    req.session.expiresAt =
      Date.now() +
      Math.max(
        0,
        Number(result.expires_in || 3600) - 60
      ) * 1000;

    await saveSession(req);

    res.redirect("/?login=success");
  } catch (error) {
    console.error("OAuth callback:", error.message);

    res.status(502).send(
      "Deriv login could not be completed. " +
      "Please return to Tradedollars and try again."
    );
  }
}

app.get("/oauth/callback", oauthCallback);

/*
 * LOGOUT
 */

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("tradedollars.sid");
    res.redirect("/");
  });
});

/*
 * ACCOUNT DETAILS
 */

app.get(
  "/api/account",
  requireLogin,
  async (req, res) => {
    try {
      const result = await derivRequest(
        "/trading/v1/options/accounts",
        req.session.accessToken
      );

      const accounts = getAccounts(result);

      if (!accounts.length) {
        return res.json({
          connected: true,
          accounts: [],
          account: null
        });
      }

      const account =
        accounts.find(isDemoAccount) || accounts[0];

      req.session.accountId = getAccountId(account);

      await saveSession(req);

      res.json({
        connected: true,
        account: {
          ...account,
          loginid: getAccountId(account)
        },
        accounts: accounts.map((item) => ({
          id: getAccountId(item),
          currency: item.currency,
          is_demo: isDemoAccount(item)
        }))
      });
    } catch (error) {
      res.status(502).json({
        error: error.message
      });
    }
  }
);

/*
 * AUTHENTICATED TRADING CONNECTION
 *
 * Deriv supplies a one-time WebSocket URL.
 * The browser connects directly using this URL.
 */

app.post(
  "/api/trading-connection",
  requireLogin,
  async (req, res) => {
    try {
      const result = await derivRequest(
        "/trading/v1/options/accounts",
        req.session.accessToken
      );

      const accounts = getAccounts(result);

      const requestedId = String(
        req.body?.account_id || ""
      );

      let account;

      if (requestedId) {
        account = accounts.find(
          (item) =>
            getAccountId(item) === requestedId
        );
      } else {
        account = accounts.find(isDemoAccount);
      }

      if (!account) {
        return res.status(400).json({
          error: "No eligible account found."
        });
      }

      if (
        !isDemoAccount(account) &&
        !REAL_TRADING_ENABLED
      ) {
        return res.status(403).json({
          error:
            "Real-money trading is disabled. " +
            "Select a demo account."
        });
      }

      const accountId = getAccountId(account);

      const otp = await derivRequest(
        "/trading/v1/options/accounts/" +
          encodeURIComponent(accountId) +
          "/otp",
        req.session.accessToken,
        {
          method: "POST"
        }
      );

      const url = otp.url || otp.websocket_url;

      if (
        typeof url !== "string" ||
        !url.startsWith("wss://api.derivws.com/")
      ) {
        throw new Error(
          "Deriv did not return a valid trading URL."
        );
      }

      res.set("Cache-Control", "no-store");

      res.json({
        url,
        account_id: accountId,
        currency: account.currency || "USD",
        is_demo: isDemoAccount(account)
      });
    } catch (error) {
      res.status(502).json({
        error: error.message
      });
    }
  }
);

/*
 * ERROR HANDLING
 */

app.use((error, req, res, next) => {
  console.error("Server error:", error.message);

  res.status(500).json({
    error: "An internal server error occurred."
  });
});

app.listen(PORT, () => {
  console.log(
    "Tradedollars running on port " + PORT
  );

  if (!SESSION_SECRET) {
    console.warn(
      "SESSION_SECRET is missing. Configure it on Render."
    );
  }
});
