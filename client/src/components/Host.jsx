import React from "react";
import Leaderboard from "./Leaderboard";

// Example song selection data
const SONGS = [
  { id: "diewithasmile", title: "Die With A Smile" },
  { id: "dancingqueen", title: "Dancing Queen" },
  { id: "imjustken", title: "I'm Just Ken" },
  { id: "imjustken_cut", title: "I'm Just Ken (Cut)" },
  { id: "testsong", title: "Ethan Kinda Stinky NGL" },
];

export default function Host({
  hostPin,
  players,
  countdown,
  songTimeLeft,
  leaderboard,
  songId,
  setSongId,
  handleStartGame,
}) {
  return (
    <div className="section">
      {!hostPin ? (
        <p>Creating game...</p>
      ) : (
        <>
          <h2>Game PIN: {hostPin}</h2>

          <div className="mb-6">
            <h3>Players ({players.length})</h3>
            <ul>
              {players.map((player, index) => (
                // If your server sends objects (e.g. { name: 'Alice' }), use player.name.
                // If it sends strings, just use player.
                <li key={index}>
                  {typeof player === "string" ? player : player.name}
                </li>
              ))}
            </ul>
          </div>

          {/* Song Selection */}
          {!songId && (
            <div className="section">
              <h3>Select a Song</h3>
              <div className="song-selection">
                {SONGS.map((song) => (
                  <button
                    key={song.id}
                    onClick={() => setSongId(song.id)}
                    className="song-button"
                  >
                    {song.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Once a song is chosen but not started */}
          {songId && !countdown && !songTimeLeft && (
            <>
              <h3>Selected Song:</h3>
              <p className="mb-4">
                {SONGS.find((s) => s.id === songId)?.title}
              </p>
              <button onClick={handleStartGame}>Start Game</button>
            </>
          )}

          {/* Countdown display */}
          {countdown && (
            <div>
              <h3>Starting in...</h3>
              <div className="countdown-number">{countdown}</div>
            </div>
          )}

          {/* Song timer display */}
          {songTimeLeft && (
            <div>
              <h3>Time Remaining</h3>
              <div className="timer">{songTimeLeft}s</div>
            </div>
          )}

          {/* Leaderboard */}
          {leaderboard.length > 0 && <Leaderboard leaderboard={leaderboard} />}
        </>
      )}
    </div>
  );
}
