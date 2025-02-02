import { io } from "socket.io-client";

// Change this to your server’s address if needed
const SERVER_URL = "http://127.0.0.1:3000";

export const socket = io(SERVER_URL, {
  // options if needed
});
