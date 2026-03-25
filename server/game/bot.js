class Bot {
    constructor(engine, playerId, difficulty) {
        this.engine = engine;
        this.playerId = playerId;
        this.difficulty = difficulty || 'easy'; // easy, medium, hard
    }

    get player() {
        return this.engine.players.find(p => p.id === this.playerId);
    }

    playTurn() {
        const state = this.engine.phase;
        const p = this.player;
        if (!p || p.isBankrupt || this.engine.phase === 'gameover') return;

        if (state === 'waiting_roll') {
            // Maybe use jail card or pay
            if (p.inJail) {
                if (p.getOutOfJailCards > 0 && this.difficulty !== 'easy') {
                    this.engine.handleAction(p.id, { type: 'use_card_jail' });
                    return;
                } else if (p.balance > 200 && this.difficulty !== 'easy') {
                    this.engine.handleAction(p.id, { type: 'pay_jail' });
                    return;
                }
            }
            this.engine.handleAction(p.id, { type: 'roll' });
        } else if (state === 'waiting_action') {
            const space = this.engine.board[p.position];

            // Buy property?
            if (['property', 'railroad', 'utility'].includes(space.type) && this.engine.properties[space.id].owner === null) {
                let shouldBuy = false;
                if (this.difficulty === 'easy') {
                    shouldBuy = p.balance >= space.price;
                } else if (this.difficulty === 'medium') {
                    shouldBuy = p.balance >= space.price + 100; // Keep a buffer
                } else {
                    // Hard: always buy if good ROI or monopoly potential
                    shouldBuy = p.balance >= space.price - 100; // Will mortgage if needed
                }

                if (shouldBuy && p.balance >= space.price) {
                    this.engine.handleAction(p.id, { type: 'buy' });
                    return;
                } else {
                    this.engine.handleAction(p.id, { type: 'auction' });
                    return;
                }
            }

            // Building logic (Medium / Hard)
            if (this.difficulty !== 'easy') {
                for (let propId of p.properties) {
                    const spaceInfo = this.engine.board.find(s => s.id === propId);
                    if (spaceInfo.type === 'property') {
                        const groupProps = this.engine.board.filter(s => s.color === spaceInfo.color).map(s => s.id);
                        const ownsAll = groupProps.every(id => this.engine.properties[id].owner === p.id);
                        if (ownsAll && p.balance > spaceInfo.houseCost + 200) {
                            // build one house
                            this.engine.handleAction(p.id, { type: 'build', propertyId: propId });
                            return; // Do one action at a time to allow state updates
                        }
                    }
                }
            }

            // End turn
            this.engine.handleAction(p.id, { type: 'end_turn' });
        }
    }

    handleAuction() {
        const p = this.player;
        if (!p || p.isBankrupt || this.engine.phase === 'gameover') return;
        const auction = this.engine.auction;
        if (!auction) return;

        const space = this.engine.board.find(s => s.id === auction.propertyId);
        let maxBid = 0;

        if (this.difficulty === 'easy') {
            maxBid = space.price;
        } else if (this.difficulty === 'medium') {
            maxBid = space.price + 50;
        } else {
            maxBid = space.price * 1.5;
        }

        maxBid = Math.min(maxBid, p.balance - 50);

        if (auction.highestBid < maxBid && auction.highestBidder !== p.id) {
            let nextBid = auction.highestBid + 10;
            if (nextBid <= maxBid && nextBid <= p.balance) {
                this.engine.handleAction(p.id, { type: 'auction_bid', bid: nextBid });
            } else {
                this.engine.handleAction(p.id, { type: 'auction_bid', bid: -1 });
            }
        } else {
            this.engine.handleAction(p.id, { type: 'auction_bid', bid: -1 });
        }
    }

    handleTrade() {
        const p = this.player;
        if (!p || p.isBankrupt || this.engine.phase === 'gameover') return;
        const trade = this.engine.trade;
        if (!trade) return;

        // Bot trade logic: Easy/Medium/Hard declines for now
        this.engine.handleAction(p.id, { type: 'trade_respond', accept: false });
    }
}

module.exports = Bot;