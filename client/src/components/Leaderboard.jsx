import React from "react";

export default function Leaderboard({ leaderboard, onPlayAgain }) {
    return (
        <div className="leaderboard" style={{ marginTop: "1rem" }}>
            <h3>Leaderboard</h3>
            <ol id="leaderboard-list">
                {leaderboard.map((lb, idx) => (
                    <li key={idx}>
                        {lb.name}: {lb.score}
                    </li>
                ))}
            </ol>

            <button onClick={onPlayAgain}>
              Play Again
            </button>
        </div>
    );
}
