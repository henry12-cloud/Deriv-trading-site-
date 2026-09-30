const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const path = require("path");

const app = express();

app.set("trust proxy", 1);

const PORT =
  process.env.PORT || 10000;

const CLIENT_ID =
  process.env.DERIV_CLIENT_ID ||
  process.env.CLIENT_ID ||
  "";

const BASE_URL =
  (
    process.env.BASE_URL ||
    "https://tradedollars.onrender.com"
  ).replace(/\/$/, "");

const REDIRECT_URI =
  `${BASE_URL}/oauth/callback`;

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  "";

const ENABLE_REAL_TRADING =
  process.env.ENABLE_REAL_TRADING === "true";

const DERIV_API =
  "https://api.derivws.com";

const AUTH_URL =
  "https://auth.deriv.com/oauth2/auth";

const TOKEN_URL =
  "https://auth.deriv.com/oauth2/token";


/* =========================================================
   BASIC SETUP
========================================================= */

app.use(
  express.json()
);

app.use(
  express.urlencoded({
    extended: false
  })
);


app.use(
  session({
    name: "tradedollars.sid",

    secret:
      SESSION_SECRET ||
      "temporary-development-secret-change-before-launch",

    resave: false,

    saveUninitialized: false,

    proxy: true,

    cookie: {
      httpOnly: true,

      secure: true,

      sameSite: "lax",

      maxAge:
        24 * 60 * 60 * 1000
    }
  })
);


/* =========================================================
   HELPERS
========================================================= */

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}


function randomString(bytes = 32) {
  return base64Url(
    crypto.randomBytes(bytes)
  );
}


function sha256Base64Url(value) {
  return base64Url(
    crypto
      .createHash("sha256")
      .update(value)
      .digest()
  );
}


function requireLogin(req, res, next) {
  if (!req.session.accessToken) {
    return res.status(401).json({
      error: "not_authenticated"
    });
  }

  next();
}


function getAccountId(req) {
  return (
    req.session.accountId ||
    req.session.account?.id ||
    req.session.account?.account_id ||
    null
  );
}


async function derivRequest(
  url,
  options = {}
) {
  const response =
    await fetch(
      url,
      options
    );

  const text =
    await response.text();

  let data = null;

  try {
    data =
      text
        ? JSON.parse(text)
        : null;
  } catch (_) {
    data = {
      raw: text
    };
  }

  if (!response.ok) {
    const message =
      data?.errors?.[0]?.message ||
      data?.error_description ||
      data?.error ||
      `Deriv request failed (${response.status})`;

    const error =
      new Error(message);

    error.status =
      response.status;

    error.data =
      data;

    throw error;
  }

  return data;
}


/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/health",
  (req, res) => {
    res.json({
      ok: true,
      service: "tradedollars"
    });
  }
);


/* =========================================================
   FRONTEND CONFIG
========================================================= */

app.get(
  "/api/config",
  (req, res) => {
    res.json({
      configured:
        Boolean(
          CLIENT_ID &&
          BASE_URL
        ),

      app_id:
        CLIENT_ID || null,

      real_trading_enabled:
        ENABLE_REAL_TRADING
    });
  }
);


/* =========================================================
   LOGIN
========================================================= */

app.get(
  "/login",
  (req, res) => {
    if (
      !CLIENT_ID ||
      !BASE_URL
    ) {
      return res.status(500).send(
        "Deriv OAuth is not configured on the server."
      );
    }

    const state =
      randomString(32);

    const codeVerifier =
      randomString(48);

    const codeChallenge =
      sha256Base64Url(
        codeVerifier
      );

    req.session.oauthState =
      state;

    req.session.codeVerifier =
      codeVerifier;

    req.session.save(
      saveError => {
        if (saveError) {
          console.error(
            "Session save error:",
            saveError
          );

          return res.status(500).send(
            "Unable to start secure login."
          );
        }

        const params =
          new URLSearchParams({
            response_type: "code",

            client_id:
              CLIENT_ID,

            redirect_uri:
              REDIRECT_URI,

            scope:
              "trade",

            state,

            code_challenge:
              codeChallenge,

            code_challenge_method:
              "S256"
          });

        const loginUrl =
          `${AUTH_URL}?${params.toString()}`;

        res.redirect(
          loginUrl
        );
      }
    );
  }
);


/* =========================================================
   OAUTH CALLBACK
========================================================= */

