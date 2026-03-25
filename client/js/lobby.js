document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    const token = localStorage.getItem('token');
    const username = localStorage.getItem('username');

    if (!token) {
        window.location.href = 'index.html';
        return;
    }

    document.getElementById('welcome-msg').innerHTML = `<i data-lucide="user" style="width:18px; margin-right:5px; vertical-align:middle;"></i> ${username}`;
    lucide.createIcons();

    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        window.location.href = 'index.html';
    });

    const socket = io({
        auth: { token }
    });

    socket.on('connect_error', (err) => {
        if (err.message === 'Authentication error') {
            localStorage.removeItem('token');
            window.location.href = 'index.html';
        }
    });

    // Lobby UI Elements
    const lobbyList = document.getElementById('lobby-list');
    const refreshBtn = document.getElementById('refresh-lobbies-btn');
    const createForm = document.getElementById('create-lobby-form');
    
    // Room Modal Elements
    const roomModal = document.getElementById('lobby-room-modal');
    const roomNameEl = document.getElementById('room-name');
    const roomCountEl = document.getElementById('room-count');
    const roomMaxEl = document.getElementById('room-max');
    const roomPlayersEl = document.getElementById('room-players');
    const hostControls = document.getElementById('host-controls');
    const leaveLobbyBtn = document.getElementById('leave-lobby-btn');
    const startBtn = document.getElementById('start-game-btn');
    const addBotBtn = document.getElementById('add-bot-btn');
    const botDiffSelect = document.getElementById('bot-difficulty');
    const chatForm = document.getElementById('lobby-chat-form');
    const chatInput = document.getElementById('lobby-chat-input');
    const chatMessages = document.getElementById('lobby-chat-messages');

    let currentLobbyId = null;
    let isHost = false;

    // Requests
    const fetchLobbies = () => socket.emit('get_lobbies');
    refreshBtn.addEventListener('click', fetchLobbies);

    createForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const config = {
            name: document.getElementById('lobby-name').value,
            maxPlayers: parseInt(document.getElementById('max-players').value),
            password: document.getElementById('lobby-password').value,
            rules: {
                freeParking: document.getElementById('rule-free-parking').checked,
                noAuctions: document.getElementById('rule-no-auctions').checked,
                speedDie: document.getElementById('rule-speed-die').checked,
                doubleGo: document.getElementById('rule-double-go').checked
            }
        };
        socket.emit('create_lobby', config);
    });

    window.joinLobby = (id, hasPassword) => {
        let pwd = '';
        if (hasPassword) {
            pwd = prompt('Enter lobby password:');
            if (pwd === null) return;
        }
        socket.emit('join_lobby', { id, password: pwd });
    };

    leaveLobbyBtn.addEventListener('click', () => {
        socket.emit('leave_lobby');
        roomModal.classList.add('hidden');
        currentLobbyId = null;
        chatMessages.innerHTML = '';
        fetchLobbies();
    });

    addBotBtn.addEventListener('click', () => {
        socket.emit('add_bot', { difficulty: botDiffSelect.value });
    });

    startBtn.addEventListener('click', () => {
        socket.emit('start_game');
    });

    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const msg = chatInput.value.trim();
        if (msg) {
            socket.emit('lobby_chat', msg);
            chatInput.value = '';
        }
    });

    // Socket Events
    socket.on('lobbies_list', (lobbies) => {
        lobbyList.innerHTML = '';
        let hasWaiting = false;

        for (const [id, lobby] of Object.entries(lobbies)) {
            if (lobby.status !== 'waiting') continue;
            hasWaiting = true;
            
            const tr = document.createElement('tr');
            const lockIcon = lobby.hasPassword ? '<i data-lucide="lock" style="width:16px;"></i>' : '';
            
            tr.innerHTML = `
                <td><span class="status-dot waiting"></span></td>
                <td class="lobby-name-cell">${lobby.name} ${lockIcon}</td>
                <td>${lobby.hostName}</td>
                <td class="number">${lobby.players.length}/${lobby.maxPlayers}</td>
                <td style="text-align:right;">
                    <button class="ghost" onclick="joinLobby('${id}', ${lobby.hasPassword})" ${lobby.players.length >= lobby.maxPlayers ? 'disabled' : ''}>JOIN</button>
                </td>
            `;
            lobbyList.appendChild(tr);
        }

        if (!hasWaiting) {
            lobbyList.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--color-ivory-muted);">No open lobbies found.</td></tr>';
        }
        
        lucide.createIcons();
    });

    socket.on('lobby_joined', (lobby) => {
        currentLobbyId = lobby.id;
        isHost = lobby.host === socket.id;
        
        roomNameEl.textContent = lobby.name;
        roomModal.classList.remove('hidden');
        updateLobbyUI(lobby);
    });

    socket.on('lobby_updated', (lobby) => {
        if (currentLobbyId === lobby.id) {
            updateLobbyUI(lobby);
        }
    });

    socket.on('lobby_error', (msg) => {
        alert(msg);
    });

    socket.on('chat_message', ({ sender, msg }) => {
        const div = document.createElement('div');
        div.className = 'chat-message';
        div.innerHTML = `<strong>${sender}:</strong> ${msg}`;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });

    socket.on('game_started', () => {
        window.location.href = 'game.html';
    });

    function updateLobbyUI(lobby) {
        roomCountEl.textContent = lobby.players.length;
        roomMaxEl.textContent = lobby.maxPlayers;
        
        roomPlayersEl.innerHTML = '';
        lobby.players.forEach(p => {
            const li = document.createElement('li');
            const isBotStr = p.isBot ? '<span style="color:var(--color-ivory-muted); font-size:0.8rem;">(Bot)</span>' : '';
            const hostCrown = p.id === lobby.host ? '<i data-lucide="crown" style="color:var(--color-gold); width:18px;"></i>' : '';
            li.innerHTML = `<span>${p.name} ${isBotStr}</span> <span>${hostCrown}</span>`;
            roomPlayersEl.appendChild(li);
        });

        isHost = lobby.host === socket.id;
        if (isHost) {
            hostControls.classList.remove('hidden');
            startBtn.disabled = lobby.players.length < 2;
            addBotBtn.disabled = lobby.players.length >= lobby.maxPlayers;
        } else {
            hostControls.classList.add('hidden');
        }
        lucide.createIcons();
    }

    // Initial fetch
    fetchLobbies();
});