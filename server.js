
const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.DERIV_CLIENT_ID;
const BASE_URL = (process.env.BASE_URL || "")
  .replace(/\/$/, "");

const REDIRECT_URI = BASE_URL + "/callback";

app.use(express.json());
app.use(express.static(__dirname));

// Temporary sessions.
// Use persistent storage for production.
const sessions = new Map();

function random() {
  return crypto.randomBytes(32).toString("base64url");
}

function getSession(req) {
  const match = (req.headers.cookie || "")
    .match(/(?:^|;\s*)td_session=([^;]+)/);

  return match ? sessions.get(match[1]) : null;
}

function requireLogin(req, res, next) {
  const session = getSession(req);

  if (!session || !session.accessToken) {
    return res.status(401).json({
      error: "Please log in with Deriv."
    });
  }

  if (Date.now() >= session.expiresAt) {
    return res.status(401).json({
      error: "Session expired. Please log in again."
    });
  }

  req.session = session;
  next();
}

async function derivRequest(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error_description ||
      data.error?.message ||
      data.message ||
      "Deriv request failed."
    );
  }

  return data;
}

// START DERIV LOGIN
app.get("/login", (req, res) => {
  if (!CLIENT_ID || !BASE_URL) {
    return res.status(500).send(
      "Configure DERIV_CLIENT_ID and BASE_URL."
    );
  }

  const sessionId = random();
  const verifier = random();
  const state = random();

  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");

  sessions.set(sessionId, {
    verifier,
    state,
    createdAt: Date.now()
  });

  res.cookie("td_session", sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 3600000
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "trade",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  });

  res.redirect(
    "https://auth.deriv.com/oauth2/auth?" + params
  );
});

// DERIV OAUTH CALLBACK
app.get("/callback", async (req, res) => {
  const session = getSession(req);

  if (
    !session ||
    !req.query.code ||
    !req.query.state ||
    req.query.state !== session.state ||
    Date.now() - session.createdAt > 600000
  ) {
    return res.status(400).send(
      "Invalid or expired login. Please try again."
    );
  }

  const verifier = session.verifier;

  delete session.verifier;
  delete session.state;

  try {
    const token = await derivRequest(
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
          code: req.query.code,
          code_verifier: verifier,
          redirect_uri: REDIRECT_URI
        })
      }
    );

    if (!token.access_token) {
      throw new Error("No access token received.");
    }

    session.accessToken = token.access_token;

    session.expiresAt =
      Date.now() +
      (Number(token.expires_in) || 3600) * 1000;

    res.redirect("/?login=success");

  } catch (error) {
    console.error("OAuth error:", error.message);

    res.status(502).send(
      "Deriv login failed. Please try again."
    );
  }
});

// FETCH TRADING ACCOUNTS
app.get(
  "/api/accounts",
  requireLogin,
  async (req, res) => {
    try {
      const data = await derivRequest(
        "https://api.derivws.com/trading/v1/options/accounts",
        {
          headers: {
            Authorization:
              "Bearer " + req.session.accessToken
          }
        }
      );

      res.json(data);

    } catch (error) {
      res.status(502).json({
        error: error.message
      });
    }
  }
);

// GET AUTHENTICATED WEBSOCKET URL
app.post(
  "/api/otp",
  requireLogin,
  async (req, res) => {
    try {
      const accountId = req.body.accountId;

      if (
        typeof accountId !== "string" ||
        !/^[a-zA-Z0-9_-]+$/.test(accountId)
      ) {
        return res.status(400).json({
          error: "Invalid account ID."
        });
      }

      const data = await derivRequest(
        "https://api.derivws.com/trading/v1/options/accounts/" +
          encodeURIComponent(accountId) +
          "/otp",
        {
          method: "POST",
          headers: {
            Authorization:
              "Bearer " + req.session.accessToken
          }
        }
      );

      res.json({
        url: data.data?.url
      });

    } catch (error) {
      res.status(502).json({
        error: error.message
      });
    }
  }
);

// LOG OUT
app.post("/logout", (req, res) => {
  const match = (req.headers.cookie || "")
    .match(/(?:^|;\s*)td_session=([^;]+)/);

  if (match) {
    sessions.delete(match[1]);
  }

  res.clearCookie("td_session");

  res.json({
    success: true
  });
});

// HEALTH CHECK
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    application: "Tradedollars"
  });
});

// START SERVER
app.listen(PORT, () => {
  console.log(
    "Tradedollars server running on port " + PORT
  );
});
