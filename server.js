const express = require("express");
const { exec } = require("child_process");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    // origin: "http://0.0.0.0:5173", // Allow requests only from this frontend origin
    methods: ["GET", "POST"], // Allow GET and POST requests
    allowedHeaders: ["my-custom-header"], // Optional, if you have specific headers to allow
    credentials: true, // Allow credentials (cookies, authorization headers, etc.)
  },
});

app.use(cors());
app.use(express.static("public")); // Serves index.html, etc.

// app.post("/play-song", (req, res) => {
//   console.log("/play-song was called");
//   const { songId } = req.body;

//   if (!songId) {
//     return res.status(400).json({ error: "Missing songId" });
//   }

//   // Execute the Python script to play the song
//   const command = `python3 scripts/play_song.py ${songId}`;
//   exec(command, (error, stdout, stderr) => {
//     if (error) {
//       console.error(`Error executing play_song.py: ${error.message}`);
//       return res.status(500).json({ error: "Failed to play song." });
//     }

//     console.log(`play_song.py output: ${stdout}`);
//     res.status(200).json({ message: `Playing song ${songId}` });
//   });
// });

/**
 * In-memory store for games, keyed by 6-digit PIN.
 *
 * games[pin] = {
 *   hostSocketId: string,
 *   players: {
 *     [socketId]: { name: string, score: number }
 *   },
 *   isStarted: boolean,
 *   songId: string,
 *   songDurationSec: number,
 *   startTime: number
 * }
 */
const games = {};

function generateGamePin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  // Host creates a new game
  socket.on("hostCreateGame", () => {
    const pin = generateGamePin();
    games[pin] = {
      hostSocketId: socket.id,
      players: {},
      isStarted: false,
      songId: null,
      songDurationSec: 0,
      startTime: null,
    };

    socket.join(pin);
    socket.emit("gameCreated", { pin });
  });

  // Player joins a game
  socket.on("playerJoinGame", ({ pin, playerName }) => {
    const game = games[pin];
    if (!game || game.isStarted) {
      socket.emit("playerJoinError", "Game not found or already started.");
      return;
    }

    game.players[socket.id] = { name: playerName, score: 0 };
    socket.join(pin);

    socket.emit("playerJoinedSuccess", { pin, playerName });

    io.to(game.hostSocketId).emit("updatePlayerList", {
      players: Object.values(game.players),
    });
  });

  // Host starts the game (3-sec countdown, etc.)
  socket.on("hostStartGame", ({ pin, songId, songDurationSec }) => {
    const game = games[pin];
    if (!game || game.isStarted) return;

    game.isStarted = true;
    game.songId = songId;
    game.songDurationSec = songDurationSec;

    // 1) 3-second countdown
    io.in(pin).emit("countdownStart", { countdownSeconds: 3 });

    // 2) After 3 seconds, start recording and play song
    setTimeout(() => {
      game.startTime = Date.now();

      // play song
      exec(
        `python3 scripts/play_song.py ${songId}`,
        (error, stdout, stderr) => {
          if (error) {
            console.error(`Error playing song: ${error.message}`);
            io.to(game.hostSocketId).emit("playbackError", {
              message: "Failed to play song.",
            });
            return;
          }
          console.log(`Song playback output: ${stdout}`);
        }
      );

      // Emit events to all players: song starts and recording begins
      // io.in(pin).emit("playSong", { songId });
      io.in(pin).emit("startRecording", { songId });

      io.to(game.hostSocketId).emit("songStart", {
        durationSec: songDurationSec,
        startedAt: game.startTime,
      });

      // Stop recording after `songDurationSec`
      setTimeout(() => {
        io.in(pin).emit("stopRecording");
        setTimeout(() => endGame(pin), 2000);
      }, songDurationSec * 1000);
    }, 3000);
  });

  // Player sends score
  socket.on("playerSendScore", ({ pin, score }) => {
    const game = games[pin];
    if (!game) return;
    if (game.players[socket.id]) {
      game.players[socket.id].score += score;
    }
  });

  // Host play again button is pressed
  socket.on("hostPlayAgain", ({ pin }) => {
    const game = games[pin];
    if (!game) return;

    // Reset the game state so we can start a new round:
    game.isStarted = false;
    game.songId = null;
    game.songDurationSec = 0;
    game.startTime = null;

    // We keep the players and their scores – do NOT clear game.players

    // Tell only the host (or everyone) that the game can be reset:
    io.in(pin).emit("gameReset");
  });

  // Disconnect cleanup
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    for (const pin in games) {
      const game = games[pin];
      if (!game) continue;

      // If host left
      if (game.hostSocketId === socket.id) {
        io.in(pin).emit("gameOver");
        delete games[pin];
        break;
      }

      // If player left
      if (game.players[socket.id]) {
        delete game.players[socket.id];
        if (!game.isStarted) {
          io.to(game.hostSocketId).emit("updatePlayerList", {
            players: Object.values(game.players),
          });
        }
      }
    }
  });

  function endGame(pin) {
    const game = games[pin];
    if (!game) return;

    const leaderboard = Object.values(game.players)
      .sort((a, b) => b.score - a.score)
      .map((p, idx) => ({ rank: idx + 1, name: p.name, score: p.score }));

    io.in(pin).emit("gameOver");
    io.to(game.hostSocketId).emit("showLeaderboard", leaderboard);

    // Also update the host’s player list so the Song Selection screen sees the new totals
    io.to(game.hostSocketId).emit("updatePlayerList", {
      players: Object.values(game.players),
    });
  }
});

const PORT = process.env.PORT || 3000;
const SERVER = "0.0.0.0";
server.listen(PORT, SERVER, () => {
  console.log("Server running on port " + PORT);
});
