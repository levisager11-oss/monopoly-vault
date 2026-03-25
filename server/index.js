const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const jwt = require('jsonwebtoken');
const authRoutes = require('./routes/auth');
const statsRoutes = require('./routes/stats');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const JWT_SECRET = 'super-secret-key-for-local-monopoly';

app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

app.use('/api/auth', authRoutes);
app.use('/api/stats', statsRoutes);

// Lobby & Game Management
const lobbies = {};
const activeGames = {}; // keyed by gameId

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

// Socket Auth Middleware
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return next(new Error('Authentication error'));
        socket.user = decoded;
        next();
    });
});

io.on('connection', (socket) => {
    console.log(`User ${socket.user.username} connected (${socket.id})`);

    // Check if user is reconnecting to an active game
    let reconnectingGameId = null;
    for (const [gid, game] of Object.entries(activeGames)) {
        if (game.players.some(p => p.id === socket.user.userId)) {
            reconnectingGameId = gid;
            break;
        }
    }

    if (reconnectingGameId) {
        socket.join(reconnectingGameId);
        socket.currentLobby = reconnectingGameId;
        const game = activeGames[reconnectingGameId];
        game.handleReconnect(socket.user.userId, socket.id);
        socket.emit('game_started');
    }

    const broadcastLobbies = () => {
        const publicLobbies = {};
        for (const [id, l] of Object.entries(lobbies)) {
            publicLobbies[id] = {
                id: l.id,
                name: l.name,
                hasPassword: !!l.password,
                hostName: l.hostName,
                maxPlayers: l.maxPlayers,
                players: l.players,
                status: l.status
            };
        }
        io.emit('lobbies_list', publicLobbies);
    };

    socket.on('get_lobbies', broadcastLobbies);

    socket.on('create_lobby', (config) => {
        const id = generateId();
        lobbies[id] = {
            id,
            name: config.name || 'Lobby',
            maxPlayers: Math.min(Math.max(config.maxPlayers || 4, 2), 6),
            password: config.password || '',
            host: socket.id,
            hostName: socket.user.username,
            players: [{ id: socket.user.userId, name: socket.user.username, isBot: false, socketId: socket.id }],  
            status: 'waiting',
            rules: config.rules || {}
        };
        socket.join(id);
        socket.currentLobby = id;
        socket.emit('lobby_joined', lobbies[id]);
        broadcastLobbies();
    });

    socket.on('join_lobby', ({ id, password }) => {
        const lobby = lobbies[id];
        if (!lobby) return socket.emit('lobby_error', 'Lobby not found');
        if (lobby.status !== 'waiting') return socket.emit('lobby_error', 'Game already started');
        if (lobby.players.length >= lobby.maxPlayers) return socket.emit('lobby_error', 'Lobby full');
        if (lobby.password && lobby.password !== password) return socket.emit('lobby_error', 'Incorrect password');

        if (lobby.players.find(p => p.id === socket.user.userId)) return;

        lobby.players.push({ id: socket.user.userId, name: socket.user.username, isBot: false, socketId: socket.id });
        socket.join(id);
        socket.currentLobby = id;

        socket.emit('lobby_joined', lobby);
        io.to(id).emit('lobby_updated', lobby);
        io.to(id).emit('chat_message', { sender: 'System', msg: `${socket.user.username} joined the lobby.` });    
        broadcastLobbies();
    });

    socket.on('leave_lobby', () => {
        if (!socket.currentLobby) return;
        const id = socket.currentLobby;
        const lobby = lobbies[id];
        if (!lobby) return;

        lobby.players = lobby.players.filter(p => p.socketId !== socket.id);
        socket.leave(id);
        socket.currentLobby = null;

        if (lobby.players.length === 0 || (lobby.players.length > 0 && lobby.players.every(p => p.isBot))) {       
            delete lobbies[id];
        } else if (lobby.host === socket.id) {
            const newHost = lobby.players.find(p => !p.isBot);
            if (newHost) {
                lobby.host = newHost.socketId;
                lobby.hostName = newHost.name;
                io.to(id).emit('chat_message', { sender: 'System', msg: `${newHost.name} is the new host.` });     
            } else {
                delete lobbies[id];
            }
        }

        if (lobbies[id]) {
            io.to(id).emit('lobby_updated', lobbies[id]);
            io.to(id).emit('chat_message', { sender: 'System', msg: `${socket.user.username} left the lobby.` });  
        }
        broadcastLobbies();
    });

    socket.on('add_bot', ({ difficulty }) => {
        if (!socket.currentLobby) return;
        const lobby = lobbies[socket.currentLobby];
        if (lobby.host !== socket.id) return;
        if (lobby.players.length >= lobby.maxPlayers) return;

        const botId = 'bot_' + generateId();
        lobby.players.push({
            id: botId,
            name: `Bot - ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}`,
            isBot: true,
            difficulty: difficulty
        });

        io.to(lobby.id).emit('lobby_updated', lobby);
        broadcastLobbies();
    });

    socket.on('lobby_chat', (msg) => {
        if (!socket.currentLobby) return;
        io.to(socket.currentLobby).emit('chat_message', { sender: socket.user.username, msg });
    });

    socket.on('start_game', () => {
        if (!socket.currentLobby) return;
        const lobby = lobbies[socket.currentLobby];
        if (lobby.host !== socket.id) return;
        if (lobby.players.length < 2) return;

        lobby.status = 'playing';
        io.to(lobby.id).emit('game_started');
        broadcastLobbies();

        const GameEngine = require('./game/engine');
        const game = new GameEngine(lobby, io);
        activeGames[lobby.id] = game;
        game.start();
        
        // Remove from waiting lobbies
        delete lobbies[lobby.id];
    });

    // Unified Game Action Routing
    socket.on('game:roll', () => {
        if (socket.currentLobby && activeGames[socket.currentLobby]) {
            activeGames[socket.currentLobby].handleAction(socket.user.userId, { type: 'roll' });
        }
    });
    socket.on('game:buy', () => {
        if (socket.currentLobby && activeGames[socket.currentLobby]) {
            activeGames[socket.currentLobby].handleAction(socket.user.userId, { type: 'buy' });
        }
    });
    socket.on('game:auction', () => {
        if (socket.currentLobby && activeGames[socket.currentLobby]) {
            activeGames[socket.currentLobby].handleAction(socket.user.userId, { type: 'auction' });
        }
    });
    socket.on('game:endturn', () => {
        if (socket.currentLobby && activeGames[socket.currentLobby]) {
            activeGames[socket.currentLobby].handleAction(socket.user.userId, { type: 'end_turn' });
        }
    });
    socket.on('game:jail:pay', () => {
        if (socket.currentLobby && activeGames[socket.currentLobby]) {
            activeGames[socket.currentLobby].handleAction(socket.user.userId, { type: 'pay_jail' });
        }
    });
    socket.on('game:jail:card', () => {
        if (socket.currentLobby && activeGames[socket.currentLobby]) {
            activeGames[socket.currentLobby].handleAction(socket.user.userId, { type: 'use_card_jail' });
        }
    });
    socket.on('game:trade:offer', (payload) => {
        if (socket.currentLobby && activeGames[socket.currentLobby]) {
            activeGames[socket.currentLobby].handleAction(socket.user.userId, { type: 'propose_trade', tradeOffer: payload });
        }
    });
    socket.on('game:trade:respond', (payload) => {
        if (socket.currentLobby && activeGames[socket.currentLobby]) {
            activeGames[socket.currentLobby].handleAction(socket.user.userId, { type: 'trade_respond', accept: payload });
        }
    });
    socket.on('game:auction:bid', (payload) => {
        if (socket.currentLobby && activeGames[socket.currentLobby]) {
            activeGames[socket.currentLobby].handleAction(socket.user.userId, { type: 'auction_bid', bid: payload });
        }
    });
    socket.on('game:concede', () => {
        if (socket.currentLobby && activeGames[socket.currentLobby]) {
            activeGames[socket.currentLobby].handleAction(socket.user.userId, { type: 'concede' });
        }
    });
    socket.on('game:build', (payload) => {
        if (socket.currentLobby && activeGames[socket.currentLobby]) {
            activeGames[socket.currentLobby].handleAction(socket.user.userId, { type: 'build', propertyId: payload });
        }
    });
    socket.on('game:mortgage', (payload) => {
        if (socket.currentLobby && activeGames[socket.currentLobby]) {
            activeGames[socket.currentLobby].handleAction(socket.user.userId, { type: 'mortgage', propertyId: payload });
        }
    });

    socket.on('game:leave', () => {
        const id = socket.currentLobby;
        if (!id || !activeGames[id]) return;
        activeGames[id].handleLeave(socket.user.userId);
        socket.leave(id);
        socket.currentLobby = null;
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected (${socket.id})`);
        if (socket.currentLobby) {
            const id = socket.currentLobby;
            if (activeGames[id]) {
                const game = activeGames[id];
                const player = game.players.find(p => p.id === socket.user.userId);
                if (player) {
                    player.socketId = null;
                    // Start 60s disconnect timer
                    setTimeout(() => {
                        if (activeGames[id] && activeGames[id].players.find(p => p.id === socket.user.userId && !p.socketId)) {
                            activeGames[id].handleDisconnect(socket.user.userId);
                        }
                    }, 60000);
                }
            } else if (lobbies[id]) {
                // Was in waiting lobby
                const leaveMock = { currentLobby: socket.currentLobby, id: socket.id, user: socket.user, leave: socket.leave.bind(socket) };
                socket.emit('leave_lobby');
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});