import React, { useRef, useState, useEffect } from "react";
import { socket } from "./socket";
import Host from "./components/Host";
import Player from "./components/Player";
import Leaderboard from "./components/Leaderboard";
import "./styles.css";
import "./App.css";
// const Process = require("child_process").spawn;
// const { exec } = require("child_process");


function Lyrics({ lyrics, songTimeLeft, songDuration }) {
  // Only show lyrics while the song is playing
  if (!songTimeLeft) return null;

  const [currentLineIndex, setCurrentLineIndex] = useState(-1);

  // Calculate how many seconds have elapsed
  const elapsedTime = songDuration - songTimeLeft;

  useEffect(() => {
    let newIndex = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].time <= elapsedTime) {
        newIndex = i;
      } else {
        break;
      }
    }
    setCurrentLineIndex(newIndex);
  }, [elapsedTime, lyrics]);

  if (currentLineIndex < 0) {
    return null; // No lyric line has started yet
  }

  const prevLyric =
    currentLineIndex > 0 ? lyrics[currentLineIndex - 1]?.lyric : null;
  const currentLyric = lyrics[currentLineIndex]?.lyric || "";
  const nextLyric = lyrics[currentLineIndex + 1]?.lyric || null;

  return (
    <div className="lyrics-container">
      <h3>Lyrics</h3>
      {prevLyric && (
        <div className="adjacent-lyric prev-lyric">{prevLyric}</div>
      )}
      <div className="current-lyric">{currentLyric}</div>
      {nextLyric && (
        <div className="adjacent-lyric next-lyric">{nextLyric}</div>
      )}
    </div>
  );
}

