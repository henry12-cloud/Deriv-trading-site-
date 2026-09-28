
"use strict";

const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID =
  process.env.DERIV_CLIENT_ID ||
  process.env.CLIENT_ID;

const BASE_URL = (
  process.env.BASE_URL ||
  "https://tradedollars.onrender.com"
).replace(/\/+$/, "");

const REDIRECT_URI = BASE_URL + "/callback";
const API = "https://api.derivws.com";
const sessions = new Map();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "10kb" }));
app.use(express.static(__dirname, {
  index: false,
  dotfiles: "deny"
}));

function random() {
  return crypto.randomBytes(32).toString("base64url");
}

function cookies(req) {
  const result = {};

  (req.headers.cookie || "")
    .split(";")
    .forEach(item => {
      const pos = item.indexOf("=");
      if (pos > 0) {
        result[item.slice(0, pos).trim()] =
          item.slice(pos + 1).trim();
      }
    });

  return result;
}

function setCookie(res, name, value, age) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: age,
    path: "/"
  });
}

function clearCookie(res, name) {
  res.clearCookie(name, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/"
  });
}

function session(req) {
  const id = cookies(req).td_session;
  if (!id) return null;

  const item = sessions.get(id);

  if (!item || Date.now() > item.expires) {
    sessions.delete(id);
    return null;
  }

  return item;
}

function sameOrigin(req, res, next) {
  const origin = req.get("origin");

  if (origin !== BASE_URL) {
    return res.status(403).json({
      error: "Invalid request origin."
    });
  }

  next();
}

function accountList(payload) {
  const list = Array.isArray(payload)
    ? payload
    : payload?.data?.accounts ||
      payload?.accounts ||
      payload?.data ||
      [];

  return Array.isArray(list) ? list : [];
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/api/config", (req, res) => {
  res.json({
    configured: Boolean(CLIENT_ID),
    appId: CLIENT_ID || "",
    callback: REDIRECT_URI
  });
});

app.get("/login", (req, res) => {
  if (!CLIENT_ID) {
    return res.status(500).send(
      "Set DERIV_CLIENT_ID in Render."
    );
  }

  const state = random();
  const verifier = random();

  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");

  const pendingId = random();

  sessions.set(pendingId, {
    state,
    verifier,
    expires: Date.now() + 600000
  });

  setCookie(res, "td_pending", pendingId, 600000);

  const url = new URL(
    "https://auth.deriv.com/oauth2/auth"
  );

  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", "trade");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  res.redirect(url.toString());
});

app.get(
  ["/callback", "/oauth/callback"],
  async (req, res) => {
    const pendingId = cookies(req).td_pending;
    const pending = sessions.get(pendingId);

    if (req.query.error) {
      return res.status(400).send(
        "Deriv login was cancelled or declined."
      );
    }

    if (
      !pending ||
      pending.expires < Date.now() ||
      !req.query.code ||
      req.query.state !== pending.state
    ) {
      return res.status(400).send(
        "Login expired. Return to Tradedollars."
      );
    }

    sessions.delete(pendingId);
    clearCookie(res, "td_pending");

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
            code: String(req.query.code),
            code_verifier: pending.verifier,
            redirect_uri: REDIRECT_URI
          })
        }
      );

      const data = await response.json();

      if (!response.ok || !data.access_token) {
        console.error(
          "OAuth exchange failed:",
          response.status
        );

        return res.status(400).send(
          "Deriv login failed. Please try again."
        );
      }

      const oldId = cookies(req).td_session;
      if (oldId) sessions.delete(oldId);

      const id = random();
      const lifetime =
        (Number(data.expires_in) || 3600) * 1000;

      sessions.set(id, {
        token: data.access_token,
        expires: Date.now() + lifetime
      });

      setCookie(res, "td_session", id, lifetime);
      res.redirect("/");
    } catch (err) {
      console.error("OAuth request failed");

      res.status(502).send(
        "Deriv authentication is unavailable."
      );
    }
  }
);

async function fetchAccounts(token) {
  const response = await fetch(
    API + "/trading/v1/options/accounts",
    {
      headers: {
        Authorization: "Bearer " + token
      }
    }
  );

  if (!response.ok) {
    throw new Error("Account request failed");
  }

  return response.json();
}

app.get("/api/account", async (req, res) => {
  const current = session(req);

  if (!current?.token) {
    return res.status(401).json({
      connected: false
    });
  }

  try {
    const accounts = await fetchAccounts(
      current.token
    );

    res.set("Cache-Control", "no-store");

    res.json({
      connected: true,
      accounts
    });
  } catch {
    res.status(502).json({
      connected: false,
      error: "Unable to retrieve account."
    });
  }
});

// DEMO ACCOUNTS ONLY.
// Returns a short-lived authenticated WebSocket URL.
// Never returns the user's OAuth access token.

app.post(
  "/api/demo-connection",
  sameOrigin,
  async (req, res) => {
    res.set("Cache-Control", "no-store");

    const current = session(req);

    if (!current?.token) {
      return res.status(401).json({
        error: "Log in with Deriv first."
      });
    }

    try {
      const payload = await fetchAccounts(
        current.token
      );

      const accounts = accountList(payload);

      const demo = accounts.find(account =>
        account.account_type === "demo" ||
        account.type === "demo"
      );

      if (!demo) {
        return res.status(403).json({
          error: "No demo account available."
        });
      }

      const accountId =
        demo.account_id ||
        demo.id ||
        demo.loginid;

      if (
        typeof accountId !== "string" ||
        !/^[A-Za-z0-9_-]{3,64}$/.test(accountId)
      ) {
        return res.status(400).json({
          error: "Invalid demo account."
        });
      }

      const response = await fetch(
        API +
        "/trading/v1/options/accounts/" +
        encodeURIComponent(accountId) +
        "/otp",
        {
          method: "POST",
          headers: {
            Authorization:
              "Bearer " + current.token
          }
        }
      );

      if (!response.ok) {
        return res.status(502).json({
          error: "Demo connection unavailable."
        });
      }

      const result = await response.json();
      const wsUrl = result?.data?.url;

      if (typeof wsUrl !== "string") {
        throw new Error("Missing WebSocket URL");
      }

      const parsed = new URL(wsUrl);

      if (
        parsed.protocol !== "wss:" ||
        parsed.hostname !== "api.derivws.com" ||
        parsed.pathname !==
          "/trading/v1/options/ws/demo" ||
        !parsed.searchParams.get("otp")
      ) {
        throw new Error("Unexpected trading endpoint");
      }

      res.json({
        accountId,
        accountType: "demo",
        wsUrl
      });
    } catch {
      res.status(502).json({
        error: "Unable to connect demo account."
      });
    }
  }
);

app.post("/logout", sameOrigin, (req, res) => {
  const id = cookies(req).td_session;

  if (id) sessions.delete(id);

  clearCookie(res, "td_session");

  res.json({
    connected: false
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    "Tradedollars running on port " + PORT
  );
});
  
