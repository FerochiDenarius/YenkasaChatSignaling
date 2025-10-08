const express = require("express");
const axios = require("axios");
const router = express.Router();

const DAILY_API_KEY = process.env.DAILY_API_KEY; // Add this to your .env

// Create a new Daily.co room
router.post("/create-room", async (req, res) => {
  try {
    const roomName = req.body.roomName || `room-${Date.now()}`;
    const response = await axios.post(
      "https://api.daily.co/v1/rooms",
      { name: roomName },
      { headers: { Authorization: `Bearer ${DAILY_API_KEY}` } }
    );
    res.json({ roomName: response.data.name, roomUrl: response.data.url });
  } catch (err) {
    console.error("Create room error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to create room" });
  }
});

// Generate a meeting token for a user
router.post("/generate-token", async (req, res) => {
  try {
    const { roomName, userId } = req.body;
    if (!roomName || !userId) return res.status(400).json({ error: "Missing roomName or userId" });

    const response = await axios.post(
      "https://api.daily.co/v1/meeting-tokens",
      {
        properties: {
          room_name: roomName,
          is_owner: false, // true if this user should be host
          user_name: userId
        }
      },
      { headers: { Authorization: `Bearer ${DAILY_API_KEY}` } }
    );

    res.json({ token: response.data.token, roomName });
  } catch (err) {
    console.error("Generate token error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to generate token" });
  }
});

module.exports = router;
