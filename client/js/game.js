const colors = ["#C9A84C", "#3D7EBF", "#27AE60", "#C0392B", "#9b59b6", "#e67e22"];

const boardDef = [
    { name: "Go", type: "go", class: "corner" },
    { name: "Badstrasse", type: "property", color: "#8B4513", price: 60, class: "bottom" },
    { name: "Community Chest", type: "chest", class: "bottom" },
    { name: "Turmstrasse", type: "property", color: "#8B4513", price: 60, class: "bottom" },
    { name: "Income Tax", type: "tax", class: "bottom" },
    { name: "Südbahnhof", type: "railroad", price: 200, class: "bottom" },
    { name: "Chausseestrasse", type: "property", color: "#87CEEB", price: 100, class: "bottom" },
    { name: "Chance", type: "chance", class: "bottom" },
    { name: "Elisenstrasse", type: "property", color: "#87CEEB", price: 100, class: "bottom" },
    { name: "Poststrasse", type: "property", color: "#87CEEB", price: 120, class: "bottom" },
    { name: "Jail", type: "jail", class: "corner" }, 
    { name: "Seestrasse", type: "property", color: "#DA70D6", price: 140, class: "left" },
    { name: "Elektrizitätswerk", type: "utility", price: 150, class: "left" },
    { name: "Hafenstrasse", type: "property", color: "#DA70D6", price: 140, class: "left" },
    { name: "Neue Strasse", type: "property", color: "#DA70D6", price: 160, class: "left" },
    { name: "Westbahnhof", type: "railroad", price: 200, class: "left" },
    { name: "Münchener Strasse", type: "property", color: "#FFA500", price: 180, class: "left" },
    { name: "Community Chest", type: "chest", class: "left" },
    { name: "Wiener Strasse", type: "property", color: "#FFA500", price: 180, class: "left" },
    { name: "Berliner Strasse", type: "property", color: "#FFA500", price: 200, class: "left" },
    { name: "Free Parking", type: "parking", class: "corner" }, 
    { name: "Theaterstrasse", type: "property", color: "#FF0000", price: 220, class: "top" },
    { name: "Chance", type: "chance", class: "top" },
    { name: "Museumstrasse", type: "property", color: "#FF0000", price: 220, class: "top" },
    { name: "Opernplatz", type: "property", color: "#FF0000", price: 240, class: "top" },
    { name: "Nordbahnhof", type: "railroad", price: 200, class: "top" },
    { name: "Lessingstrasse", type: "property", color: "#FFFF00", price: 260, class: "top" },
    { name: "Schillerstrasse", type: "property", color: "#FFFF00", price: 260, class: "top" },
    { name: "Wasserwerk", type: "utility", price: 150, class: "top" },
    { name: "Goethestrasse", type: "property", color: "#FFFF00", price: 280, class: "top" },
    { name: "Go To Jail", type: "gotojail", class: "corner" }, 
    { name: "Rathausplatz", type: "property", color: "#008000", price: 300, class: "right" },
    { name: "Hauptstrasse", type: "property", color: "#008000", price: 300, class: "right" },
    { name: "Community Chest", type: "chest", class: "right" },
    { name: "Bahnhofstrasse", type: "property", color: "#008000", price: 320, class: "right" },
    { name: "Hauptbahnhof", type: "railroad", price: 200, class: "right" },
    { name: "Chance", type: "chance", class: "right" },
    { name: "Parkstrasse", type: "property", color: "#00008B", price: 350, class: "right" },
    { name: "Luxury Tax", type: "tax", class: "right" },
    { name: "Schlossallee", type: "property", color: "#00008B", price: 400, class: "right" }
];

const dieDots = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8]
};

