// routes/dailyco.routes.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const router = express.Router();

// ✅ Load Daily API Key from environment
const DAILY_API_KEY = process.env.DAILY_API_KEY;

// Helper to hide sensitive keys in logs
function safeKey(key) {
  if (!key) return "undefined";
  return key.length > 10 ? `${key.slice(0, 6)}...${key.slice(-4)}` : key;
}

// ✅ Health-check route (for testing)
router.get("/test", (req, res) => {
  console.log("🧩 [DailyCo] /test route hit!");
  res.json({ message: "✅ DailyCo route is active", apiKeyLoaded: !!DAILY_API_KEY });
});

// ✅ Create a new Daily.co room
router.post("/create-room", async (req, res) => {
  try {
    console.log("📞 [DailyCo] /create-room called with body:", req.body);
    console.log("📞 [DailyCo] Using DAILY_API_KEY:", safeKey(DAILY_API_KEY));

    if (!DAILY_API_KEY) {
      console.error("❌ DAILY_API_KEY missing in environment variables!");
      return res.status(500).json({
        error: "Server misconfiguration: DAILY_API_KEY missing",
      });
    }

    const roomName = req.body.roomName || `room-${Date.now()}`;
    console.log("📞 [DailyCo] Creating room:", roomName);

    const response = await axios.post(
      "https://api.daily.co/v1/rooms",
      { name: roomName },
      { headers: { Authorization: `Bearer ${DAILY_API_KEY}` } }
    );

    console.log("✅ [DailyCo] Room created successfully:", response.data);
    res.json({ roomName: response.data.name, roomUrl: response.data.url });
  } catch (err) {
    console.error("🔥 [DailyCo] Create room error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create room",
      details: err.response?.data || err.message,
    });
  }
});

// ✅ Generate a meeting token for a user
router.post("/generate-token", async (req, res) => {
  try {
    console.log("🎟 [DailyCo] /generate-token called with body:", req.body);
    console.log("🎟 [DailyCo] Using DAILY_API_KEY:", safeKey(DAILY_API_KEY));

    const { roomName, userId } = req.body;
    if (!roomName || !userId) {
      console.error("❌ Missing roomName or userId:", req.body);
      return res.status(400).json({ error: "Missing roomName or userId" });
    }

    const response = await axios.post(
      "https://api.daily.co/v1/meeting-tokens",
      {
        properties: {
          room_name: roomName,
          is_owner: false,
          user_name: userId,
        },
      },
      { headers: { Authorization: `Bearer ${DAILY_API_KEY}` } }
    );

    console.log("✅ [DailyCo] Token generated successfully for user:", userId);
    res.json({ token: response.data.token, roomName });
  } catch (err) {
    console.error("🔥 [DailyCo] Generate token error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to generate token",
      details: err.response?.data || err.message,
    });
  }
});

module.exports = router;
