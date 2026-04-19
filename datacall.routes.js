const express = require("express");

const router = express.Router();

// Data-call routes are intentionally separate from Daily.co video-call routes.
// Keep room creation and meeting-token generation in routes/dailyco.routes.js.
router.get("/test", (req, res) => {
  res.json({
    status: "Data call route is active",
    service: "datacall",
  });
});

router.post("/ping", (req, res) => {
  const { fromUserId, targetUserId } = req.body || {};

  if (!fromUserId || !targetUserId) {
    return res.status(400).json({
      success: false,
      message: "fromUserId and targetUserId are required",
    });
  }

  return res.json({
    success: true,
    type: "DATA_CALL_PING",
    fromUserId,
    targetUserId,
    receivedAt: new Date().toISOString(),
  });
});

module.exports = router;
