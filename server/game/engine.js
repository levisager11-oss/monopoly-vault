const board = require('./board');
const { chanceCards, communityChestCards } = require('./cards');
const db = require('../db');
const Bot = require('./bot');

const TURN_TIMEOUT_MS = 30000;

function shuffle(array) {
  let currentIndex = array.length,  randomIndex;
  while (currentIndex != 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
}

class GameEngine {
    constructor(lobby, io) {
        this.gameId = lobby.id;
        this.io = io;
        this.rules = lobby.rules || {};

        // Shuffle players, humans first
        let humans = lobby.players.filter(p => !p.isBot);
        let bots = lobby.players.filter(p => p.isBot);
        
        humans = shuffle(humans);
        bots = shuffle(bots);
        
        const orderedPlayers = [...humans, ...bots];

        this.players = orderedPlayers.map(p => ({
            id: p.id,
            name: p.name,
            isBot: p.isBot,
            botDifficulty: p.difficulty || null,
            tokenColor: null, // assigned in frontend or later
            position: 0,
            balance: 1500,
            properties: [],
            inJail: false,
            jailTurns: 0,
            getOutOfJailCards: 0,
            isBankrupt: false,
            doublesCount: 0,
            socketId: p.socketId
        }));

        this.turn = 0;
        this.currentPlayerIndex = 0;
        this.phase = 'waiting_roll'; // waiting_roll, waiting_action, auction, trade, gameover
        this.board = board;

        this.chanceDeck = shuffle([...chanceCards]);
        this.communityDeck = shuffle([...communityChestCards]);

        this.properties = {};
        this.board.forEach(space => {
            if (['property', 'railroad', 'utility'].includes(space.type)) {
                this.properties[space.id] = {
                    owner: null,
                    mortgaged: false,
                    houses: 0,
                    hotel: 0
                };
            }
        });

        this.freeParking = 0;
        this.auction = null;
        this.trade = null;
        this.log = [];
        this.dice = [1, 1];
        this.lastRoll = [1, 1];
        this.winner = null;

        this.housesAvailable = 32;
        this.hotelsAvailable = 12;

        this.bots = {};
        this.players.forEach(p => {
            if (p.isBot) this.bots[p.id] = new Bot(this, p.id, p.botDifficulty);
        });

        this.turnTimer = null;
        this.turnDeadline = null;
        this._timerKey = null;
    }

    start() {
        this.addLog("Game started!");
        this.broadcastState();
        this.checkBotTurn();
    }

    getPublicState() {
        return {
            gameId: this.gameId,
            phase: this.phase,
            turn: this.turn,
            currentPlayerId: this.players[this.currentPlayerIndex].id,
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                isBot: p.isBot,
                botDifficulty: p.botDifficulty,
                tokenColor: p.tokenColor,
                position: p.position,
                balance: p.balance,
                properties: p.properties,
                jailTurns: p.jailTurns,
                inJail: p.inJail,
                isBankrupt: p.isBankrupt,
                getOutOfJailCards: p.getOutOfJailCards
            })),
            properties: this.properties,
            dice: this.dice,
            lastRoll: this.lastRoll,
            doublesCount: this.players[this.currentPlayerIndex]?.doublesCount || 0,
            freeParking: this.freeParking,
            houseRules: this.rules,
            winner: this.winner,
            auction: this.auction,
            trade: this.trade,
        turnDeadline: this.turnDeadline,
        turnTimeoutMs: TURN_TIMEOUT_MS,
            log: this.log.slice(-20)
        };
    }

    broadcastState(targetSocketId = null) {
        const state = this.getPublicState();
        if (targetSocketId) {
            this.io.to(targetSocketId).emit('game:state', state);
        } else {
            this.io.to(this.gameId).emit('game:state', state);
            this._maybeStartTurnTimer();
        }
    }

    addLog(msg) {
        this.log.push(msg);
        this.io.to(this.gameId).emit('game:event', msg);
    }

    handleDisconnect(userId) {
        const player = this.players.find(p => p.id === userId);
        if (player && !player.isBankrupt) {
            this.addLog(`${player.name} disconnected. Replaced by Bot (Medium).`);
            player.isBot = true;
            player.botDifficulty = 'medium';
            this.bots[player.id] = new Bot(this, player.id, 'medium');
            this.broadcastState();
            this.checkBotTurn();
        }
    }

    handleReconnect(userId, socketId) {
        const player = this.players.find(p => p.id === userId);
        if (player) {
            if (player.isBot) {
                // Was temporarily a bot, restore to human
                player.isBot = false;
                player.botDifficulty = null;
                delete this.bots[player.id];
                this.addLog(`${player.name} reconnected.`);
            }
            player.socketId = socketId;
            this.broadcastState(); // send full state back
        }
    }

    handleLeave(userId) {
        const player = this.players.find(p => p.id === userId);
        if (player && !player.isBankrupt) {
            this.addLog(`${player.name} left the game. Replaced by Bot (Medium).`);
            player.isBot = true;
            player.botDifficulty = 'medium';
            this.bots[player.id] = new Bot(this, player.id, 'medium');
            this.broadcastState();
            this.checkBotTurn();
        }
    }

    startTurnTimer() {
        if (this.turnTimer) clearTimeout(this.turnTimer);
        this.turnTimer = null;
        this.turnDeadline = null;

        const currentP = this.players[this.currentPlayerIndex];
        if (!currentP || currentP.isBankrupt || this.phase === 'gameover' ||
            this.phase === 'auction' || this.phase === 'trade') return;

        this.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
        const playerId = currentP.id;
        const phase = this.phase;

        this.turnTimer = setTimeout(() => {
            this.turnTimer = null;
            if (this.phase === phase && this.players[this.currentPlayerIndex]?.id === playerId) {
                this.addLog(`${currentP.name}'s turn timed out.`);
                if (phase === 'waiting_roll') {
                    this.handleAction(playerId, { type: 'roll' });
                } else if (phase === 'waiting_action') {
                    this.handleAction(playerId, { type: 'end_turn' });
                }
            }
        }, TURN_TIMEOUT_MS);
    }

    clearTurnTimer() {
        if (this.turnTimer) {
            clearTimeout(this.turnTimer);
            this.turnTimer = null;
        }
        this.turnDeadline = null;
        this._timerKey = null;
    }

    _maybeStartTurnTimer() {
        const currentP = this.players[this.currentPlayerIndex];
        if (!currentP) return;
        const key = `${currentP.id}:${this.phase}`;
        if (key !== this._timerKey) {
            this._timerKey = key;
            this.startTurnTimer();
        }
    }

    checkBotTurn() {
        if (this.phase === 'gameover') return;
        const currentP = this.players[this.currentPlayerIndex];
        if (currentP.isBankrupt) {
            this.nextTurn();
            return;
        }

        if (this.phase === 'auction') {
            const auctionP = this.players[this.auction.turnIndex];
            if (auctionP && auctionP.isBot && !auctionP.isBankrupt && this.auction.active[auctionP.id]) {
                setTimeout(() => {
                    try {
                        if (this.bots[auctionP.id]) this.bots[auctionP.id].handleAuction();
                    } catch (e) {
                        console.error(e);
                        this.handleAction(auctionP.id, { type: 'auction_bid', bid: -1 });
                    }
                }, this.getBotDelay(auctionP.botDifficulty));
            }
            return;
        }

        if (this.phase === 'trade') {
            const targetP = this.players.find(p => p.id === this.trade.to);
            if (targetP && targetP.isBot) {
                setTimeout(() => {
                    try {
                        if (this.bots[targetP.id]) this.bots[targetP.id].handleTrade();
                    } catch (e) {
                        console.error(e);
                        this.handleAction(targetP.id, { type: 'trade_respond', accept: false });
                    }
                }, this.getBotDelay(targetP.botDifficulty));
            }
            return;
        }

        if (currentP.isBot) {
            setTimeout(() => {
                try {
                    if (this.bots[currentP.id]) this.bots[currentP.id].playTurn();
                } catch (e) {
                    console.error(e);
                    if (this.phase === 'waiting_roll') this.handleAction(currentP.id, { type: 'roll' });
                    else if (this.phase === 'waiting_action') this.handleAction(currentP.id, { type: 'end_turn' });
                }
            }, this.getBotDelay(currentP.botDifficulty));
        }
    }

    getBotDelay(diff) {
        if (diff === 'hard') return 800;
        return 1500;
    }

    handleAction(userId, action) {
        const player = this.players.find(p => p.id === userId);
        if (!player || player.isBankrupt || this.phase === 'gameover') return;

        this.clearTurnTimer();

        const isCurrentTurn = player.id === this.players[this.currentPlayerIndex].id;

        if (this.phase === 'auction' && action.type === 'auction_bid') {
            this.handleAuctionBid(player, action.bid);
            return;
        }

        if (this.phase === 'trade' && action.type === 'trade_respond' && this.trade.to === player.id) {
            this.handleTradeResponse(action.accept);
            return;
        }

        if (isCurrentTurn) {
            if (this.phase === 'waiting_roll') {
                if (action.type === 'roll') {
                    this.rollDice();
                } else if (action.type === 'pay_jail') {
                    this.payJail(player);
                } else if (action.type === 'use_card_jail') {
                    this.useJailCard(player);
                }
            } else if (this.phase === 'waiting_action') {
                if (action.type === 'buy') this.buyProperty(player);
                if (action.type === 'auction') this.startAuction();
                if (action.type === 'end_turn') this.endTurn();
                if (action.type === 'pay_jail') this.payJail(player);
                if (action.type === 'use_card_jail') this.useJailCard(player);
            }
        }

        // Global actions
        if (action.type === 'build') this.build(player, action.propertyId);
        if (action.type === 'mortgage') this.toggleMortgage(player, action.propertyId);
        if (action.type === 'concede') this.bankruptPlayer(player, null);
        if (action.type === 'propose_trade' && this.phase !== 'trade' && this.phase !== 'auction') {
            this.proposeTrade(player, action.tradeOffer);
        }

        this.broadcastState();
    }

    rollDice() {
        const currentP = this.players[this.currentPlayerIndex];
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        this.dice = [d1, d2];
        this.lastRoll = [d1, d2];
        this.addLog(`${currentP.name} rolled ${d1} and ${d2}.`);

        if (currentP.inJail) {
            if (d1 === d2) {
                this.addLog(`${currentP.name} rolled doubles and escapes jail!`);
                currentP.inJail = false;
                currentP.jailTurns = 0;
                this.movePlayer(currentP, d1 + d2);
            } else {
                currentP.jailTurns++;
                if (currentP.jailTurns >= 3) {
                    this.addLog(`${currentP.name} must pay CHF 50 to escape jail.`);
                    if (this.rules.freeParking) {
                        this.freeParking += 50;
                        this.payMoney(currentP, 50, 'pot');
                    } else {
                        this.payMoney(currentP, 50, null);
                    }
                    if (!currentP.isBankrupt) {
                        currentP.inJail = false;
                        currentP.jailTurns = 0;
                        this.movePlayer(currentP, d1 + d2);
                    }
                } else {
                    this.phase = 'waiting_action'; 
                    this.checkBotTurn();
                }
            }
            this.broadcastState();
            return;
        }

        if (d1 === d2) {
            currentP.doublesCount++;
            if (currentP.doublesCount === 3) {
                this.addLog(`${currentP.name} rolled doubles 3 times in a row! Go to Jail!`);
                this.goToJail(currentP);
                return;
            }
        } else {
            currentP.doublesCount = 0;
        }

        this.movePlayer(currentP, d1 + d2);
    }

    movePlayer(player, amount) {
        let newPos = player.position + amount;
        if (newPos >= 40) {
            newPos -= 40;
            const salary = this.rules.doubleGo && newPos === 0 ? 400 : 200;
            player.balance += salary;
            this.addLog(`${player.name} passed Go and collected CHF ${salary}.`);
        } else if (newPos < 0) {
            newPos += 40;
        }
        player.position = newPos;
        this.handleSpace(player);
    }

    handleSpace(player) {
        const space = this.board[player.position];
        this.addLog(`${player.name} landed on ${space.name}.`);

        if (['property', 'railroad', 'utility'].includes(space.type)) {
            const propData = this.properties[space.id];
            if (propData.owner === null) {
                this.phase = 'waiting_action';
                this.broadcastState();
                this.checkBotTurn();
                return;
            } else if (propData.owner !== player.id && !propData.mortgaged) {
                const rent = this.calculateRent(space.id, player.id);
                if (rent > 0) {
                    this.addLog(`${player.name} pays CHF ${rent} rent to ${this.players.find(p=>p.id===propData.owner).name}.`);
                    this.payMoney(player, rent, propData.owner);
                }
            }
        } else if (space.type === 'tax') {
            let amount = space.amount;
            this.addLog(`${player.name} pays CHF ${amount} tax.`);
            if (this.rules.freeParking) {
                this.freeParking += amount;
                this.payMoney(player, amount, 'pot');
            } else {
                this.payMoney(player, amount, null);
            }
        } else if (space.type === 'chance') {
            this.drawCard(player, this.chanceDeck, 'chance');
        } else if (space.type === 'chest') {
            this.drawCard(player, this.communityDeck, 'chest');
        } else if (space.type === 'gotojail') {
            this.goToJail(player);
            return;
        } else if (space.type === 'parking' && this.rules.freeParking && this.freeParking > 0) {
            this.addLog(`${player.name} collected CHF ${this.freeParking} from Free Parking!`);
            player.balance += this.freeParking;
            this.freeParking = 0;
        }

        if (this.phase !== 'waiting_action') {
            this.phase = 'waiting_action';
            this.broadcastState();
            this.checkBotTurn();
        }
    }

    calculateRent(spaceId, tenantId) {
        const space = this.board.find(s => s.id === spaceId);
        const prop = this.properties[spaceId];
        if (prop.mortgaged) return 0;

        let ownerProps = Object.keys(this.properties).filter(k => this.properties[k].owner === prop.owner);        

        if (space.type === 'property') {
            const groupProps = this.board.filter(s => s.color === space.color).map(s => s.id);
            const ownsAll = groupProps.every(id => ownerProps.includes(id.toString()));

            if (prop.hotel > 0) return space.rent[5];
            if (prop.houses > 0) return space.rent[prop.houses];
            return ownsAll ? space.rent[0] * 2 : space.rent[0];
        } else if (space.type === 'railroad') {
            const rRCount = this.board.filter(s => s.type === 'railroad' && ownerProps.includes(s.id.toString())).length;
            return 25 * Math.pow(2, rRCount - 1);
        } else if (space.type === 'utility') {
            const uCount = this.board.filter(s => s.type === 'utility' && ownerProps.includes(s.id.toString())).length;
            const multiplier = uCount === 2 ? 10 : 4;
            return (this.dice[0] + this.dice[1]) * multiplier;
        }
        return 0;
    }

    payMoney(player, amount, toId) {
        if (player.balance >= amount) {
            player.balance -= amount;
            if (toId && toId !== 'pot') {
                const receiver = this.players.find(p => p.id === toId);
                if (receiver) receiver.balance += amount;
            }
        } else {
            this.addLog(`${player.name} does not have enough money and is bankrupt!`);
            this.bankruptPlayer(player, toId);
        }
    }

    bankruptPlayer(player, creditorId) {
        player.isBankrupt = true;
        player.balance = 0;

        if (creditorId && creditorId !== 'pot') {
            const creditor = this.players.find(p => p.id === creditorId);
            player.properties.forEach(propId => {
                this.properties[propId].owner = creditorId;
                creditor.properties.push(propId);
            });
            creditor.getOutOfJailCards += player.getOutOfJailCards;
        } else {
            player.properties.forEach(propId => {
                this.properties[propId].owner = null;
                this.properties[propId].mortgaged = false;
                this.housesAvailable += this.properties[propId].houses;
                this.hotelsAvailable += this.properties[propId].hotel;
                this.properties[propId].houses = 0;
                this.properties[propId].hotel = 0;
            });
        }
        player.properties = [];
        player.getOutOfJailCards = 0;

        this.addLog(`${player.name} has gone bankrupt and been eliminated`);

        const alive = this.getAlivePlayers();
        if (alive.length === 1) {
            this.addLog(`${alive[0].name} WINS THE GAME!`);
            this.winner = alive[0].id;
            this.endGame(alive[0]);
        } else {
            if (this.players[this.currentPlayerIndex].id === player.id) {
                this.nextTurn();
            } else if (this.phase === 'auction' && this.auction.active[player.id]) {
                this.auction.active[player.id] = false;
                this.nextAuctionTurn();
            }
        }
    }

    getAlivePlayers() {
        return this.players.filter(p => !p.isBankrupt);
    }

    endGame(winner) {
        this.phase = 'gameover';
        this.clearTurnTimer();
        this.players.forEach(p => {
            if (!p.isBot) {
                db.run(`UPDATE stats SET games_played = games_played + 1 WHERE user_id = ?`, [p.id]);
                if (p.id === winner.id) {
                    db.run(`UPDATE stats SET games_won = games_won + 1 WHERE user_id = ?`, [p.id]);
                }
                if (p.isBankrupt) {
                    db.run(`UPDATE stats SET bankruptcies = bankruptcies + 1 WHERE user_id = ?`, [p.id]);
                }
            }
        });
        this.broadcastState();
    }

    goToJail(player) {
        player.position = 10;
        player.inJail = true;
        player.jailTurns = 0;
        player.doublesCount = 0;
        this.phase = 'waiting_action';
        this.broadcastState();
        this.checkBotTurn();
    }

    buyProperty(player) {
        const space = this.board[player.position];
        if (this.properties[space.id].owner === null && player.balance >= space.price) {
            player.balance -= space.price;
            this.properties[space.id].owner = player.id;
            player.properties.push(space.id);
            this.addLog(`${player.name} bought ${space.name} for CHF ${space.price}.`);

            this.broadcastState();
            this.checkBotTurn();
        }
    }

    startAuction() {
        if (this.rules.noAuctions) {
            this.endTurn();
            return;
        }

        const space = this.board[this.players[this.currentPlayerIndex].position];
        this.phase = 'auction';

        const active = {};
        this.players.forEach(p => { if (!p.isBankrupt) active[p.id] = true; });

        this.auction = {
            propertyId: space.id,
            highestBid: 0,
            highestBidder: null,
            active,
            turnIndex: this.currentPlayerIndex
        };
        this.addLog(`Auction started for ${space.name}.`);
        this.nextAuctionTurn();
    }

    nextAuctionTurn() {
        const activeIds = Object.keys(this.auction.active).filter(id => this.auction.active[id]);
        if (activeIds.length === 1 && this.auction.highestBidder) {
            const winner = this.players.find(p => p.id === this.auction.highestBidder);
            this.addLog(`${winner.name} won the auction for CHF ${this.auction.highestBid}.`);
            winner.balance -= this.auction.highestBid;
            this.properties[this.auction.propertyId].owner = winner.id;
            winner.properties.push(this.auction.propertyId);
            this.phase = 'waiting_action';
            this.auction = null;
            this.broadcastState();
            this.checkBotTurn();
            return;
        } else if (activeIds.length === 0) {
            this.addLog(`Auction ended with no bids.`);
            this.phase = 'waiting_action';
            this.auction = null;
            this.broadcastState();
            this.checkBotTurn();
            return;
        }

        let nextIdx = (this.auction.turnIndex + 1) % this.players.length;
        while (!this.auction.active[this.players[nextIdx].id]) {
            nextIdx = (nextIdx + 1) % this.players.length;
        }
        this.auction.turnIndex = nextIdx;

        if (this.players[nextIdx].id === this.auction.highestBidder) {
             const winner = this.players[nextIdx];
             this.addLog(`${winner.name} won the auction for CHF ${this.auction.highestBid}.`);
             winner.balance -= this.auction.highestBid;
             this.properties[this.auction.propertyId].owner = winner.id;
             winner.properties.push(this.auction.propertyId);
             this.phase = 'waiting_action';
             this.auction = null;
             this.broadcastState();
             this.checkBotTurn();
             return;
        }

        this.broadcastState();
        this.checkBotTurn();
    }

    handleAuctionBid(player, bid) {
        if (bid === -1) {
            this.auction.active[player.id] = false;
            this.addLog(`${player.name} passed on the auction.`);
        } else if (bid > this.auction.highestBid && bid <= player.balance) {
            this.auction.highestBid = bid;
            this.auction.highestBidder = player.id;
            this.addLog(`${player.name} bid CHF ${bid}.`);
        }
        this.nextAuctionTurn();
    }

    endTurn() {
        const currentP = this.players[this.currentPlayerIndex];
        if (this.dice[0] === this.dice[1] && currentP.doublesCount > 0 && !currentP.inJail) {
            this.phase = 'waiting_roll';
            this.broadcastState();
            this.checkBotTurn();
        } else {
            this.nextTurn();
        }
    }

    nextTurn() {
        this.turn++;
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
        while (this.players[this.currentPlayerIndex].isBankrupt) {
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
        }
        this.phase = 'waiting_roll';
        this.broadcastState();
        this.checkBotTurn();
    }

    drawCard(player, deck, type) {
        const card = deck.shift();
        deck.push(card);
        this.addLog(`${player.name} drew ${type}: ${card.text}`);

        if (card.action === 'advance') {
            let oldPos = player.position;
            player.position = card.target;
            if (player.position < oldPos && card.target !== 10) { 
                const salary = this.rules.doubleGo && card.target === 0 ? 400 : 200;
                player.balance += salary;
                this.addLog(`${player.name} passed Go and collected CHF ${salary}.`);
            }
            this.handleSpace(player);
        } else if (card.action === 'advance_utility' || card.action === 'advance_railroad') {
            const tType = card.action.split('_')[1];
            let pos = player.position;
            while (this.board[pos].type !== tType) {
                pos = (pos + 1) % 40;
                if (pos === 0) player.balance += 200;
            }
            player.position = pos;
            const space = this.board[pos];
            const propData = this.properties[space.id];
            if (propData.owner === null) {
                // Unowned: player can buy
                this.phase = 'waiting_action';
                this.broadcastState();
                this.checkBotTurn();
            } else if (propData.owner !== player.id && !propData.mortgaged) {
                // Owned by another player: apply card-specific rent
                let rent;
                if (card.action === 'advance_railroad') {
                    const normalRent = this.calculateRent(space.id, player.id);
                    rent = normalRent * 2;
                } else {
                    // advance_utility: always 10x dice roll
                    rent = (this.dice[0] + this.dice[1]) * 10;
                }
                if (rent > 0) {
                    this.addLog(`${player.name} pays CHF ${rent} rent to ${this.players.find(p=>p.id===propData.owner).name}.`);
                    this.payMoney(player, rent, propData.owner);
                }
            }
        } else if (card.action === 'add_money') {
            player.balance += card.amount;
        } else if (card.action === 'pay_money') {
            if (this.rules.freeParking) {
                this.freeParking += card.amount;
                this.payMoney(player, card.amount, 'pot');
            } else {
                this.payMoney(player, card.amount, null);
            }
        } else if (card.action === 'gotojail') {
            this.goToJail(player);
        } else if (card.action === 'get_out_of_jail') {
            player.getOutOfJailCards++;
        } else if (card.action === 'move') {
            player.position += card.amount;
            if (player.position < 0) player.position += 40;
            this.handleSpace(player);
        } else if (card.action === 'repairs') {
            let cost = 0;
            player.properties.forEach(pid => {
                cost += this.properties[pid].houses * card.houseCost;
                cost += this.properties[pid].hotel * card.hotelCost;
            });
            if (cost > 0) this.payMoney(player, cost, null);
        } else if (card.action === 'pay_players') {
            this.players.forEach(p => {
                if (p.id !== player.id && !p.isBankrupt) {
                    this.payMoney(player, card.amount, p.id);
                }
            });
        } else if (card.action === 'collect_from_players') {
            this.players.forEach(p => {
                if (p.id !== player.id && !p.isBankrupt) {
                    this.payMoney(p, card.amount, player.id);
                }
            });
        }
    }

    payJail(player) {
        if (player.inJail && player.balance >= 50) {
            player.balance -= 50;
            if(this.rules.freeParking) this.freeParking += 50;
            player.inJail = false;
            player.jailTurns = 0;
            this.addLog(`${player.name} paid CHF 50 to get out of jail.`);
            this.broadcastState();
        }
    }

    useJailCard(player) {
        if (player.inJail && player.getOutOfJailCards > 0) {
            player.getOutOfJailCards--;
            player.inJail = false;
            player.jailTurns = 0;
            this.addLog(`${player.name} used a Get Out of Jail card.`);
            this.broadcastState();
        }
    }

    toggleMortgage(player, propId) {
        if (!player.properties.includes(propId)) return;
        const prop = this.properties[propId];
        const space = this.board.find(s => s.id === propId);

        const groupProps = this.board.filter(s => s.color === space.color).map(s => s.id);
        const hasBuildings = groupProps.some(id => this.properties[id].houses > 0 || this.properties[id].hotel > 0);
        if (hasBuildings) return;

        if (!prop.mortgaged) {
            prop.mortgaged = true;
            player.balance += space.price / 2;
            this.addLog(`${player.name} mortgaged ${space.name}.`);
        } else {
            const cost = Math.floor((space.price / 2) * 1.1);
            if (player.balance >= cost) {
                prop.mortgaged = false;
                player.balance -= cost;
                this.addLog(`${player.name} unmortgaged ${space.name}.`);
            }
        }
    }

    build(player, propId) {
        if (!player.properties.includes(propId)) return;
        const prop = this.properties[propId];
        const space = this.board.find(s => s.id === propId);
        if (space.type !== 'property') return;

        const groupProps = this.board.filter(s => s.color === space.color).map(s => s.id);
        const ownsAll = groupProps.every(id => this.properties[id].owner === player.id);
        if (!ownsAll) return;

        if (groupProps.some(id => this.properties[id].mortgaged)) return;     

        const minBuildings = Math.min(...groupProps.map(id => this.properties[id].hotel ? 5 : this.properties[id].houses));
        const currentB = prop.hotel ? 5 : prop.houses;

        if (currentB > minBuildings) return;

        if (player.balance >= space.houseCost) {
            if (prop.houses < 4 && prop.hotel === 0 && this.housesAvailable > 0) {
                player.balance -= space.houseCost;
                prop.houses++;
                this.housesAvailable--;
                this.addLog(`${player.name} built a house on ${space.name}.`);
            } else if (prop.houses === 4 && prop.hotel === 0 && this.hotelsAvailable > 0) {
                player.balance -= space.houseCost;
                prop.houses = 0;
                prop.hotel = 1;
                this.housesAvailable += 4;
                this.hotelsAvailable--;
                this.addLog(`${player.name} built a hotel on ${space.name}.`);
            }
        }
    }

    proposeTrade(player, offer) {
        if (this.phase !== 'waiting_action' && this.phase !== 'waiting_roll') return;
        const target = this.players.find(p => p.id === offer.to);
        if (!target || target.isBankrupt) return;

        this.trade = {
            from: player.id,
            to: offer.to,
            offerMoney: offer.offerMoney || 0,
            offerProps: offer.offerProps || [],
            requestMoney: offer.requestMoney || 0,
            requestProps: offer.requestProps || []
        };
        this.phase = 'trade';
        this.addLog(`${player.name} proposed a trade to ${target.name}.`);
        this.broadcastState();
        this.checkBotTurn();
    }

    handleTradeResponse(accept) {
        if (!this.trade) return;
        const pFrom = this.players.find(p => p.id === this.trade.from);
        const pTo = this.players.find(p => p.id === this.trade.to);

        if (accept) {
            if (pFrom.balance >= this.trade.offerMoney && pTo.balance >= this.trade.requestMoney) {
                const validPropsFrom = this.trade.offerProps.every(id => pFrom.properties.includes(id) && this.properties[id].houses === 0 && this.properties[id].hotel === 0);
                const validPropsTo = this.trade.requestProps.every(id => pTo.properties.includes(id) && this.properties[id].houses === 0 && this.properties[id].hotel === 0);

                if (validPropsFrom && validPropsTo) {
                    pFrom.balance -= this.trade.offerMoney;
                    pFrom.balance += this.trade.requestMoney;
                    pTo.balance -= this.trade.requestMoney;
                    pTo.balance += this.trade.offerMoney;

                    this.trade.offerProps.forEach(id => {
                        this.properties[id].owner = pTo.id;
                        pFrom.properties = pFrom.properties.filter(pid => pid !== id);
                        pTo.properties.push(id);
                    });

                    this.trade.requestProps.forEach(id => {
                        this.properties[id].owner = pFrom.id;
                        pTo.properties = pTo.properties.filter(pid => pid !== id);
                        pFrom.properties.push(id);
                    });

                    this.addLog(`Trade accepted!`);
                } else {
                    this.addLog(`Trade failed: Invalid properties (houses built).`);
                }
            } else {
                this.addLog(`Trade failed: Insufficient funds.`);
            }
        } else {
            this.addLog(`${pTo.name} declined the trade.`);
        }

        this.trade = null;
        this.phase = 'waiting_action';
        this.broadcastState();
        this.checkBotTurn();
    }
}

module.exports = GameEngine;