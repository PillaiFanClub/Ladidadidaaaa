const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

// Use play-sound
const player = require("play-sound")(); // This defaults to searching for 'afplay', 'mplayer', or 'mpg123' etc.

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.use(cors());
app.use(express.static("public"));

// If you also want to serve files (optional):
app.use(
  "/assets",
  express.static(path.join(__dirname, "Ladidadidaaaa", "assets"))
);

// **Map** to your .wav files (on disk) for the server to play:
const songMap = {
  diewithasmile: {
    instrumentals: path.join(__dirname, "Ladidadidaaaa", "assets", "reference_instrumental", "DieWithASmile_Instrumental.wav"),
    vocals: path.join(__dirname, "Ladidadidaaaa", "assets", "reference_vocals", "DieWithASmile_Vocal.wav"),
  },
  dancingqueen: {
    instrumentals: path.join(__dirname, "Ladidadidaaaa", "assets", "reference_instrumental", "DancingQueen_Instrumental.wav"),
    vocals: path.join(__dirname, "Ladidadidaaaa", "assets", "reference_vocals", "DancingQueen_Vocal.wav"),
  },
  imjustken: {
    instrumentals: path.join(__dirname, "Ladidadidaaaa", "assets", "reference_instrumental", "ImJustKen_Instrumental.wav"),
    vocals: path.join(__dirname, "Ladidadidaaaa", "assets", "reference_vocals", "ImJustKen_Vocal.wav"),
  },
};

// In-memory store for games
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
      currentAudio: null, // We'll store the audio process here if we want to stop/kill it
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

  // Host starts the game
  socket.on("hostStartGame", ({ pin, songId, songDurationSec }) => {
    const game = games[pin];
    if (!game || game.isStarted) return;

    game.isStarted = true;
    game.songId = songId;
    game.songDurationSec = songDurationSec;

    const songData = songMap[songId];
    if (!songData) {
      console.error(`Song ID "${songId}" not found in songMap`);
      return;
    }
    console.log(songData.instrumentals);
    // 1) Notify clients of 3-second countdown
    io.in(pin).emit("countdownStart", { countdownSeconds: 3 });

    // 2) After 3 seconds, start playback (on the SERVER) and notify clients
    setTimeout(() => {
      game.startTime = Date.now();

      
      // Play the audio on the server machine:
      const audioProcess = player.play(songData.instrumentals, (err) => {
        if (err) console.error("Error playing audio:", err);
      });
      // Store reference so we can stop it if needed
      game.currentAudio = audioProcess;

      // Let clients know the track started and they should start recording
      io.in(pin).emit("startRecording", { songId });

      io.to(game.hostSocketId).emit("songStart", {
        durationSec: songDurationSec,
        startedAt: game.startTime,
      });

      // 3) Stop after `songDurationSec`
      setTimeout(() => {
        // Stop the audio if it's still running
        if (game.currentAudio && typeof game.currentAudio.kill === "function") {
          game.currentAudio.kill();
        }

        io.in(pin).emit("stopRecording");

        // wait 2 seconds for any final scores, then end game
        setTimeout(() => endGame(pin), 2000);
      }, songDurationSec * 1000);

    }, 3000); // End of setTimeout for the countdown
  });

  // Player sends score
  socket.on("playerSendScore", ({ pin, score }) => {
    const game = games[pin];
    if (!game) return;

    if (game.players[socket.id]) {
      game.players[socket.id].score += score;
    }
  });

  // Host Play Again
  socket.on("hostPlayAgain", ({ pin }) => {
    const game = games[pin];
    if (!game) return;

    // Reset for a new round, but keep players
    game.isStarted = false;
    game.songId = null;
    game.songDurationSec = 0;
    game.startTime = null;

    io.in(pin).emit("gameReset");
  });

  // Cleanup on disconnect
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    for (const pin in games) {
      const game = games[pin];
      if (!game) continue;

      // If host left
      if (game.hostSocketId === socket.id) {
        // Stop audio if playing
        if (game.currentAudio && typeof game.currentAudio.kill === "function") {
          game.currentAudio.kill();
        }
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

  // Helper function to end the game
  function endGame(pin) {
    const game = games[pin];
    if (!game) return;

    const leaderboard = Object.values(game.players)
      .sort((a, b) => b.score - a.score)
      .map((p, idx) => ({ rank: idx + 1, name: p.name, score: p.score }));

    io.in(pin).emit("gameOver");
    io.to(game.hostSocketId).emit("showLeaderboard", leaderboard);

    // Update the host’s player list
    io.to(game.hostSocketId).emit("updatePlayerList", {
      players: Object.values(game.players),
    });
  }
});

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
