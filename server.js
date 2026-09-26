
"use strict";

const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.DERIV_CLIENT_ID;
const BASE_URL = (process.env.BASE_URL || "")
  .replace(/\/$/, "");

const REDIRECT_URI = BASE_URL + "/callback";

const sessions = new Map();

app.use(express.json());
app.use(express.static(__dirname));

function readCookie(req, name) {
  const cookies = req.headers.cookie || "";
  const match = cookies.match(
    new RegExp("(?:^|;\\s*)" + name + "=([^;]+)")
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function clearCookie(res, name) {
  res.clearCookie(name, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/"
  });
}

// Check server configuration
app.get("/health", (req, res) => {
  res.json({
    server: "running",
    oauth_configured: Boolean(CLIENT_ID && BASE_URL),
    redirect_uri: REDIRECT_URI,
    client_id_present: Boolean(CLIENT_ID)
  });
});

// Start Deriv OAuth login
app.get("/login", (req, res) => {
  if (!CLIENT_ID || !BASE_URL) {
    return res.status(500).send(
      "Missing DERIV_CLIENT_ID or BASE_URL in Render."
    );
  }

  const state = crypto.randomBytes(32).toString("hex");
  const verifier = crypto.randomBytes(48)
    .toString("base64url");

  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");

  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600000,
    path: "/"
  };

  res.cookie("oauth_state", state, cookieOptions);
  res.cookie("pkce_verifier", verifier, cookieOptions);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "trade",
    state: state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  });

  const authUrl =
    "https://auth.deriv.com/oauth2/auth?" +
    params.toString();

  res.redirect(authUrl);
});

// Deriv OAuth callback
app.get("/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error("OAuth provider error:", error);
    return res.status(400).send(
      "Deriv declined login. Please return to Tradedollars."
    );
  }

  if (!code || !state) {
    return res.status(400).send(
      "No authorization response received. " +
      "Start login from the Tradedollars homepage."
    );
  }

  const savedState = readCookie(req, "oauth_state");
  const verifier = readCookie(req, "pkce_verifier");

  if (
    typeof state !== "string" ||
    !savedState ||
    !verifier ||
    state !== savedState
  ) {
    return res.status(400).send(
      "Login security check failed. Please try again."
    );
  }

  clearCookie(res, "oauth_state");
  clearCookie(res, "pkce_verifier");

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
          code: code,
          code_verifier: verifier,
          redirect_uri: REDIRECT_URI
        })
      }
    );

    if (!response.ok) {
      console.error(
        "Deriv token exchange HTTP status:",
        response.status
      );
      return res.status(400).send(
        "Deriv token exchange failed. " +
        "Check your OAuth application settings."
      );
    }

    const data = await response.json();

    if (!data.access_token) {
      return res.status(400).send(
        "Deriv did not return an access token."
      );
    }

    const sessionId = crypto.randomBytes(32)
      .toString("hex");

    const expiresIn = Number(data.expires_in) || 3600;

    sessions.set(sessionId, {
      token: data.access_token,
      expiresAt: Date.now() + expiresIn * 1000
    });

    res.cookie("tradedollars_session", sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: expiresIn * 1000,
      path: "/"
    });

    res.redirect("/?login=success");

  } catch (err) {
    console.error("OAuth request failed:", err.message);
    res.status(500).send(
      "Unable to complete Deriv login. Try again."
    );
  }
});

// Account status
app.get("/api/account", async (req, res) => {
  const id = readCookie(req, "tradedollars_session");
  const session = id && sessions.get(id);

  if (!session || Date.now() >= session.expiresAt) {
    if (id) sessions.delete(id);
    return res.json({ connected: false });
  }

  try {
    const response = await fetch(
      "https://api.derivws.com/trading/v1/options/accounts",
      {
        headers: {
          Authorization: "Bearer " + session.token
        }
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({
        connected: false,
        error: "Unable to retrieve Deriv accounts"
      });
    }

    const data = await response.json();

    res.json({
      connected: true,
      data: data
    });

  } catch (err) {
    res.status(500).json({
      connected: false,
      error: "Account request failed"
    });
  }
});

// Compatibility with older frontend code
app.get("/account-status", (req, res) => {
  res.redirect(307, "/api/account");
});

// Logout
app.get("/logout", (req, res) => {
  const id = readCookie(req, "tradedollars_session");

  if (id) sessions.delete(id);

  clearCookie(res, "tradedollars_session");
  res.redirect("/");
});

// Website fallback
app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log("Tradedollars running on port " + PORT);
  console.log("OAuth configured:", Boolean(CLIENT_ID && BASE_URL));
  console.log("Redirect URI:", REDIRECT_URI);
});
               
