
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
app.use(express.json());
app.use(express.static(__dirname, {
  index: false
}));

function cookies(req) {
  const result = {};
  (req.headers.cookie || "").split(";").forEach(item => {
    const pos = item.indexOf("=");
    if (pos > 0) {
      result[item.slice(0, pos).trim()] =
        item.slice(pos + 1).trim();
    }
  });
  return result;
}

function random() {
  return crypto.randomBytes(32).toString("base64url");
}

function cookie(res, name, value, age) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: age,
    path: "/"
  });
}

function session(req) {
  const id = cookies(req).td_session;
  const item = sessions.get(id);
  if (!item) return null;

  if (Date.now() > item.expires) {
    sessions.delete(id);
    return null;
  }
  return item;
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

  cookie(res, "td_pending", pendingId, 600000);

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
        "Deriv login error: " +
        String(req.query.error_description ||
          req.query.error)
      );
    }

    if (
      !pending ||
      pending.expires < Date.now() ||
      !req.query.code ||
      req.query.state !== pending.state
    ) {
      return res.status(400).send(
        "Login expired or invalid. Return to " +
        "Tradedollars and log in again."
      );
    }

    sessions.delete(pendingId);
    res.clearCookie("td_pending", { path: "/" });

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
        console.error("OAuth exchange failed", {
          status: response.status,
          error: data.error
        });

        return res.status(400).send(
          "Deriv could not complete login. " +
          "Check your registered callback URL."
        );
      }

      const id = random();

      sessions.set(id, {
        token: data.access_token,
        expires: Date.now() +
          (Number(data.expires_in) || 3600) * 1000
      });

      cookie(
        res,
        "td_session",
        id,
        (Number(data.expires_in) || 3600) * 1000
      );

      res.redirect("/");
    } catch (err) {
      console.error("OAuth error:", err.message);
      res.status(502).send(
        "Deriv authentication is temporarily unavailable."
      );
    }
  }
);

app.get("/api/account", async (req, res) => {
  const current = session(req);

  if (!current || !current.token) {
    return res.status(401).json({
      connected: false
    });
  }

  try {
    const response = await fetch(
      API + "/trading/v1/options/accounts",
      {
        headers: {
          Authorization: "Bearer " + current.token
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        connected: false,
        error: "Could not retrieve Deriv accounts."
      });
    }

    res.json({
      connected: true,
      accounts: data
    });
  } catch (err) {
    res.status(502).json({
      connected: false,
      error: "Account service unavailable."
    });
  }
});

app.post("/logout", (req, res) => {
  const id = cookies(req).td_session;
  if (id) sessions.delete(id);

  res.clearCookie("td_session", { path: "/" });
  res.json({ connected: false });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Tradedollars running on port " + PORT);
});
                   
