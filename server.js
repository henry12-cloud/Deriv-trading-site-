
"use strict";

const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.DERIV_CLIENT_ID;
const BASE_URL =
  (process.env.BASE_URL || "").replace(/\/$/, "");

const REDIRECT_URI = BASE_URL + "/callback";

const sessions = new Map();

app.use(express.json());
app.use(express.static(__dirname));

function getCookie(req, name) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(
    new RegExp("(?:^|;\\s*)" + name + "=([^;]+)")
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge
  };
}

app.get("/health", (req, res) => {
  res.json({
    server: "running",
    oauth_configured: Boolean(CLIENT_ID && BASE_URL),
    redirect_uri: REDIRECT_URI,
    client_id_present: Boolean(CLIENT_ID)
  });
});

app.get("/login", (req, res) => {
  if (!CLIENT_ID || !BASE_URL) {
    return res.status(500).send(
      "Missing OAuth configuration in Render."
    );
  }

  const state = crypto.randomBytes(32).toString("hex");
  const verifier =
    crypto.randomBytes(48).toString("base64url");

  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");

  res.cookie(
    "oauth_state",
    state,
    cookieOptions(600000)
  );

  res.cookie(
    "pkce_verifier",
    verifier,
    cookieOptions(600000)
  );

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
    "https://auth.deriv.com/oauth2/auth?" +
    params.toString()
  );
});

app.get("/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send(
      "Deriv login declined: " +
      String(error) +
      '. <a href="/">Return to Tradedollars</a>'
    );
  }

  const savedState = getCookie(req, "oauth_state");
  const verifier = getCookie(req, "pkce_verifier");

  if (
    typeof code !== "string" ||
    typeof state !== "string" ||
    !savedState ||
    !verifier ||
    state !== savedState
  ) {
    return res.status(400).send(
      "Invalid or expired login session. " +
      '<a href="/login">Try again</a>'
    );
  }

  res.clearCookie("oauth_state", cookieOptions(0));
  res.clearCookie("pkce_verifier", cookieOptions(0));

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
        })
      }
    );

    if (!response.ok) {
      console.error(
        "Token exchange HTTP status:",
        response.status
      );

      return res.status(400).send(
        "Deriv token exchange failed. " +
        '<a href="/login">Try again</a>'
      );
    }

    const data = await response.json();

    if (!data.access_token) {
      return res.status(400).send(
        "Deriv did not return an access token."
      );
    }

    const sessionId =
      crypto.randomBytes(32).toString("hex");

    const expiresIn = Math.max(
      1,
      Number(data.expires_in) || 3600
    );

    sessions.set(sessionId, {
      accessToken: data.access_token,
      expiresAt: Date.now() + expiresIn * 1000
    });

    res.cookie(
      "tradedollars_session",
      sessionId,
      cookieOptions(expiresIn * 1000)
    );

    res.redirect("/?login=success");

  } catch (err) {
    console.error("OAuth callback:", err.message);

    res.status(500).send(
      "Login could not be completed. " +
      '<a href="/login">Try again</a>'
    );
  }
});

app.get("/api/account", async (req, res) => {
  const id = getCookie(req, "tradedollars_session");
  const session = id ? sessions.get(id) : null;

  if (!session || session.expiresAt <= Date.now()) {
    if (id) sessions.delete(id);
    return res.json({ connected: false });
  }

  try {
    const response = await fetch(
      "https://api.derivws.com/trading/v1/options/accounts",
      {
        headers: {
          Authorization: "Bearer " + session.accessToken
        }
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({
        connected: false,
        error: "Unable to retrieve account details"
      });
    }

    const data = await response.json();

    res.json({
      connected: true,
      data
    });

  } catch (err) {
    console.error("Account request:", err.message);

    res.status(500).json({
      connected: false,
      error: "Account request failed"
    });
  }
});

app.get("/logout", (req, res) => {
  const id = getCookie(req, "tradedollars_session");

  if (id) sessions.delete(id);

  res.clearCookie(
    "tradedollars_session",
    cookieOptions(0)
  );

  res.redirect("/");
});

app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log("Tradedollars running on port " + PORT);
  console.log(
    "OAuth configured:",
    Boolean(CLIENT_ID && BASE_URL)
  );
  console.log("Redirect URI:", REDIRECT_URI);
});

  
