# Arcade Karaoke

A multiplayer karaoke game that allows users to host karaoke sessions and have players join remotely using their phones. The game includes real-time pitch detection and scoring algorithms to evaluate singing performances.

## Features

- **Host & Player System**: One device acts as the host while multiple players can join using their phones
- **Audio Processing**: Records performances and provides detailed scoring analysis
- **Web-based Interface**: No app installation required for players
- **Caching System**: Pre-processes reference vocals for faster performance
- **Lyrics Display**: Shows synchronized lyrics during performances
- **Leaderboard**: Displays player rankings after each round

## System Architecture

### Backend Components

1. **Express Server (`server.js`)**
   - Handles WebSocket connections for real-time communication
   - Manages game sessions and player states
   - Coordinates song playback and recording timing

2. **Scoring System (`scoring.py`)**
   - Records player performances
   - Performs post-performance pitch detection using librosa
   - Uses DTW (Dynamic Time Warping) for melody comparison
   - Calculates final performance scores

3. **Song Playback System (`play_song.py`)**
   - Handles instrumental playback using pygame
   - Synchronizes with the game session

### Frontend Components

1. **React Application (`App.jsx`)**
   - Host interface for game management
   - Player interface for joining and performing
   - Real-time lyrics display
   - Score visualization

## Setup

### Prerequisites

- Node.js (v14 or higher)
- Python 3.8 or higher
- Required Python packages:
  ```
  librosa
  numpy
  sounddevice
  soundfile
  pygame
  scipy
  fastdtw
  ```
- Required Node.js packages:
  ```
  express
  socket.io
  cors
  ```

### Installation

1. Clone the repository
2. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Install Node.js dependencies:
   ```bash
   npm install
   ```

### Running the Application

1. Start the server:
   ```bash
   node server/server.js
   ```
2. Start the client development server:
   ```bash
   cd client
   npm run dev
   ```

## How to Play

### As a Host
1. Open the application and select "Create Game (Host)"
2. Share the generated PIN with players
3. Select a song from the available list
4. Wait for players to join
5. Start the game when ready

### As a Player
1. Open the application on your phone and select "Join Game (Player)"
2. Enter the game PIN and your name
3. Wait for the host to start the game
4. Sing along when the music starts
5. View your score and ranking after the performance

## Technical Details

### Scoring Algorithm

The scoring system records player performances and then analyzes them against the reference vocals:

1. **Recording**: Captures the player's vocal performance during the song
2. **Post-Processing**:
   - Uses librosa's PYIN algorithm for pitch detection
   - Converts frequencies to MIDI notes and normalizes to a single octave
   - Applies Dynamic Time Warping to align and compare melodies
3. **Performance Metrics**:
   - Pitch accuracy
   - Timing alignment
   - Voiced segment overlap
4. **Score Calculation**:
   - Weighted combination of metrics
   - Adjusts for performance overlap with reference vocals

### Caching System

To improve performance, the system:
- Pre-processes reference vocals and stores the analysis
- Caches pitch contours and other extracted features
- Reuses cached data for subsequent game sessions

## Future Improvements

- **Critical**: Complete integration between the Python scoring algorithm and the WebSocket frontend infrastructure
- **Critical**: Implement proper handling of recorded audio files between server and client
- Add more songs to the library
- Implement user accounts and persistent scores
- Add different game modes
- Improve the scoring algorithm
- Add visual feedback during performance
- Support for multiple simultaneous game sessions

Note: This project is currently a proof-of-concept. While the scoring algorithm and frontend are individually functional, the full integration between these components is still in development.