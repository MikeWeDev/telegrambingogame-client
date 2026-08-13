import { io } from "socket.io-client";

const BACKEND_URL = import.meta.env.BACKEND_URL || "https://telegrambingogame-server.onrender.com";

const socket = io(BACKEND_URL, {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 10,
  timeout: 10000,
});

export default socket;