app.get(
  "/oauth/callback",
  async (req, res) => {
    try {
      const {
        code,
        state,
        error,
        error_description
      } = req.query;


      if (error) {
        return res.status(400).send(
          `Deriv login failed: ${
            error_description ||
            error
          }`
        );
      }


      if (
        !code ||
        !state
      ) {
        return res.status(400).send(
          "Missing OAuth code or state."
        );
      }


      if (
        !req.session.oauthState ||
        state !==
          req.session.oauthState
      ) {
        return res.status(400).send(
          "Invalid or expired OAuth state."
        );
      }


      if (
        !req.session.codeVerifier
      ) {
        return res.status(400).send(
          "Missing PKCE verifier."
        );
      }


      const codeVerifier =
        req.session.codeVerifier;


      const body =
        new URLSearchParams({
          grant_type:
            "authorization_code",

          client_id:
            CLIENT_ID,

          code,

          code_verifier:
            codeVerifier,

          redirect_uri:
            REDIRECT_URI
        });


      const tokenResponse =
        await derivRequest(
          TOKEN_URL,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded"
            },

            body:
              body.toString()
          }
        );


      const accessToken =
        tokenResponse.access_token;


      if (!accessToken) {
        throw new Error(
          "Deriv did not return an access token."
        );
      }


      req.session.accessToken =
        accessToken;

      req.session.tokenType =
        tokenResponse.token_type ||
        "Bearer";


      req.session.tokenExpiresAt =
        tokenResponse.expires_in
          ? Date.now() +
            Number(
              tokenResponse.expires_in
            ) *
              1000
          : null;


      delete req.session.oauthState;
      delete req.session.codeVerifier;


      req.session.save(
        saveError => {
          if (saveError) {
            console.error(
              "Session save error:",
              saveError
            );

            return res.status(500).send(
              "Login succeeded but the session could not be saved."
            );
          }

          res.redirect("/");
        }
      );

    } catch (error) {
      console.error(
        "OAuth callback error:",
        error
      );

      res.status(500).send(
        `Deriv OAuth error: ${
          error.message ||
          "Unable to complete login."
        }`
      );
    }
  }
);


/* =========================================================
   ACCOUNT
========================================================= */

app.get(
  "/api/account",
  requireLogin,
  async (req, res) => {
    try {
      const data =
        await derivRequest(
          `${DERIV_API}/trading/v1/options/accounts`,
          {
            method: "GET",

            headers: {
              Authorization:
                `Bearer ${req.session.accessToken}`
            }
          }
        );


      let accounts =
        Array.isArray(data?.data)
          ? data.data
          : [];


      if (!accounts.length) {
        return res.json({
          connected: true,
          account: null
        });
      }


      /*
        Prefer a real account when
        real trading is enabled.

        Otherwise prefer demo.
      */

      let selectedAccount;


      if (ENABLE_REAL_TRADING) {
        selectedAccount =
          accounts.find(
            account =>
              account.account_type ===
              "real"
          );
      }


      if (!selectedAccount) {
        selectedAccount =
          accounts.find(
            account =>
              account.account_type ===
              "demo"
          );
      }


      if (!selectedAccount) {
        selectedAccount =
          accounts[0];
      }


      const accountId =
        selectedAccount.account_id ||
        selectedAccount.id ||
        null;


      req.session.accountId =
        accountId;


      req.session.account =
        {
          id:
            accountId,

          balance:
            selectedAccount.balance ??
            null,

          currency:
            selectedAccount.currency ||
            "USD",

          account_type:
            selectedAccount.account_type ||
            null,

          status:
            selectedAccount.status ||
            null
        };


      req.session.save(
        () => {}
      );


      res.json({
        connected: true,

        account:
          req.session.account
      });

    } catch (error) {
      console.error(
        "Account API error:",
        error
      );

      if (
        error.status === 401
      ) {
        req.session.destroy(
          () => {}
        );

        return res.status(401).json({
          error:
            "authentication_expired"
        });
      }

      res.status(
        error.status || 500
      ).json({
        error:
          error.message ||
          "Unable to load account."
      });
    }
  }
);


/* =========================================================
   AUTHENTICATED TRADING CONNECTION
========================================================= */

app.get(
  "/api/trading-connection",
  requireLogin,
  async (req, res) => {
    try {
      const accountId =
        getAccountId(req);


      if (!accountId) {
        return res.status(400).json({
          error:
            "No Deriv trading account is available."
        });
      }


      const url =
        `${DERIV_API}/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`;


      const data =
        await derivRequest(
          url,
          {
            method: "POST",

            headers: {
              Authorization:
                `Bearer ${req.session.accessToken}`
            }
          }
        );


      const wsUrl =
        data?.data?.url;


      if (!wsUrl) {
        return res.status(500).json({
          error:
            "Deriv did not return a trading WebSocket URL."
        });
      }


      res.json({
        ws_url:
          wsUrl,

        account_id:
          accountId
      });

    } catch (error) {
      console.error(
        "Trading connection error:",
        error
      );

      if (
        error.status === 401
      ) {
        return res.status(401).json({
          error:
            "Deriv authentication expired."
        });
      }

      res.status(
        error.status || 500
      ).json({
        error:
          error.message ||
          "Unable to create trading connection."
      });
    }
  }
);


/* =========================================================
   LOGOUT
========================================================= */

app.post(
  "/logout",
  (req, res) => {
    req.session.destroy(
      error => {
        if (error) {
          console.error(
            "Logout error:",
            error
          );

          return res.status(500).json({
            error:
              "Unable to log out."
          });
        }

        res.clearCookie(
          "tradedollars.sid"
        );

        res.json({
          ok: true
        });
      }
    );
  }
);


/* =========================================================
   FRONTEND
========================================================= */

app.use(
  express.static(
    path.join(
      __dirname
    )
  )
);


/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  () => {
    console.log(
      `Tradedollars server running on port ${PORT}`
    );

    console.log(
      `BASE_URL: ${BASE_URL}`
    );

    console.log(
      `OAuth redirect: ${REDIRECT_URI}`
    );

    console.log(
      `Client ID configured: ${Boolean(CLIENT_ID)}`
    );

    console.log(
      `Real trading enabled: ${ENABLE_REAL_TRADING}`
    );
  }
);
