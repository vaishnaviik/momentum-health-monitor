require("dotenv").config();
const express = require("express");
const axios = require("axios");
const session = require("express-session");

const app = express();

app.use(
  session({
    secret: "supersecret",
    resave: false,
    saveUninitialized: true
  })
);

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
} = process.env;

/* STEP 1: START OAUTH */
app.get("/auth/google", (req, res) => {
  const scope = encodeURIComponent(
    "https://www.googleapis.com/auth/fitness.activity.read " +
    "https://www.googleapis.com/auth/fitness.heart_rate.read " +
    "https://www.googleapis.com/auth/fitness.sleep.read"
  );

  const authURL =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${CLIENT_ID}` +
    `&redirect_uri=${REDIRECT_URI}` +
    `&response_type=code` +
    `&scope=${scope}` +
    `&access_type=offline` +
    `&prompt=consent`;

  res.redirect(authURL);
});

/* STEP 2: CALLBACK */
app.get("/auth/google/callback", async (req, res) => {
  const code = req.query.code;

  try {
    const tokenRes = await axios.post(
      "https://oauth2.googleapis.com/token",
      {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code"
      }
    );

    req.session.accessToken = tokenRes.data.access_token;

    res.redirect("/dashboard");

  } catch (err) {
    console.error(err.response?.data || err.message);
    res.send("OAuth failed");
  }
});

/* STEP 3: DASHBOARD */
app.get("/dashboard", (req, res) => {
  res.sendFile(__dirname + "/fitbit-dashboard.html");
});

/* STEP 4: PROTECTED API */
app.get("/getSteps", async (req, res) => {
  if (!req.session.accessToken) {
    return res.status(401).send("Not authenticated");
  }

  try {
    const fitRes = await axios.post(
      "https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate",
      {
        aggregateBy: [{ dataTypeName: "com.google.step_count.delta" }],
        bucketByTime: { durationMillis: 86400000 },
        startTimeMillis: Date.now() - 7 * 86400000,
        endTimeMillis: Date.now()
      },
      {
        headers: {
          Authorization: `Bearer ${req.session.accessToken}`
        }
      }
    );

    res.json(fitRes.data);

  } catch (err) {
    console.error(err.response?.data || err.message);
    res.send("Fit API error");
  }
});

app.listen(3000, () =>
  console.log("✅ Server running at http://localhost:3000")
);
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/fitbit-login.html");
});

