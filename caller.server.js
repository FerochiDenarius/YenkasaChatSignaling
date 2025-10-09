// caller.server.js
require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const http = require("http");
const WebSocket = require("ws");
const url = require("url");
const path = require("path");
const axios = require("axios"); // ✅ for OneSignal requests

// --- Create Express app for API routes ---
const app = express();
app.use(bodyParser.json());

// --- Mount Daily.co routes ---
const dailycoRoutes = require("./routes/dailyco.routes.js");
app.use("/api/dailyco", dailycoRoutes);

// --- Create HTTP server for WebSocket + Express ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Map(); // userId -> { socket, inCallWith }

// Helper to send messages to a specific user
function sendTo(userId, messageObj) {
  const client = clients.get(userId);
  if (client && client.socket.readyState === WebSocket.OPEN) {
    client.socket.send(JSON.stringify(messageObj));
  }
}

// --- WebSocket logic ---
wss.on("connection", (socket, req) => {
  const params = new URLSearchParams(url.parse(req.url).query);
  const userId = params.get("userId");

  if (!userId) {
    socket.close(1008, "Missing userId");
    return;
  }

  if (clients.has(userId)) {
    console.log(`User ${userId} reconnected, replacing old connection.`);
    clients.get(userId).socket.close();
  }

  clients.set(userId, { socket, inCallWith: null });
  console.log(`✅ User connected: ${userId}`);

  // --- Handle incoming messages ---
  socket.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg);
      const type = (data.type || "").toUpperCase();
      const targetId = data.targetUserId;
      const caller = clients.get(userId);
      const callee = clients.get(targetId);

      if (!targetId) return;

      switch (type) {
        // WebRTC Signaling messages
        case "OFFER":
          if (callee?.inCallWith && callee.inCallWith !== userId) {
            sendTo(userId, { type: "USER_BUSY", fromUserId: targetId });
            return;
          }
          caller.inCallWith = targetId;
          if (callee) callee.inCallWith = userId;
          break;

        case "ANSWER":
        case "CANDIDATE":
          // Forward directly
          break;

        case "CALL_ENDED":
          if (caller) caller.inCallWith = null;
          if (callee) callee.inCallWith = null;
          break;

        // --- 📞 New signaling for call request ---
        case "CALL_REQUEST":
          console.log(`📞 Call request from ${userId} to ${targetId}`);

          if (callee) {
            // Receiver is online (connected via WebSocket)
            sendTo(targetId, {
              type: "CALL_REQUEST",
              fromUserId: userId,
              isVideo: data.isVideo || false,
            });
          } else {
            // Receiver is offline → trigger OneSignal push notification
            console.log(`📴 ${targetId} is offline. Sending OneSignal push...`);

            // Notify caller user that receiver is busy/offline
            sendTo(userId, {
              type: "USER_BUSY",
              targetUserId: targetId,
            });

            // 🔔 Send OneSignal push
            try {
              const payload = {
                app_id: process.env.ONESIGNAL_APP_ID,
                include_external_user_ids: [targetId], // assuming userId = OneSignal external ID
                headings: { en: "Incoming Call" },
                contents: { en: `User ${userId} is calling you.` },
                data: {
                  type: "call_request",
                  fromUserId: userId,
                  isVideo: data.isVideo || false,
                },
                android_channel_id: process.env.ONESIGNAL_CHANNEL_ID || null,
              };

              const res = await axios.post(
                "https://api.onesignal.com/notifications",
                payload,
                {
                  headers: {
                    "Authorization": `Basic ${process.env.yenkasachatOneSignalKey}`,
                    "Content-Type": "application/json",
                  },
                }
              );

              console.log("📨 OneSignal push sent:", res.data.id);
            } catch (err) {
              console.error("❌ OneSignal push failed:", err.message);
            }
          }
          return; // stop further forwarding

        // --- ✅ Call accepted ---
        case "CALL_ACCEPT":
          console.log(`✅ ${userId} accepted call from ${targetId}`);
          if (callee) {
            sendTo(targetId, {
              type: "CALL_ACCEPT",
              fromUserId: userId,
            });
          }
          return;

        // --- ❌ Call rejected ---
        case "CALL_REJECT":
          console.log(`❌ ${userId} rejected call from ${targetId}`);
          if (callee) {
            sendTo(targetId, {
              type: "CALL_REJECT",
              fromUserId: userId,
            });
          }
          return;

        default:
          console.log(`⚠️ Unknown message type: ${type}`);
      }

      // Forward all other known signaling messages (offer, answer, candidate)
      if (callee) {
        sendTo(targetId, { ...data, fromUserId: userId });
      }

    } catch (err) {
      console.error("❌ Error parsing message:", err);
      socket.send(JSON.stringify({ type: "ERROR", message: err.message }));
    }
  });

  // --- Handle disconnects ---
  socket.on("close", () => {
    console.log(`❌ User disconnected: ${userId}`);
    const callPartner = clients.get(userId)?.inCallWith;
    if (callPartner) {
      sendTo(callPartner, { type: "USER_LEFT", fromUserId: userId });
      const partner = clients.get(callPartner);
      if (partner) partner.inCallWith = null;
    }
    clients.delete(userId);
  });
});

// --- Start server ---
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
