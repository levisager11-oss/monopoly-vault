# Monopoly Web Application

A locally hosted, complete Monopoly web application built with Node.js, Express, Socket.io, SQLite, and vanilla HTML/CSS/JS.

## Features
- **User Accounts & Stats**: Persistent user accounts and tracked statistics (win rate, games played, bankruptcies) via SQLite.
- **Lobby System**: Host and join custom lobbies, complete with password protection and custom house rules.
- **AI Bots**: Play against Easy, Medium, or Hard AI bots. Disconnected players are seamlessly replaced by bots.
- **Swiss/European Ruleset**: Full game engine enforcing core rules including trading, auctions, mortgages, building, chance/community chest, and jail mechanics.
- **Real-time Multiplayer**: Powered by Socket.io.

## Setup Instructions

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Open your browser and navigate to:
   [http://localhost:3000](http://localhost:3000)

## Tech Stack
- **Backend**: Node.js, Express.js
- **Database**: SQLite (local, file-based)
- **Real-time**: Socket.io
- **Frontend**: Vanilla HTML/CSS/JS (No frameworks)
