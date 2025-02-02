const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { spawn } = require("child_process");
var path = require('path');
const fs = require("fs");


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

    // 2) After 3 seconds, start recording
    setTimeout(() => {
      game.startTime = Date.now();
      io.in(pin).emit("startRecording", { songId });
      io.to(game.hostSocketId).emit("songStart", {
        durationSec: songDurationSec,
        startedAt: game.startTime,
      });

      // 3) Stop recording after `songDurationSec`
      setTimeout(() => {
        io.in(pin).emit("stopRecording");

        // wait 2 seconds for scores
        setTimeout(() => endGame(pin), 2000);
      }, songDurationSec * 1000);
    }, 3000);
  });

  const ref_audios = {
    "imjustken": "assets/reference_vocals/ImJustKen_Vocal.wav",
    "imjustken_cut": "assets/reference_vocals/cutijk.wav"
  };
  

  // New event: Handle running the Python script for scoring
socket.on("runScoringScript", ({ pin, audioData }) => {
  const game = games[pin];
  if (!game) return;

  // setup
  const { songId } = game; 
  const refFilename = ref_audios[songId];
  if (!refFilename) {
    console.error(`No reference audio mapped for songId: ${songId}`);
    return;
  }
  const referencePath = refFilename;
  const performancePath = path.join(__dirname, "temp", `perf_${Date.now()}_${socket.id}.ogg`);

  // Save the performance audio to a file
  // try {
  //   // fs.writeFileSync(performancePath, Buffer.from(audioData));
  //   fs.writeFile(performancePath, Buffer.from(audioData));
  // } catch (err) {
  //   console.error("Failed to write performance audio file:", err);
  //   return;
  // }
  fs.writeFile(performancePath, Buffer.from(audioData), (err) => {
    if (err) {
      console.error("Error saving audio file:", err);
      socket.emit("fileSaved", { success: false, error: err.toString() });
    } else {
      console.log("Audio file saved:", performancePath);
      
      // If you need to run further scoring logic here, do it now.
      // E.g., call a Python script or do your Node-based processing.

      // socket.emit("fileSaved", { success: true, filePath });
    }
  });

  // Spawn the Python script
  const pythonProcess = spawn("python3", [
    "scripts/scoring.py",
    referencePath,
    performancePath
  ]);

  // Send the audio data to the Python process
  // pythonProcess.stdin.write(Buffer.from(audioData));
  // pythonProcess.stdin.end();

  let score = 0;
  pythonProcess.stderr.on("data", (data) => {
    score = parseInt(data.toString().trim(), 10);
  });
  pythonProcess.stdout.on("data", (data) => {
    console.log("Python output: %s", data)
  });

  pythonProcess.on("close", (code) => {
    if (code !== 0) {
      console.error(`Python script exited with code ${code}`);
      return;
    }

    // Emit the score back to the player
    if (game.players[socket.id]) {
      game.players[socket.id].score += score;
    }

    socket.emit("playerSendScore", { pin, score });
  });

  pythonProcess.stderr.on("data", (data) => {
    console.error("Python script error:", data.toString());
  });
});

  // Player sends score
  socket.on("playerSendScore", ({ pin, score }) => {
    const game = games[pin];
    if (!game) return;
    // if (game.players[socket.id]) {
      // game.players[socket.id].score += score;
    // }
    // TODO score is incremented twice
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
