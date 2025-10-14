require("dotenv").config();
const express = require("express");
const axios = require("axios");
const router = express.Router();

// === Environment Variables ===
const DAILY_API_KEY = process.env.DAILY_API_KEY;
const DAILY_DOMAIN = process.env.DAILY_DOMAIN || "https://your-daily-domain.daily.co"; // 🔧 replace or set in .env

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
    dailyDomain: DAILY_DOMAIN,
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
    console.log(`📞 [DailyCo] Attempting to create room: ${roomName}`);

    try {
      // Try creating a new Daily room
      const response = await axios.post(
        "https://api.daily.co/v1/rooms",
        { name: roomName },
        { headers: { Authorization: `Bearer ${DAILY_API_KEY}` } }
      );

      console.log("✅ [DailyCo] Room Created:", response.data.name);
      return res.json({
        roomName: response.data.name,
        roomUrl: response.data.url,
      });
    } catch (err) {
      const info = err.response?.data?.info;
      const code = err.response?.data?.error;

      // ✅ If room already exists, reuse it
      if (
        (code === "invalid-request-error" &&
          info?.includes("already exists")) ||
        info?.includes("exists")
      ) {
        console.warn("♻️ [DailyCo] Room already exists — reusing existing room:", roomName);
        return res.json({
          roomName,
          roomUrl: `${DAILY_DOMAIN.replace(/\/$/, "")}/${roomName}`,
        });
      }

      // ❌ Other errors
      console.error("🔥 [DailyCo] Create Room Error:", err.response?.data || err.message);
      return res.status(500).json({
        error: "Failed to create room",
        details: err.response?.data || err.message,
      });
    }
  } catch (err) {
    console.error("🔥 [DailyCo] Unexpected Error:", err.message);
    res.status(500).json({ error: "Unexpected server error", details: err.message });
  }
});

// === Generate Daily Meeting Token ===
router.post("/generate-token", async (req, res) => {
  try {
    console.log("🎟 [DailyCo] Generate Token Request:", req.body);
    console.log("🔑 [DailyCo] API Key Loaded:", safeKey(DAILY_API_KEY));

    const { roomName, _id } = req.body;
    if (!roomName || !_id) {
      console.error("❌ Missing roomName or _id in request:", req.body);
      return res.status(400).json({ error: "Missing roomName or _id" });
    }

    const response = await axios.post(
      "https://api.daily.co/v1/meeting-tokens",
      {
        properties: {
          room_name: roomName,
          is_owner: false,
          user_name: _id,
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
    console.error("🔥 [DailyCo] Generate Token Error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to generate token",
      details: err.response?.data || err.message,
    });
  }
});

module.exports = router;
