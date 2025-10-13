require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const http = require("http");
const WebSocket = require("ws");
const url = require("url");
const path = require("path");
const axios = require("axios");

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

// --- Helper for consistent logging ---
function logEvent(tag, message, data) {
  const time = new Date().toISOString();
  if (data) console.log(`[${time}] ${tag} ${message}`, data);
  else console.log(`[${time}] ${tag} ${message}`);
}

// --- Helper to send messages safely ---
function sendTo(userId, messageObj) {
  const client = clients.get(userId);
  if (client && client.socket.readyState === WebSocket.OPEN) {
    client.socket.send(JSON.stringify(messageObj));
  } else {
    logEvent("⚠️", `Cannot send to ${userId}, socket not open`);
  }
}

// --- Heartbeat check for detecting dead sockets ---
function heartbeat() {
  this.isAlive = true;
}

// --- WebSocket logic ---
wss.on("connection", (socket, req) => {
  const params = new URLSearchParams(url.parse(req.url).query);
  const userId = params.get("userId");

  if (!userId) {
    logEvent("❌", "Connection rejected: missing userId");
    socket.close(1008, "Missing userId");
    return;
  }

  if (clients.has(userId)) {
    logEvent("♻️", `User ${userId} reconnected, replacing old connection.`);
    const oldSocket = clients.get(userId).socket;
    try {
      oldSocket.terminate();
    } catch (e) {
      logEvent("⚠️", `Error terminating old socket for ${userId}: ${e.message}`);
    }
  }

  socket.isAlive = true;
  socket.on("pong", heartbeat);
  clients.set(userId, { socket, inCallWith: null });

  logEvent("✅", `User connected: ${userId}`);

  // --- Incoming messages ---
  socket.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg);
      const type = (data.type || "").toUpperCase();
      const targetId = data.targetUserId;

      logEvent("📨", `Message from ${userId}`, { type, targetId, data });

      const caller = clients.get(userId);
      const callee = clients.get(targetId);

      if (!targetId) {
        logEvent("⚠️", `No targetUserId in message from ${userId}`);
        return;
      }

      switch (type) {
        // --- WebRTC core signaling ---
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
          break;

        case "CALL_ENDED":
          logEvent("📞", `Call ended by ${userId}`);
          if (caller) caller.inCallWith = null;
          if (callee) callee.inCallWith = null;
          break;

        // --- Call request ---
        case "CALL_REQUEST":
          logEvent("📞", `Call request from ${userId} to ${targetId}`, { isVideo: data.isVideo });

          if (callee) {
            logEvent("🟢", `${targetId} is online — sending call request via WebSocket`);
            sendTo(targetId, {
              type: "CALL_REQUEST",
              fromUserId: userId,
              isVideo: data.isVideo || false,
            });
          } else {
            logEvent("📴", `${targetId} is offline — sending OneSignal push`);
            sendTo(userId, { type: "USER_BUSY", targetUserId: targetId });

            try {
              const payload = {
                app_id: process.env.ONESIGNAL_APP_ID,
                include_external_user_ids: [targetId],
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

              logEvent("📨", "OneSignal push sent successfully", res.data);
            } catch (err) {
              logEvent("❌", "OneSignal push failed", err.response?.data || err.message);
            }
          }
          return;

        // --- Call accepted ---
        case "CALL_ACCEPT":
          logEvent("✅", `${userId} accepted call from ${targetId}`);
          if (callee) {
            sendTo(targetId, { type: "CALL_ACCEPT", fromUserId: userId });
          }
          return;

        // --- Call rejected ---
        case "CALL_REJECT":
          logEvent("🚫", `${userId} rejected call from ${targetId}`);
          if (callee) {
            sendTo(targetId, { type: "CALL_REJECT", fromUserId: userId });
          }
          return;

        default:
          logEvent("⚠️", `Unknown message type from ${userId}: ${type}`);
      }

      // Forward signaling messages
      if (callee) {
        sendTo(targetId, { ...data, fromUserId: userId });
      }
    } catch (err) {
      logEvent("❌", `Error parsing or forwarding message from ${userId}: ${err.message}`);
      socket.send(JSON.stringify({ type: "ERROR", message: err.message }));
    }
  });

  // --- Handle WebSocket errors ---
  socket.on("error", (err) => {
    logEvent("💥", `WebSocket error for ${userId}: ${err.message}`);
  });

  // --- Handle disconnects ---
  socket.on("close", (code, reason) => {
    const reasonStr = reason?.toString() || "No reason";
    logEvent("❌", `User disconnected: ${userId} | Code: ${code} | Reason: ${reasonStr}`);

    const callPartner = clients.get(userId)?.inCallWith;
    if (callPartner) {
      sendTo(callPartner, { type: "USER_LEFT", fromUserId: userId });
      const partner = clients.get(callPartner);
      if (partner) partner.inCallWith = null;
    }

    clients.delete(userId);

    // Decode WebSocket close codes for clarity
    switch (code) {
      case 1000:
        logEvent("ℹ️", `${userId} normal closure`);
        break;
      case 1001:
        logEvent("📱", `${userId} closed app or navigated away`);
        break;
      case 1006:
        logEvent("⚠️", `${userId} abnormal disconnect (network loss?)`);
        break;
      default:
        logEvent("🌀", `${userId} disconnected with code ${code}`);
    }
  });
});

// --- Ping clients periodically to detect dead connections ---
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      logEvent("💀", "Terminating dead socket");
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on("close", () => clearInterval(interval));

// --- Start server ---
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => logEvent("🚀", `Server running on port ${PORT}`));
