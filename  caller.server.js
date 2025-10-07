const WebSocket = require("ws");
const http = require("http");
const url = require("url");

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const clients = new Map(); // userId -> { socket, inCallWith }

function sendTo(userId, messageObj) {
  const client = clients.get(userId);
  if (client && client.socket.readyState === WebSocket.OPEN) {
    client.socket.send(JSON.stringify(messageObj));
  }
}

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
          // Nothing special, just forward
          break;

        case "CALL_ENDED":
          if (caller) caller.inCallWith = null;
          if (callee) callee.inCallWith = null;
          break;

        default:
          // Optional: log unknown types
          console.log(`Unknown message type: ${type}`);
      }

      // Forward message if callee exists
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

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`🚀 Signaling Server running on port ${PORT}`));
