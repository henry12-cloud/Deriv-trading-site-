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
  "change-this-session-secret";

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
      SESSION_SECRET,

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
      error:
        "not_authenticated"
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


function bearerHeaders(req) {
  return {
    Authorization:
      `Bearer ${req.session.accessToken}`,

    "Content-Type":
      "application/json"
  };
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
      service:
        "tradedollars"
    });
  }
);


/* =========================================================
   CONFIG
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
            "OAuth session save error:",
            saveError
          );

          return res.status(500).send(
            "Unable to start secure login."
          );
        }

        const params =
          new URLSearchParams({
            response_type:
              "code",

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

        res.redirect(
          `${AUTH_URL}?${params.toString()}`
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


      const codeVerifier =
        req.session.codeVerifier;


      if (!codeVerifier) {
        return res.status(400).send(
          "Missing PKCE verifier."
        );
      }


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
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded"
            },

            body:
              body.toString()
          }
        );


      if (
        !tokenResponse?.access_token
      ) {
        throw new Error(
          "Deriv did not return an access token."
        );
      }


      req.session.accessToken =
        tokenResponse.access_token;

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
            method:
              "GET",

            headers:
              bearerHeaders(req)
          }
        );


      const accounts =
        Array.isArray(data?.data)
          ? data.data
          : [];


      if (!accounts.length) {
        return res.json({
          connected:
            true,

          account:
            null
        });
      }


      let selectedAccount =
        null;


      if (
        ENABLE_REAL_TRADING
      ) {
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


      req.session.account = {
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
        connected:
          true,

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
   ACCOUNT STATUS
========================================================= */

app.get(
  "/account-status",
  async (req, res) => {
    if (
      !req.session.accessToken
    ) {
      return res.json({
        connected:
          false,

        account:
          null
      });
    }

    try {
      const data =
        await derivRequest(
          `${DERIV_API}/trading/v1/options/accounts`,
          {
            method:
              "GET",

            headers:
              bearerHeaders(req)
          }
        );


      const accounts =
        Array.isArray(data?.data)
          ? data.data
          : [];


      if (!accounts.length) {
        return res.json({
          connected:
            true,

          account:
            null
        });
      }


      let account =
        null;


      if (
        req.session.accountId
      ) {
        account =
          accounts.find(
            item =>
              (
                item.account_id ||
                item.id
              ) ===
              req.session.accountId
          );
      }


      if (!account) {
        account =
          ENABLE_REAL_TRADING
            ? accounts.find(
                item =>
                  item.account_type ===
                  "real"
              )
            : accounts.find(
                item =>
                  item.account_type ===
                  "demo"
              );
      }


      account =
        account ||
        accounts[0];


      const accountId =
        account.account_id ||
        account.id ||
        null;


      req.session.accountId =
        accountId;


      req.session.account = {
        id:
          accountId,

        balance:
          account.balance ??
          null,

        currency:
          account.currency ||
          "USD",

        account_type:
          account.account_type ||
          null,

        status:
          account.status ||
          null
      };


      req.session.save(
        () => {}
      );


      res.json({
        connected:
          true,

        account:
          req.session.account
      });

    } catch (error) {
      console.error(
        "Account status error:",
        error
      );

      res.status(
        error.status || 500
      ).json({
        connected:
          false,

        error:
          error.message ||
          "Unable to check account."
      });
    }
  }
);


/* =========================================================
   AUTHENTICATED TRADING WEBSOCKET
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
            method:
              "POST",

            headers:
              bearerHeaders(req)
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
   SESSION STATUS
========================================================= */

app.get(
  "/api/session",
  (req, res) => {
    res.json({
      authenticated:
        Boolean(
          req.session.accessToken
        ),

      account_id:
        getAccountId(req),

      account:
        req.session.account ||
        null
    });
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
          "tradedollars.sid",
          {
            httpOnly:
              true,

            secure:
              true,

            sameSite:
              "lax"
          }
        );

        res.json({
          ok:
            true
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
