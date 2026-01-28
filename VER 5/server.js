require("dotenv").config();
const express = require("express");
const axios = require("axios");
const session = require("express-session");
const path = require("path");

const app = express();
app.use(express.json());

app.use(
  session({
    secret: "supersecret",
    resave: false,
    saveUninitialized: true
  })
);

const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI } = process.env;

/* =========================
   HELPER: FILL MISSING DATA
========================= */
function fillMissingWithAverage(data, key) {
  const validValues = data.map(d => d[key]).filter(v => v && v > 0);

  if (validValues.length === 0) return data; // all missing → keep as is

  const avg = Math.round(
    validValues.reduce((a, b) => a + b, 0) / validValues.length
  );

  data.forEach(d => {
    if (!d[key] || d[key] === 0) {
      d[key] = avg;
      d[`${key}Estimated`] = true; // optional flag
    }
  });

  return data;
}

/* =========================
   STEP 1: START OAUTH
========================= */
app.get("/auth/google", (req, res) => {
  const scope = encodeURIComponent(
    "https://www.googleapis.com/auth/fitness.activity.read " +
    "https://www.googleapis.com/auth/fitness.heart_rate.read " +
    "https://www.googleapis.com/auth/fitness.sleep.read " +
    "https://www.googleapis.com/auth/fitness.body.read " +
    "https://www.googleapis.com/auth/userinfo.profile " +
    "https://www.googleapis.com/auth/user.birthday.read " +
    "https://www.googleapis.com/auth/user.gender.read"
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

/* =========================
   STEP 2: CALLBACK
========================= */
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
    console.error("OAuth Error:", err.response?.data || err.message);
    res.send("OAuth failed");
  }
});

/* =========================
   DASHBOARD
========================= */
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "fitbit-dashboard.html"));
});

/* =========================
   USER PROFILE
========================= */
app.get("/getProfile", async (req, res) => {
  if (!req.session.accessToken) return res.status(401).send("Not authenticated");

  try {
    const profileRes = await axios.get(
      "https://people.googleapis.com/v1/people/me?personFields=birthdays,names,genders",
      {
        headers: { Authorization: `Bearer ${req.session.accessToken}` }
      }
    );

    const data = profileRes.data;

    let age = "Not available";
    if (data.birthdays?.length && data.birthdays[0].date.year) {
      const b = data.birthdays[0].date;
      const birthDate = new Date(b.year, b.month - 1, b.day);
      age = new Date(Date.now() - birthDate).getUTCFullYear() - 1970;
    }

    let gender = "Not available";
    if (data.genders?.length) gender = data.genders[0].value;

    res.json({
      name: data.names?.[0]?.displayName || "Unknown",
      age,
      gender
    });

  } catch (err) {
    console.error("People API Error:", err.response?.data || err.message);
    res.send("Profile error");
  }
});

/* =========================
   FITNESS DATA (LAST 7 DAYS)
========================= */
app.get("/getFitnessData", async (req, res) => {
  if (!req.session.accessToken) return res.status(401).send("Not authenticated");

  try {
    const endTimeMillis = Date.now();
    const startTimeMillis = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const response = await axios.post(
      "https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate",
      {
        aggregateBy: [
          { dataTypeName: "com.google.step_count.delta" },
          { dataTypeName: "com.google.heart_rate.bpm" },
          { dataTypeName: "com.google.sleep.segment" },
          { dataTypeName: "com.google.calories.expended" },
          { dataTypeName: "com.google.weight" },
          { dataTypeName: "com.google.height" }
        ],
        bucketByTime: { durationMillis: 86400000 },
        startTimeMillis,
        endTimeMillis
      },
      {
        headers: { Authorization: `Bearer ${req.session.accessToken}` }
      }
    );

    const dailyData = [];

    response.data.bucket.forEach(bucket => {
      let steps = 0, calories = 0, heartRates = [], sleepSegments = 0, weight = 0, height = 0;

      bucket.dataset.forEach(dataset => {
        dataset.point.forEach(point => {
          point.value.forEach(val => {
            const type = dataset.dataSourceId;

            if (type.includes("step_count")) steps += val.intVal || 0;
            if (type.includes("calories")) calories += val.fpVal || 0;
            if (type.includes("heart_rate")) heartRates.push(val.fpVal || 0);
            if (type.includes("sleep")) sleepSegments += 1;
            if (type.includes("weight")) weight = val.fpVal || weight;
            if (type.includes("height")) height = val.fpVal || height;
          });
        });
      });

      const avgHeartRate =
        heartRates.length ? Math.round(heartRates.reduce((a,b)=>a+b)/heartRates.length) : 0;

      const date = new Date(Number(bucket.startTimeMillis)).toISOString().split("T")[0];

      dailyData.push({
        date,
        steps,
        calories: Math.round(calories),
        avgHeartRate,
        sleepSegments,
        weightKg: weight,
        heightMeters: height
      });
    });

    // ✅ FILL MISSING DATA WITH AVERAGES
    fillMissingWithAverage(dailyData, "steps");
    fillMissingWithAverage(dailyData, "calories");
    fillMissingWithAverage(dailyData, "avgHeartRate");
    fillMissingWithAverage(dailyData, "sleepSegments");

    req.session.fitnessData = dailyData;
    res.json(dailyData);

  } catch (err) {
    console.error("Fit API Error:", err.response?.data || err.message);
    res.send("Fit API error");
  }
});

/* =========================
   AI FITNESS COACH CHAT
========================= */
app.post("/chat", async (req, res) => {
  if (!req.session.fitnessData) {
    return res.json({ reply: "Load fitness data first." });
  }

  const userMessage = req.body.message;
  const fitnessData = req.session.fitnessData;

  const prompt = `
You are an intelligent AI Fitness Coach.

User 7-day fitness data:
${JSON.stringify(fitnessData, null, 2)}

User question: "${userMessage}"

Rules:
- Analyze trends
- Highlight positives
- Flag risks
- Ask 1 clarification question
- Give 3 practical tips
- Do not diagnose
- Tone motivating
- Bullet points only
`;

  try {
    const ollamaRes = await axios.post("http://localhost:11434/api/generate", {
      model: "gemma3:4b",
      prompt,
      stream: false
    });

    res.json({ reply: ollamaRes.data.response });

  } catch (err) {
    console.error("Ollama error:", err.message);
    res.json({ reply: "AI coach failed" });
  }
});

/* =========================
   HOME
========================= */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "fitbit-login.html"));
});

app.listen(3000, () =>
  console.log("✅ Server running at http://localhost:3000")
);