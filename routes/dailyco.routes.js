// routes/dailyco.routes.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const router = express.Router();

// === Environment Variables ===
const DAILY_API_KEY = process.env.DAILY_API_KEY;

// === Helper: Safe Logging for API Keys ===
function safeKey(key) {
  if (!key) return "undefined";
  return key.length > 10 ? `${key.slice(0, 6)}...${key.slice(-4)}` : key;
}

// === Health Check ===
router.get("/test", (req, res) => {
  console.log("🧩 [DailyCo] /test route hit!");
  res.json({
    status: "✅ DailyCo route is active",
    apiKeyLoaded: !!DAILY_API_KEY,
  });
});

// === Create Daily Room ===
router.post("/create-room", async (req, res) => {
  try {
    console.log("📞 [DailyCo] Create Room Request:", req.body);
    console.log("🔑 [DailyCo] API Key Loaded:", safeKey(DAILY_API_KEY));

    if (!DAILY_API_KEY) {
      console.error("❌ DAILY_API_KEY missing from environment!");
      return res
        .status(500)
        .json({ error: "Server misconfiguration: DAILY_API_KEY missing" });
    }

    const roomName = req.body.roomName || `room-${Date.now()}`;
    console.log("📞 [DailyCo] Creating Room:", roomName);

    const response = await axios.post(
      "https://api.daily.co/v1/rooms",
      { name: roomName },
      { headers: { Authorization: `Bearer ${DAILY_API_KEY}` } }
    );

    console.log("✅ [DailyCo] Room Created:", response.data.name);
    res.json({
      roomName: response.data.name,
      roomUrl: response.data.url,
    });
  } catch (err) {
    console.error(
      "🔥 [DailyCo] Create Room Error:",
      err.response?.data || err.message
    );
    res.status(500).json({
      error: "Failed to create room",
      details: err.response?.data || err.message,
    });
  }
});

// === Generate Daily Meeting Token ===
router.post("/generate-token", async (req, res) => {
  try {
    console.log("🎟 [DailyCo] Generate Token Request:", req.body);
    console.log("🔑 [DailyCo] API Key Loaded:", safeKey(DAILY_API_KEY));

    const { roomName, _id } = req.body; // 🟩 Use _id instead of userId for consistency
    if (!roomName || !_id) {
      console.error("❌ Missing roomName or _id in request:", req.body);
      return res.status(400).json({
        error: "Missing roomName or _id",
      });
    }

    const response = await axios.post(
      "https://api.daily.co/v1/meeting-tokens",
      {
        properties: {
          room_name: roomName,
          is_owner: false,
          user_name: _id, // 🟩 matches your Android model naming
        },
      },
      { headers: { Authorization: `Bearer ${DAILY_API_KEY}` } }
    );

    console.log("✅ [DailyCo] Token Generated for:", _id);
    res.json({
      token: response.data.token,
      roomName,
    });
  } catch (err) {
    console.error(
      "🔥 [DailyCo] Generate Token Error:",
      err.response?.data || err.message
    );
    res.status(500).json({
      error: "Failed to generate token",
      details: err.response?.data || err.message,
    });
  }
});

module.exports = router;
