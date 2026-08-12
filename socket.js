import { io } from "socket.io-client";

const socket = io("https://bingoback.bingoogame.com", {
  transports: ["websocket"],
  upgrade:         false,
  reconnection:    true,
  reconnectionDelay:      1000,
  reconnectionAttempts:   5,
  timeout:         10000,
});

export default socket;