document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    const token = localStorage.getItem('token');
    const myUsername = localStorage.getItem('username');
    if (!token) { window.location.href = 'index.html'; return; }

    const socket = io({ auth: { token } });

    let gameState = null;
    let myId = null;
    let unreadCount = 0;
    let isChatExpanded = false;

    // UI Elements
    const boardEl = document.getElementById('board');
    const playersPanel = document.getElementById('players-panel');
    const turnIndicator = document.getElementById('turn-indicator');
    const diceDisplay = document.getElementById('dice-display');
    const gameLog = document.getElementById('game-log');
    const unreadBadge = document.getElementById('unread-badge');
    const chatTab = document.getElementById('chat-tab');
    const chatExpanded = document.getElementById('chat-expanded');

    // Action Buttons
    const btnRoll = document.getElementById('btn-roll');
    const btnEndTurn = document.getElementById('btn-end-turn');
    const btnBuy = document.getElementById('btn-buy');
    const btnAuction = document.getElementById('btn-auction');
    const btnPayJail = document.getElementById('btn-pay-jail');
    const btnUseCard = document.getElementById('btn-use-card');
    const btnTrade = document.getElementById('btn-trade');
    const btnConcede = document.getElementById('btn-concede');

    // Modals
    const tradeModal = document.getElementById('trade-modal');
    const auctionModal = document.getElementById('auction-modal');
    const propertyModal = document.getElementById('property-modal');

    chatTab.onclick = () => {
        isChatExpanded = !isChatExpanded;
        chatExpanded.classList.toggle('hidden', !isChatExpanded);
        if (isChatExpanded) {
            unreadCount = 0;
            unreadBadge.classList.add('hidden');
        }
    };

    socket.on('game:state', (state) => {
        gameState = state;
        const me = state.players.find(p => p.name === myUsername);
        if (me) myId = me.id;

        renderBoard();
        renderPlayers();
        updateActions();
        handleModals();
        renderDice(state.dice);

        turnIndicator.classList.remove('hidden');
        const currentP = state.players.find(p => p.id === state.currentPlayerId);
        turnIndicator.innerHTML = `<strong>${currentP.name}'s Turn</strong>`;
    });

    socket.on('game:event', (msg) => {
        addLogMessage(msg, 'msg-system');
    });

    socket.on('chat_message', ({ sender, msg }) => {
        addLogMessage(`${sender}: ${msg}`, 'msg-player');
        if (!isChatExpanded) {
            unreadCount++;
            unreadBadge.textContent = unreadCount;
            unreadBadge.classList.remove('hidden');
        }
    });

    socket.on('game:error', (msg) => {
        alert(msg);
    });

    function addLogMessage(text, className) {
        const div = document.createElement('div');
        div.className = `chat-message ${className}`;
        div.textContent = text;
        gameLog.appendChild(div);
        gameLog.scrollTop = gameLog.scrollHeight;
    }

    document.getElementById('game-chat-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('game-chat-input');
        if (input.value.trim()) {
            socket.emit('lobby_chat', input.value.trim());
            input.value = '';
        }
    });

    // Actions
    btnRoll.onclick = () => {
        animateDiceRoll();
        socket.emit('game:roll');
    };
    btnEndTurn.onclick = () => socket.emit('game:endturn');
    btnBuy.onclick = () => socket.emit('game:buy');
    btnAuction.onclick = () => socket.emit('game:auction');
    btnPayJail.onclick = () => socket.emit('game:jail:pay');
    btnUseCard.onclick = () => socket.emit('game:jail:card');
    btnConcede.onclick = () => { if(confirm("Are you sure you want to concede?")) socket.emit('game:concede'); };
    btnTrade.onclick = () => openTradeModal();

    function renderDice(dice) {
        const d1 = document.getElementById('die1');
        const d2 = document.getElementById('die2');
        updateDieFace(d1, dice[0]);
        updateDieFace(d2, dice[1]);
    }

    function updateDieFace(el, val) {
        el.innerHTML = '';
        if (val < 1) return;
        const dots = dieDots[val];
        for (let i = 0; i < 9; i++) {
            const dot = document.createElement('div');
            if (dots.includes(i)) dot.className = 'dot';
            el.appendChild(dot);
        }
    }

    function animateDiceRoll() {
        const d1 = document.getElementById('die1');
        const d2 = document.getElementById('die2');
        d1.classList.add('rolling');
        d2.classList.add('rolling');
        setTimeout(() => {
            d1.classList.remove('rolling');
            d2.classList.remove('rolling');
        }, 600);
    }

    function renderBoard() {
        if (boardEl.querySelectorAll('.space').length === 0) {
            const gridMap = [
                { gridArea: '11/11' }, { gridArea: '11/10' }, { gridArea: '11/9' }, { gridArea: '11/8' }, { gridArea: '11/7' }, { gridArea: '11/6' }, { gridArea: '11/5' }, { gridArea: '11/4' }, { gridArea: '11/3' }, { gridArea: '11/2' },
                { gridArea: '11/1' }, { gridArea: '10/1' }, { gridArea: '9/1' }, { gridArea: '8/1' }, { gridArea: '7/1' }, { gridArea: '6/1' }, { gridArea: '5/1' }, { gridArea: '4/1' }, { gridArea: '3/1' }, { gridArea: '2/1' },
                { gridArea: '1/1' }, { gridArea: '1/2' }, { gridArea: '1/3' }, { gridArea: '1/4' }, { gridArea: '1/5' }, { gridArea: '1/6' }, { gridArea: '1/7' }, { gridArea: '1/8' }, { gridArea: '1/9' }, { gridArea: '1/10' },
                { gridArea: '1/11' }, { gridArea: '2/11' }, { gridArea: '3/11' }, { gridArea: '4/11' }, { gridArea: '5/11' }, { gridArea: '6/11' }, { gridArea: '7/11' }, { gridArea: '8/11' }, { gridArea: '9/11' }, { gridArea: '10/11' }
            ];

            for (let i = 0; i < 40; i++) {
                const sp = document.createElement('div');
                const def = boardDef[i];
                sp.className = 'space ' + (def.class || '');
                sp.style.gridArea = gridMap[i].gridArea;
                sp.id = 'space-' + i;
                sp.onclick = () => openPropertyModal(i);

                let html = '';
                if (def.type === 'property') {
                    html += `<div class="color-bar" style="background-color:${def.color}"></div>`;
                    html += `<div class="space-content"><span class="space-name">${def.name}</span><span class="space-price">CHF ${def.price}</span></div>`;
                } else if (def.type === 'railroad') {
                    html += `<div class="space-content"><i data-lucide="train" style="width:16px; margin:auto;"></i><span class="space-name">${def.name}</span><span class="space-price">CHF ${def.price}</span></div>`;
                } else if (def.type === 'utility') {
                    const icon = def.name.includes('Elektriz') ? 'zap' : 'droplets';
                    html += `<div class="space-content"><i data-lucide="${icon}" style="width:16px; margin:auto;"></i><span class="space-name">${def.name}</span><span class="space-price">CHF ${def.price}</span></div>`;
                } else {
                    html += `<div class="space-content"><span class="space-name" style="margin:auto; font-size:0.7rem;">${def.name}</span></div>`;
                }
                sp.innerHTML = html;
                boardEl.appendChild(sp);
            }
            lucide.createIcons();
        }

        // Tokens
        gameState.players.forEach((p, idx) => {
            let t = document.getElementById('token-' + p.id);
            if (!t && !p.isBankrupt) {
                t = document.createElement('div');
                t.id = 'token-' + p.id;
                t.className = 'token';
                t.style.background = colors[idx % colors.length];
                t.textContent = p.name[0].toUpperCase();
                boardEl.appendChild(t);
            }
            if (p.isBankrupt && t) t.remove();
            
            if (t && !p.isBankrupt) {
                const spaceEl = document.getElementById('space-' + p.position);
                const boardRect = boardEl.getBoundingClientRect();
                const spaceRect = spaceEl.getBoundingClientRect();
                const top = spaceRect.top - boardRect.top + (spaceRect.height/2) - 12 + (idx%2)*8 - 4;
                const left = spaceRect.left - boardRect.left + (spaceRect.width/2) - 12 + Math.floor(idx/2)*8 - 4;
                t.style.transform = `translate(${left}px, ${top}px)`;
            }
        });

        // Ownership
        for (let i = 0; i < 40; i++) {
            const prop = gameState.properties[i];
            const sp = document.getElementById('space-' + i);
            if (prop && prop.owner) {
                const ownerIdx = gameState.players.findIndex(p => p.id === prop.owner);
                sp.style.boxShadow = `inset 0 0 0 4px ${colors[ownerIdx % colors.length]}`;
                if (prop.mortgaged) sp.style.opacity = '0.4';
                else sp.style.opacity = '1';
            }
        }
    }

    function renderPlayers() {
        playersPanel.innerHTML = '';
        gameState.players.forEach((p, idx) => {
            const div = document.createElement('div');
            div.className = 'player-item' + (p.id === gameState.currentPlayerId ? ' active' : '') + (p.isBankrupt ? ' bankrupt' : '');
            
            const isMe = p.id === myId;
            const turnBadge = p.id === gameState.currentPlayerId ? '<div class="turn-badge">YOUR TURN</div>' : '';

            div.innerHTML = `
                <div class="player-token-circle" style="background:${colors[idx % colors.length]}"></div>
                <div class="player-info-col">
                    <div class="player-name-row">
                        <span class="player-name">${p.name} ${isMe ? '(You)' : ''}</span>
                        ${p.isBot ? '<span class="bot-badge">BOT</span>' : ''}
                    </div>
                    <span class="player-balance">CHF ${p.balance}</span>
                </div>
                <div class="prop-badge">${p.properties.length} P</div>
                ${turnBadge}
            `;
            playersPanel.appendChild(div);
        });
    }

    function updateActions() {
        const me = gameState.players.find(p => p.id === myId);
        const isMyTurn = gameState.currentPlayerId === myId;
        const phase = gameState.phase;

        const allBtns = [btnRoll, btnEndTurn, btnBuy, btnAuction, btnPayJail, btnUseCard, btnTrade, btnConcede];
        allBtns.forEach(b => b.classList.add('disabled-btn'));
        
        if (me.isBankrupt || phase === 'gameover') return;

        btnTrade.classList.remove('disabled-btn');
        btnConcede.classList.remove('disabled-btn');

        if (isMyTurn) {
            if (phase === 'waiting_roll') {
                btnRoll.classList.remove('disabled-btn');
                if (me.inJail) {
                    if (me.balance >= 50) btnPayJail.classList.remove('disabled-btn');
                    if (me.getOutOfJailCards > 0) btnUseCard.classList.remove('disabled-btn');
                }
            } else if (phase === 'waiting_action') {
                btnEndTurn.classList.remove('disabled-btn');
                const prop = gameState.properties[me.position];
                if (prop && prop.owner === null) {
                    btnBuy.classList.remove('disabled-btn');
                    btnAuction.classList.remove('disabled-btn');
                }
            }
        }
    }

    function handleModals() {
        // Auction
        if (gameState.phase === 'auction' && gameState.auction.active[myId]) {
            const isMyAuctionTurn = gameState.players[gameState.auction.turnIndex].id === myId;
            auctionModal.classList.remove('hidden');
            document.getElementById('auction-highest').textContent = gameState.auction.highestBid;
            document.getElementById('auction-desc').innerHTML = `Auction for <strong>${boardDef[gameState.auction.propertyId].name}</strong><br>${isMyAuctionTurn ? 'Your turn to bid!' : 'Waiting...'}`;
            document.getElementById('btn-bid').classList.toggle('disabled-btn', !isMyAuctionTurn);
            document.getElementById('btn-pass').classList.toggle('disabled-btn', !isMyAuctionTurn);
        } else {
            auctionModal.classList.add('hidden');
        }

        // Trade
        if (gameState.phase === 'trade' && gameState.trade.to === myId) {
            tradeModal.classList.remove('hidden');
            document.getElementById('trade-outgoing').classList.add('hidden');
            document.getElementById('trade-incoming').classList.remove('hidden');
            const fromP = gameState.players.find(p => p.id === gameState.trade.from).name;
            document.getElementById('trade-desc').innerHTML = `<strong>${fromP}</strong> offers CHF ${gameState.trade.offerMoney} for CHF ${gameState.trade.requestMoney}`;
        } else if (gameState.phase !== 'trade') {
            tradeModal.classList.add('hidden');
        }
    }

    document.getElementById('btn-bid').onclick = () => {
        const bid = parseInt(document.getElementById('auction-bid-amount').value);
        socket.emit('game:auction:bid', bid);
    };
    document.getElementById('btn-pass').onclick = () => socket.emit('game:auction:bid', -1);
    document.getElementById('btn-accept-trade').onclick = () => socket.emit('game:trade:respond', true);
    document.getElementById('btn-decline-trade').onclick = () => socket.emit('game:trade:respond', false);
    document.getElementById('btn-cancel-trade').onclick = () => tradeModal.classList.add('hidden');
    document.getElementById('btn-send-trade').onclick = () => {
        const target = document.getElementById('trade-target').value;
        const offerMoney = parseInt(document.getElementById('trade-offer-money').value) || 0;
        const requestMoney = parseInt(document.getElementById('trade-req-money').value) || 0;
        socket.emit('game:trade:offer', { to: target, offerMoney, requestMoney, offerProps: [], requestProps: [] });
        tradeModal.classList.add('hidden');
    };

    function openTradeModal() {
        if (gameState.phase === 'auction' || gameState.phase === 'trade') return;
        const sel = document.getElementById('trade-target');
        sel.innerHTML = '';
        gameState.players.forEach(p => {
            if (p.id !== myId && !p.isBankrupt) {
                const opt = document.createElement('option');
                opt.value = p.id; opt.textContent = p.name;
                sel.appendChild(opt);
            }
        });
        tradeModal.classList.remove('hidden');
        document.getElementById('trade-incoming').classList.add('hidden');
        document.getElementById('trade-outgoing').classList.remove('hidden');
    }

    function openPropertyModal(id) {
        const prop = gameState.properties[id];
        if (!prop) return;
        const def = boardDef[id];
        propertyModal.classList.remove('hidden');
        document.getElementById('prop-title').textContent = def.name;
        const owner = prop.owner ? gameState.players.find(p=>p.id===prop.owner).name : 'None';
        document.getElementById('prop-details').innerHTML = `Owner: ${owner}<br>Price: CHF ${def.price}<br>Mortgaged: ${prop.mortgaged}`;
        
        const bBuild = document.getElementById('btn-build');
        const bMortgage = document.getElementById('btn-mortgage');
        if (prop.owner === myId) {
            bBuild.style.display = 'block'; bMortgage.style.display = 'block';
            bBuild.onclick = () => socket.emit('game:build', id);
            bMortgage.onclick = () => socket.emit('game:mortgage', id);
        } else {
            bBuild.style.display = 'none'; bMortgage.style.display = 'none';
        }
    }
    document.getElementById('btn-close-prop').onclick = () => propertyModal.classList.add('hidden');
});