export default function App() {
  // Role can be "host", "player", or null before selection
  const [role, setRole] = useState(null);
  const [gameOver, setGameOver] = useState(false);

  // Host states
  const [hostPin, setHostPin] = useState("");
  const [players, setPlayers] = useState([]);
  const [songId, setSongId] = useState("");
  const [lyrics, setLyrics] = useState([]);
  const [songDuration, setSongDuration] = useState(0);
  const [songTimeLeft, setSongTimeLeft] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);

  // Player states
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [joinError, setJoinError] = useState("");
  const [playerJoined, setPlayerJoined] = useState(false);
  const [playerStatus, setPlayerStatus] = useState("");

  // recording state
  const [isRecording, setIsRecording] = useState(false);

  // Fetch lyrics dynamically whenever the selected song changes
  useEffect(() => {
    if (!songId) return;

    // Attempt to load a local JSON file named "[songId].json"
    fetch(`${songId}.json`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch ${songId}.json`);
        }
        return res.json();
      })
      .then((data) => {
        setLyrics(data || []);
        // Example: give ourselves 10 seconds beyond the last lyric line
        const lastTime = data.length ? data[data.length - 1].time : 30;
        setSongDuration(lastTime + 10);
      })
      .catch((err) => {
        console.error("Error fetching lyrics:", err);
      });
  }, [songId]);

  // Socket event setup
  useEffect(() => {
    // Host receives a 'pin' upon creating a game
    socket.on("gameCreated", ({ pin }) => {
      setHostPin(pin);
    });

    // Update the list of players (could be strings or objects)
    socket.on("updatePlayerList", ({ players }) => {
      setPlayers(players);
    });

    // Countdown event (shared by everyone)
    socket.on("countdownStart", ({ countdownSeconds }) => {
      setCountdown(countdownSeconds);
      const interval = setInterval(() => {
        setCountdown((prev) => {
          if (prev === 1) {
            clearInterval(interval);
            return null;
          }
          return (prev || 0) - 1;
        });
      }, 1000);
    });

    // Start the song timer
    socket.on("songStart", ({ durationSec, startedAt }) => {
      // The server says the song is starting.
      // We set songTimeLeft so Lyrics becomes active.
      setSongTimeLeft(durationSec);
      const timer = setInterval(() => {
        const now = Date.now();
        const elapsed = Math.floor((now - startedAt) / 1000);
        const left = durationSec - elapsed;
        if (left <= 0) {
          clearInterval(timer);
          setSongTimeLeft(null);
        } else {
          setSongTimeLeft(left);
        }
      }, 1000);
    });

    // Player successfully joined
    socket.on("playerJoinedSuccess", ({ pin, playerName }) => {
      setJoinError("");
      setPlayerJoined(true);
      setPlayerStatus("Waiting for host to start the countdown...");
    });

    // Player join error
    socket.on("playerJoinError", (message) => {
      setJoinError(message);
    });

    // // Instruct player to start or stop recording
    // socket.on("startRecording", ({ songId }) => {
    //   setPlayerStatus(`Recording started for song: ${songId} ...`);
    //   socket.emit("runScoringScript", { pin });
    // });

    socket.on("startRecording", ({ songId }) => {
      console.log(`Recording and scoring started for song: ${songId}...`);
      setPlayerStatus(`Recording and scoring started for song: ${songId}...`);
      // let DURATION = 10
      startRecording(10)

      // // Run the Python script locally on the client device
      // runPythonScript()
      //   .then((score) => {
      //     setPlayerStatus("Recording and scoring completed! Score received.");
      //     socket.emit("playerSendScore", { pin, score });
      //   })
      //   .catch((error) => {
      //     console.error("Error running Python script:", error);
      //     setPlayerStatus("Error during recording/scoring.");
      //   });
    });

    socket.on("stopRecording", () => {
      setPlayerStatus("Recording stopped! Sending score...");
      // Example: for now, we send a random mock score
      const mockScore = Math.floor(Math.random() * 101);
      socket.emit("playerSendScore", { pin, score: mockScore });
    });

    // Game over
    socket.on("gameOver", () => {
      setGameOver(true);
    });

    // Leaderboard for final or intermediate scores
    socket.on("showLeaderboard", (data) => {
      setLeaderboard(data);
    });

    socket.on("gameReset", () => {
      // Clear the "gameOver" flag
      setGameOver(false);
      // Clear the leaderboard from the UI
      setLeaderboard([]);
      // Clear any leftover countdown or lyrics states
      setSongId("");
      setSongTimeLeft(null);
      setCountdown(null);
      // The host can now pick a new song from the UI,
      // and all existing players remain in the same game with their scores.

      setPlayerStatus("Waiting for the host to start another round...");
    });

    return () => {
      socket.off("gameCreated");
      socket.off("updatePlayerList");
      socket.off("countdownStart");
      socket.off("songStart");
      socket.off("playerJoinedSuccess");
      socket.off("playerJoinError");
      socket.off("startRecording");
      socket.off("stopRecording");
      socket.off("gameOver");
      socket.off("showLeaderboard");
      socket.off("gameReset");
    };
  }, [pin]);

  // User actions
  function handleCreateGame() {
    setRole("host");
    socket.emit("hostCreateGame");
  }

  function handleJoinGame() {
    setRole("player");
  }

  function handleStartGame() {
    // The host notifies the server to start the countdown & song
    socket.emit("hostStartGame", {
      pin: hostPin,
      songId,
      // Use either the auto-calculated `songDuration` or a default of 30
      songDurationSec: Number(songDuration) || 30,
    });
  }

  function handlePlayerJoin() {
    if (!pin || !name) {
      setJoinError("Please enter both PIN and your Name.");
      return;
    }
    socket.emit("playerJoinGame", { pin, playerName: name });
  }

  async function runPythonScript() {
    return new Promise((resolve, reject) => {
      // Use the WebAssembly-based Python environment like Pyodide or any other setup,
      // or you can run a local script using a native Python runtime if the app is not web-based.

      let score = null;
      // Example: If using Node.js Electron or local browser client setup:
      // const pythonProcess = window.spawn("python3", ["scripts/scoring.py"]);
      // Process(process.argv[0], ["myApplicationPath", "otherArgs"], { detached: true, stdio: ['ignore'] });
      // pythonProcess = Process.spawn("python3", ["scripts/scoring.py"], { shell: true, detached: true });
      exec("python3 scripts/scoring.py", (error, stdout, stderr) => {
        if (error) {
          console.error("Error executing script");
          return;
        }
        if (stdout) {
          console.log("Python script output: ", stdout)
        }
        if (stderr) {
          const parsedScore = parseInt(data.toString().trim(), 10);
          if (!isNaN(parsedScore)) {
            score = parsedScore;
          }
        }
      })


      // pythonProcess.stdout.on("data", (data) => {
      //   console.log("Python output:", data.toString());
      // });

      // pythonProcess.stderr.on("data", (data) => {
      //   const parsedScore = parseInt(data.toString().trim(), 10);
      //   if (!isNaN(parsedScore)) {
      //     score = parsedScore;
      //   }
      // });

      // pythonProcess.on("close", (code) => {
      //   if (code !== 0 || score === null) {
      //     reject(`Python script exited with code ${code}`);
      //   } else {
      //     resolve(score);
      //   }
      // });
    });
  }

  function startRecording(durationMs) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn("getUserMedia is not supported in this browser.");
      return;
    }

    setIsRecording(true);

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const mediaRecorder = new MediaRecorder(stream);
        const chunks = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        mediaRecorder.onstop = async () => {
          setIsRecording(false);
          const blob = new Blob(chunks, { type: "audio/ogg; codecs=opus" });

          // Convert the blob to a buffer and send it to the server
          const buffer = await blob.arrayBuffer();
          const audioData = new Uint8Array(buffer);

          // Send the audio data to the server for Python processing
          socket.emit("runScoringScript", { pin, audioData });
        };

        mediaRecorder.start();
        setTimeout(() => mediaRecorder.stop(), durationMs);
      })
      .catch((error) => {
        setIsRecording(false);
        console.error("Error accessing microphone:", error);
      });
  }

  function handlePlayAgain() {
    // Only the HOST would have the pin stored in `hostPin`.
    socket.emit("hostPlayAgain", { pin: hostPin });
  }

  return (
    <div>
      <h1>Arcade Karaoke</h1>

      {gameOver ? (
        <div className="gameOver" style={{ marginTop: "1rem" }}>
          <h2>Game Over!</h2>
          {leaderboard.length > 0 && (
            <Leaderboard
              leaderboard={leaderboard}
              onPlayAgain={handlePlayAgain}
            />
          )}
          <p>Thanks for playing!</p>
        </div>
      ) : (
        <>
          {!role && (
            <div className="section">
              <p>Welcome to the Arcade Karaoke Showdown!</p>
              <button onClick={handleCreateGame}>Create Game (Host)</button>
              <button onClick={handleJoinGame}>Join Game (Player)</button>
            </div>
          )}

          {role === "host" && (
            <>
              <Host
                hostPin={hostPin}
                players={players}
                countdown={countdown}
                songTimeLeft={songTimeLeft}
                leaderboard={leaderboard}
                songId={songId}
                setSongId={setSongId}
                handleStartGame={handleStartGame}
              />

              {/* Show lyrics on the host screen if a song is chosen and playing */}
              {!!songId && (
                <Lyrics
                  lyrics={lyrics}
                  songTimeLeft={songTimeLeft}
                  songDuration={songDuration}
                />
              )}
            </>
          )}

          {role === "player" && (
            <Player
              pin={pin}
              setPin={setPin}
              name={name}
              setName={setName}
              joinError={joinError}
              handlePlayerJoin={handlePlayerJoin}
              playerJoined={playerJoined}
              playerStatus={playerStatus}
            />
          )}
        </>
      )}
    </div>
  );
}
