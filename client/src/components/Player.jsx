import React from "react";

export default function Player({
  pin,
  setPin,
  name,
  setName,
  joinError,
  handlePlayerJoin,
  playerJoined,
  playerStatus,
}) {
  return (
    <div className="section">
      {!playerJoined ? (
        <>
          <div>
            <label>Game PIN:</label>
            <input
              type="text"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </div>
          <div>
            <label>Your Name:</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {joinError && <div className="error">{joinError}</div>}
          <button onClick={handlePlayerJoin}>Join Game</button>
        </>
      ) : (
        <div>
          <h3>Welcome, {name}!</h3>
          <p>{playerStatus}</p>
        </div>
      )}
    </div>
  );
}