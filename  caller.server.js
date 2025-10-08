// caller.server.js
const express = require("express");
const bodyParser = require("body-parser");
const http = require("http");
const WebSocket = require("ws");
const url = require("url");
const path = require("path");

// --- Create Express app for API routes ---
const app = express();
app.use(bodyParser.json());

// Mount Daily.co routes
const dailycoRoutes = require("./routes/dailyco.routes.js");
app.use("/api/dailyco", dailycoRoutes);

// --- Create HTTP server for WebSocket and Express ---
const server = http.createServer(app); // Attach Express app
const wss = new WebSocket.Server({ server });

const clients = new Map(); // userId -> { socket, inCallWith }

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

  socket.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      const type = (data.type || "").toUpperCase();
      const targetId = data.targetUserId;

      if (!targetId) return;

      const caller = clients.get(userId);
      const callee = clients.get(targetId);

      switch (type) {
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
          // Forward handled below
          break;

        case "CALL_ENDED":
          if (caller) caller.inCallWith = null;
          if (callee) callee.inCallWith = null;
          break;

        default:
          console.log(`Unknown message type: ${type}`);
      }

      // Forward signaling message if callee exists
      if (callee) {
        sendTo(targetId, { ...data, fromUserId: userId });
      }

    } catch (err) {
      console.error("Error parsing message:", err);
      socket.send(JSON.stringify({ type: "ERROR", message: err.message }));
    }
  });

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
