require("dotenv").config();
const webpush = require("web-push");
const express = require("express");
const axios = require("axios");
const session = require("express-session");
const path = require("path");

/* =========================
   PUSH CONFIG
========================= */
webpush.setVapidDetails(
  "mailto:test@momentum.app",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const app = express();
app.use(express.static(__dirname));
app.use(express.json());

app.use(
  session({
    secret: "supersecret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
  })
);

const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI } = process.env;

/* =========================
   HELPER: FILL MISSING DATA
========================= */
function fillMissingWithAverage(data, key) {
  const validValues = data.map(d => d[key]).filter(v => v && v > 0);

  if (validValues.length === 0) return data;

  const avg = Math.round(
    validValues.reduce((a, b) => a + b, 0) / validValues.length
  );

  data.forEach(d => {
    if (!d[key] || d[key] === 0) {
      d[key] = avg;
      d[`${key}Estimated`] = true;
    }
  });

  return data;
}

/* =========================
   PUSH SUBSCRIPTIONS
========================= */
const subscriptions = [];

app.post("/subscribe", (req, res) => {
  console.log("📱 New push subscription:", req.body);
  
  // Check if subscription already exists
  const exists = subscriptions.find(
    sub => sub.endpoint === req.body.endpoint
  );
  
  if (!exists) {
    subscriptions.push(req.body);
    console.log(`✅ Total subscriptions: ${subscriptions.length}`);
  }
  
  res.status(201).json({ success: true });
});

/* =========================
   TEST NOTIFICATION ENDPOINT
========================= */
app.post("/test-notification", (req, res) => {
  if (subscriptions.length === 0) {
    return res.json({ success: false, message: "No subscriptions found" });
  }

  console.log(`📤 Sending test notification to ${subscriptions.length} subscribers`);

  const payload = JSON.stringify({
    title: "Test Notification",
    body: "Push notifications are working! 🎉"
  });

  const promises = subscriptions.map((sub, index) => 
    webpush.sendNotification(sub, payload)
      .then(() => console.log(`✅ Notification ${index + 1} sent`))
      .catch(err => {
        console.error(`❌ Failed to send notification ${index + 1}:`, err);
        // Remove invalid subscriptions
        if (err.statusCode === 410 || err.statusCode === 404) {
          subscriptions.splice(subscriptions.indexOf(sub), 1);
        }
      })
  );

  Promise.all(promises)
    .then(() => res.json({ success: true, sent: subscriptions.length }))
    .catch(err => res.json({ success: false, error: err.message }));
});

