require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

let userAccessToken = "";

// OAuth callback
app.get("/auth/google/callback", async (req, res) => {
  const code = req.query.code;

  try {
    const tokenResponse = await axios.post("https://oauth2.googleapis.com/token", {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code: code,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code"
    });

    userAccessToken = tokenResponse.data.access_token;
    console.log("Access Token:", userAccessToken);

    res.redirect("http://127.0.0.1:5500/fitbit-dashboard.html");

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.send("Token error");
  }
});

// Get steps
app.get("/getSteps", async (req, res) => {
  try {
    const response = await axios.post(
      "https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate",
      {
        aggregateBy: [{ dataTypeName: "com.google.step_count.delta" }],
        bucketByTime: { durationMillis: 86400000 },
        startTimeMillis: Date.now() - 30 * 24 * 60 * 60 * 1000,
        endTimeMillis: Date.now()
      },
      {
        headers: {
          Authorization: `Bearer ${userAccessToken}`
        }
      }
    );

    res.json(response.data);

  } catch (error) {
    console.error("Fit API Error:", error.response?.data || error.message);
    res.send("Error fetching steps");
  }
});

// ✅ THIS WAS MISSING
app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});