/* =========================
   RISK ANALYSIS
========================= */
function analyzeRisk(day, history) {
  const risks = [];
  
  console.log(`🔍 Analyzing day: ${day.date}`);
  console.log(`   Steps: ${day.steps} ${day.stepsEstimated ? '(estimated)' : ''}`);
  console.log(`   Heart Rate: ${day.avgHeartRate} ${day.avgHeartRateEstimated ? '(estimated)' : ''}`);
  console.log(`   Calories: ${day.calories}`);
  console.log(`   Sleep Segments: ${day.sleepSegments}`);
  
  // CRITICAL: Only analyze real data, not estimated
  // Steps analysis (only if not estimated)
  if (!day.stepsEstimated) {
    if (day.steps < 200000) {
      risks.push(`⚠️ Critical: Very low activity (${day.steps} steps - recommended: 10,000+)`);
    } else if (day.steps < 2000) {
      risks.push(`⚠️ Low activity level (${day.steps} steps - aim for 5,000+)`);
    } else if (day.steps < 5000) {
      risks.push(`📊 Below recommended activity (${day.steps} steps - target: 10,000)`);
    }
  }
  
  // Heart rate analysis (only if not estimated and has data)
  if (!day.avgHeartRateEstimated && day.avgHeartRate > 0) {
    if (day.avgHeartRate > 110) {
      risks.push(`❤️ High average heart rate (${day.avgHeartRate} bpm - normal: 60-100)`);
    }
    
    if (day.avgHeartRate < 45) {
      risks.push(`❤️ Unusually low heart rate (${day.avgHeartRate} bpm - consult doctor if persistent)`);
    }
  }
  
  // Calories analysis (only if not estimated)
  if (!day.caloriesEstimated) {
    if (day.calories < 1200) {
      risks.push(`🔥 Very low calorie burn (${day.calories} cal - may indicate inactivity)`);
    }
  }
  
  // Sleep analysis
  if (day.sleepSegments === 0) {
    risks.push(`😴 No sleep data detected - tracking may be off`);
  } else if (day.sleepSegments < 2) {
    risks.push(`😴 Minimal sleep recorded (${day.sleepSegments} segments - aim for 7-9 hours)`);
  }

  // Trend analysis - check last 3 days
  if (history.length >= 3) {
    const last3Days = history.slice(-3);
    
    // Only analyze non-estimated data
    const realStepsData = last3Days.filter(d => !d.stepsEstimated);
    if (realStepsData.length >= 2) {
      const avgSteps = realStepsData.reduce((sum, d) => sum + d.steps, 0) / realStepsData.length;
      
      if (avgSteps < 2000) {
        risks.push(`📉 Consistently low activity over ${realStepsData.length} days (avg: ${Math.round(avgSteps)} steps)`);
      } else if (avgSteps < 5000) {
        risks.push(`📊 Below target activity over ${realStepsData.length} days (avg: ${Math.round(avgSteps)} steps)`);
      }
    }
    
    // Check for declining trend
    const realSteps = last3Days.filter(d => !d.stepsEstimated).map(d => d.steps);
    if (realSteps.length >= 3) {
      const isDecreasing = realSteps[0] > realSteps[1] && realSteps[1] > realSteps[2];
      if (isDecreasing && realSteps[2] < 3000) {
        risks.push(`📉 Declining activity trend detected - stay active!`);
      }
    }
  }
  
  // Weekend/sedentary detection
  const dayOfWeek = new Date(day.date).getDay();
  if (!day.stepsEstimated && day.steps < 2000 && (dayOfWeek === 0 || dayOfWeek === 6)) {
    risks.push(`🏠 Weekend sedentary alert - try to stay active on rest days!`);
  }

  console.log(`⚠️ Total risks found: ${risks.length}`);
  if (risks.length > 0) {
    console.log(`   Risks: ${risks.join(' | ')}`);
  }

  return risks;
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
    console.log("✅ OAuth successful");
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
        heartRates.length
          ? Math.round(heartRates.reduce((a, b) => a + b) / heartRates.length)
          : 0;

      const date = new Date(Number(bucket.startTimeMillis))
        .toISOString()
        .split("T")[0];

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

    fillMissingWithAverage(dailyData, "steps");
    fillMissingWithAverage(dailyData, "calories");
    fillMissingWithAverage(dailyData, "avgHeartRate");
    fillMissingWithAverage(dailyData, "sleepSegments");

    const latest = dailyData[dailyData.length - 1];
    const risks = analyzeRisk(latest, dailyData);

    console.log(`🔍 Risk analysis: ${risks.length} risks found`);

    if (risks.length && subscriptions.length > 0) {
      console.log(`📤 Sending health alert to ${subscriptions.length} subscribers`);
      
      const payload = JSON.stringify({
        title: "⚠️ Momentum Health Alert",
        body: risks.join(" • "),
        icon: "/icon.png",
        badge: "/badge.png"
      });

      subscriptions.forEach((sub, index) => {
        webpush.sendNotification(sub, payload)
          .then(() => console.log(`✅ Alert sent to subscriber ${index + 1}`))
          .catch(err => {
            console.error(`❌ Failed to send to subscriber ${index + 1}:`, err.message);
            // Remove invalid subscriptions
            if (err.statusCode === 410 || err.statusCode === 404) {
              subscriptions.splice(subscriptions.indexOf(sub), 1);
            }
          });
      });
    }

    req.session.fitnessData = dailyData;
    res.json(dailyData);

  } catch (err) {
    console.error("Fit API Error:", err.response?.data || err.message);
    res.status(500).send("Fit API error");
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
You are an intelligent AI Fitness Coach and your name is TOM.

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
- Mainly summarize all the matter and give the response in less than 25 words.
- Give each tip in a new line
- After every sentence completion print in next line
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
    res.json({ reply: "AI coach failed. Make sure Ollama is running." });
  }
});

/* =========================
   CLEANUP PAGE
========================= */
app.get("/cleanup", (req, res) => {
  res.sendFile(path.join(__dirname, "cleanup.html"));
});

/* =========================
   HOME
========================= */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "fitbit-login.html"));
});

/* =========================
   START SERVER
========================= */
app.listen(3000, () => {
  console.log("✅ Server running at http://localhost:3000");
  console.log(`📱 VAPID Public Key: ${process.env.VAPID_PUBLIC_KEY}`);
  console.log("💡 Push notifications enabled");
});