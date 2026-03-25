jest.mock('../db');

const GameEngine = require('./engine');
const board = require('./board');

// Helper to create a mock io object
function createMockIo() {
    const emitFn = jest.fn();
    return {
        to: jest.fn().mockReturnValue({ emit: emitFn }),
        _emit: emitFn
    };
}

// Helper to create a basic 2-player lobby
function createLobby(overrides = {}) {
    return {
        id: 'test-game',
        rules: overrides.rules || {},
        players: overrides.players || [
            { id: 'p1', name: 'Alice', isBot: false, socketId: 's1' },
            { id: 'p2', name: 'Bob', isBot: false, socketId: 's2' }
        ]
    };
}

// Helper to create a game engine with deterministic player order (no shuffle)
function createGame(overrides = {}) {
    const io = createMockIo();
    const lobby = createLobby(overrides);
    // Prevent shuffle by returning 0.99 (Fisher-Yates swaps element with itself)
    const origRandom = Math.random;
    Math.random = () => 0.99;
    const engine = new GameEngine(lobby, io);
    Math.random = origRandom;
    return engine;
}

// Override dice rolls for deterministic testing
function mockDice(engine, d1, d2) {
    jest.spyOn(Math, 'random')
        .mockReturnValueOnce((d1 - 1) / 6)
        .mockReturnValueOnce((d2 - 1) / 6);
}

// Helper to find player by ID
function getPlayer(engine, id) {
    return engine.players.find(p => p.id === id);
}

describe('GameEngine', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Initialization', () => {
        test('initializes players with correct starting state', () => {
            const engine = createGame();
            expect(engine.players).toHaveLength(2);
            engine.players.forEach(p => {
                expect(p.balance).toBe(1500);
                expect(p.position).toBe(0);
                expect(p.inJail).toBe(false);
                expect(p.isBankrupt).toBe(false);
                expect(p.properties).toEqual([]);
                expect(p.getOutOfJailCards).toBe(0);
            });
        });

        test('initializes with correct number of houses and hotels', () => {
            const engine = createGame();
            expect(engine.housesAvailable).toBe(32);
            expect(engine.hotelsAvailable).toBe(12);
        });

        test('initializes all properties as unowned', () => {
            const engine = createGame();
            Object.values(engine.properties).forEach(prop => {
                expect(prop.owner).toBeNull();
                expect(prop.houses).toBe(0);
                expect(prop.hotel).toBe(0);
                expect(prop.mortgaged).toBe(false);
            });
        });
    });

    describe('Dice Rolling', () => {
        test('rolling dice moves player to correct position', () => {
            const engine = createGame();
            engine.phase = 'waiting_roll';
            mockDice(engine, 1, 2);
            engine.rollDice();
            // 1+2=3, position 3 = Turmstrasse (property, no side effects)
            expect(engine.players[0].position).toBe(3);
        });

        test('rolling doubles increments doublesCount', () => {
            const engine = createGame();
            engine.phase = 'waiting_roll';
            mockDice(engine, 3, 3);
            engine.rollDice();
            expect(engine.players[0].doublesCount).toBe(1);
        });

        test('rolling non-doubles resets doublesCount', () => {
            const engine = createGame();
            engine.players[0].doublesCount = 2;
            engine.phase = 'waiting_roll';
            mockDice(engine, 3, 4);
            engine.rollDice();
            expect(engine.players[0].doublesCount).toBe(0);
        });

        test('three doubles in a row sends player to jail', () => {
            const engine = createGame();
            engine.players[0].doublesCount = 2;
            engine.phase = 'waiting_roll';
            mockDice(engine, 3, 3);
            engine.rollDice();
            expect(engine.players[0].inJail).toBe(true);
            expect(engine.players[0].position).toBe(10);
        });
    });

    describe('Movement and Passing Go', () => {
        test('passing Go collects CHF 200', () => {
            const engine = createGame();
            engine.players[0].position = 38;
            engine.phase = 'waiting_roll';
            mockDice(engine, 3, 4);
            engine.rollDice();
            // Moved from 38 -> 5 (passed Go)
            expect(engine.players[0].position).toBe(5);
            expect(engine.players[0].balance).toBe(1700);
        });

        test('landing on Go with doubleGo rule collects CHF 400', () => {
            const engine = createGame({ rules: { doubleGo: true } });
            engine.players[0].position = 35;
            engine.phase = 'waiting_roll';
            mockDice(engine, 3, 2);
            engine.rollDice();
            expect(engine.players[0].position).toBe(0);
            expect(engine.players[0].balance).toBe(1900);
        });
    });

    describe('Buying Properties', () => {
        test('player can buy unowned property they land on', () => {
            const engine = createGame();
            const player = engine.players[0];
            player.position = 1; // Badstrasse, CHF 60
            engine.phase = 'waiting_action';
            engine.buyProperty(player);
            expect(player.balance).toBe(1440);
            expect(player.properties).toContain(1);
            expect(engine.properties[1].owner).toBe(player.id);
        });

        test('player cannot buy property they cannot afford', () => {
            const engine = createGame();
            const player = engine.players[0];
            player.position = 39; // Schlossallee, CHF 400
            player.balance = 100;
            engine.phase = 'waiting_action';
            engine.buyProperty(player);
            expect(player.balance).toBe(100);
            expect(engine.properties[39].owner).toBeNull();
        });
    });

    describe('Rent Calculation', () => {
        test('base rent for a single property', () => {
            const engine = createGame();
            engine.properties[1].owner = 'p1'; // Badstrasse, rent[0] = 2
            engine.players[0].properties.push(1);
            const rent = engine.calculateRent(1, 'p2');
            expect(rent).toBe(2);
        });

        test('double rent when owning all properties of a color', () => {
            const engine = createGame();
            // Brown group: ids 1 and 3
            engine.properties[1].owner = 'p1';
            engine.properties[3].owner = 'p1';
            engine.players[0].properties.push(1, 3);
            const rent = engine.calculateRent(1, 'p2');
            expect(rent).toBe(4); // 2 * 2
        });

        test('rent with houses', () => {
            const engine = createGame();
            engine.properties[1].owner = 'p1';
            engine.properties[3].owner = 'p1';
            engine.properties[1].houses = 2;
            engine.players[0].properties.push(1, 3);
            const rent = engine.calculateRent(1, 'p2');
            expect(rent).toBe(30); // rent[2] for Badstrasse
        });

        test('rent with hotel', () => {
            const engine = createGame();
            engine.properties[1].owner = 'p1';
            engine.properties[3].owner = 'p1';
            engine.properties[1].hotel = 1;
            engine.players[0].properties.push(1, 3);
            const rent = engine.calculateRent(1, 'p2');
            expect(rent).toBe(250); // rent[5] for Badstrasse
        });

        test('railroad rent scales with number owned', () => {
            const engine = createGame();
            // Railroads: 5, 15, 25, 35
            engine.properties[5].owner = 'p1';
            engine.players[0].properties.push(5);
            expect(engine.calculateRent(5, 'p2')).toBe(25);

            engine.properties[15].owner = 'p1';
            engine.players[0].properties.push(15);
            expect(engine.calculateRent(5, 'p2')).toBe(50);

            engine.properties[25].owner = 'p1';
            engine.players[0].properties.push(25);
            expect(engine.calculateRent(5, 'p2')).toBe(100);

            engine.properties[35].owner = 'p1';
            engine.players[0].properties.push(35);
            expect(engine.calculateRent(5, 'p2')).toBe(200);
        });

        test('utility rent with one utility owned', () => {
            const engine = createGame();
            engine.properties[12].owner = 'p1';
            engine.players[0].properties.push(12);
            engine.dice = [3, 4];
            const rent = engine.calculateRent(12, 'p2');
            expect(rent).toBe(28); // 7 * 4
        });

        test('utility rent with both utilities owned', () => {
            const engine = createGame();
            engine.properties[12].owner = 'p1';
            engine.properties[28].owner = 'p1';
            engine.players[0].properties.push(12, 28);
            engine.dice = [3, 4];
            const rent = engine.calculateRent(12, 'p2');
            expect(rent).toBe(70); // 7 * 10
        });

        test('no rent charged for mortgaged property', () => {
            const engine = createGame();
            engine.properties[1].owner = 'p1';
            engine.properties[1].mortgaged = true;
            engine.players[0].properties.push(1);
            const rent = engine.calculateRent(1, 'p2');
            expect(rent).toBe(0);
        });
    });

    describe('Jail Mechanics', () => {
        test('landing on Go To Jail sends player to jail', () => {
            const engine = createGame();
            const player = engine.players[0];
            player.position = 30; // Go To Jail
            engine.handleSpace(player);
            expect(player.position).toBe(10);
            expect(player.inJail).toBe(true);
        });

        test('rolling doubles in jail frees the player', () => {
            const engine = createGame();
            const player = engine.players[0];
            player.position = 10;
            player.inJail = true;
            engine.phase = 'waiting_roll';
            mockDice(engine, 3, 3);
            engine.rollDice();
            expect(player.inJail).toBe(false);
            expect(player.position).toBe(16); // 10 + 6
        });

        test('failing to roll doubles in jail increments jailTurns', () => {
            const engine = createGame();
            const player = engine.players[0];
            player.position = 10;
            player.inJail = true;
            engine.phase = 'waiting_roll';
            mockDice(engine, 3, 4);
            engine.rollDice();
            expect(player.inJail).toBe(true);
            expect(player.jailTurns).toBe(1);
        });

        test('after 3 failed jail rolls, player pays CHF 50 and moves', () => {
            const engine = createGame();
            const player = engine.players[0];
            player.position = 10;
            player.inJail = true;
            player.jailTurns = 2;
            engine.phase = 'waiting_roll';
            mockDice(engine, 2, 4);
            engine.rollDice();
            expect(player.inJail).toBe(false);
            expect(player.balance).toBe(1450);
            expect(player.position).toBe(16); // 10 + 6 = Münchener Strasse
        });

        test('BUG: pay_jail should work during waiting_roll phase', () => {
            const engine = createGame();
            const player = engine.players[0];
            player.position = 10;
            player.inJail = true;
            engine.phase = 'waiting_roll';
            engine.currentPlayerIndex = 0;
            
            engine.handleAction(player.id, { type: 'pay_jail' });
            
            expect(player.inJail).toBe(false);
            expect(player.balance).toBe(1450);
            // Should be able to roll after paying
            expect(engine.phase).toBe('waiting_roll');
        });

        test('BUG: use_card_jail should work during waiting_roll phase', () => {
            const engine = createGame();
            const player = engine.players[0];
            player.position = 10;
            player.inJail = true;
            player.getOutOfJailCards = 1;
            engine.phase = 'waiting_roll';
            engine.currentPlayerIndex = 0;
            
            engine.handleAction(player.id, { type: 'use_card_jail' });
            
            expect(player.inJail).toBe(false);
            expect(player.getOutOfJailCards).toBe(0);
            // Should be able to roll after using card
            expect(engine.phase).toBe('waiting_roll');
        });

        test('BUG: forced jail payment should respect freeParking rule', () => {
            const engine = createGame({ rules: { freeParking: true } });
            const player = engine.players[0];
            player.position = 10;
            player.inJail = true;
            player.jailTurns = 2;
            engine.phase = 'waiting_roll';
            mockDice(engine, 3, 4);
            engine.rollDice();
            expect(engine.freeParking).toBe(50);
        });
    });

    describe('Doubles and End Turn', () => {
        test('BUG: endTurn with doubles should trigger checkBotTurn for bot players', () => {
            const engine = createGame({
                players: [
                    { id: 'bot1', name: 'Bot1', isBot: true, difficulty: 'easy', socketId: null },
                    { id: 'p2', name: 'Bob', isBot: false, socketId: 's2' }
                ]
            });
            const bot = engine.players[0];
            bot.doublesCount = 1;
            engine.dice = [3, 3];
            engine.phase = 'waiting_action';
            engine.currentPlayerIndex = 0;
            
            // Track if checkBotTurn is called
            const checkBotSpy = jest.spyOn(engine, 'checkBotTurn');
            engine.endTurn();
            
            expect(engine.phase).toBe('waiting_roll');
            // endTurn should trigger bot turn check when granting another roll
            expect(checkBotSpy).toHaveBeenCalled();
        });

        test('rolling doubles gives another turn', () => {
            const engine = createGame();
            const player = engine.players[0];
            engine.dice = [3, 3];
            player.doublesCount = 1;
            engine.phase = 'waiting_action';
            engine.endTurn();
            expect(engine.phase).toBe('waiting_roll');
            // Same player should still be current
            expect(engine.currentPlayerIndex).toBe(0);
        });

        test('rolling non-doubles advances to next player', () => {
            const engine = createGame();
            engine.dice = [3, 4];
            engine.players[0].doublesCount = 0;
            engine.phase = 'waiting_action';
            engine.endTurn();
            expect(engine.currentPlayerIndex).toBe(1);
        });
    });

    describe('Auction', () => {
        test('auction starts with all non-bankrupt players active', () => {
            const engine = createGame();
            engine.players[0].position = 1; // Badstrasse
            engine.currentPlayerIndex = 0;
            engine.phase = 'waiting_action';
            engine.startAuction();
            expect(engine.phase).toBe('auction');
            expect(engine.auction.propertyId).toBe(1);
            expect(engine.auction.active['p1']).toBe(true);
            expect(engine.auction.active['p2']).toBe(true);
        });

        test('auction bid updates highest bid', () => {
            const engine = createGame();
            engine.players[0].position = 1;
            engine.currentPlayerIndex = 0;
            engine.startAuction();
            // After startAuction, nextAuctionTurn advances to next active player
            // Bid with the player whose turn it is in the auction
            const auctionPlayer = engine.players[engine.auction.turnIndex];
            engine.handleAuctionBid(auctionPlayer, 100);
            expect(engine.auction.highestBid).toBe(100);
            expect(engine.auction.highestBidder).toBe(auctionPlayer.id);
        });

        test('passing in auction deactivates player', () => {
            const engine = createGame();
            engine.players[0].position = 1;
            engine.currentPlayerIndex = 0;
            engine.startAuction();
            engine.handleAuctionBid(engine.players[0], -1);
            expect(engine.auction.active['p1']).toBe(false);
        });

        test('no auctions rule skips auction and ends turn', () => {
            const engine = createGame({ rules: { noAuctions: true } });
            engine.players[0].position = 1;
            engine.currentPlayerIndex = 0;
            engine.phase = 'waiting_action';
            engine.dice = [1, 1]; // non-doubles
            engine.players[0].doublesCount = 0;
            engine.startAuction();
            // Should skip auction and go to next turn
            expect(engine.phase).not.toBe('auction');
        });
    });

    describe('Building', () => {
        test('can build house when owning full color group', () => {
            const engine = createGame();
            const player = engine.players[0];
            // Brown group: 1, 3
            engine.properties[1].owner = player.id;
            engine.properties[3].owner = player.id;
            player.properties = [1, 3];
            player.balance = 500;
            engine.build(player, 1);
            expect(engine.properties[1].houses).toBe(1);
            expect(player.balance).toBe(450); // 500 - 50 houseCost
            expect(engine.housesAvailable).toBe(31);
        });

        test('cannot build house without full color group', () => {
            const engine = createGame();
            const player = engine.players[0];
            engine.properties[1].owner = 'p1';
            player.properties = [1];
            player.balance = 500;
            engine.build(player, 1);
            expect(engine.properties[1].houses).toBe(0);
            expect(player.balance).toBe(500);
        });

        test('must build evenly across color group', () => {
            const engine = createGame();
            const player = engine.players[0];
            engine.properties[1].owner = 'p1';
            engine.properties[3].owner = 'p1';
            player.properties = [1, 3];
            player.balance = 500;
            engine.properties[1].houses = 1;
            // Can't build on property 1 since property 3 has 0 houses (uneven)
            engine.build(player, 1);
            expect(engine.properties[1].houses).toBe(1);
        });

        test('upgrading to hotel returns 4 houses', () => {
            const engine = createGame();
            const player = engine.players[0];
            engine.properties[1].owner = 'p1';
            engine.properties[3].owner = 'p1';
            player.properties = [1, 3];
            player.balance = 500;
            engine.properties[1].houses = 4;
            engine.properties[3].houses = 4;
            engine.housesAvailable = 24; // 32 - 8 (4+4 on properties)
            
            engine.build(player, 1);
            expect(engine.properties[1].hotel).toBe(1);
            expect(engine.properties[1].houses).toBe(0);
            expect(engine.housesAvailable).toBe(28); // got 4 back
            expect(engine.hotelsAvailable).toBe(11);
        });

        test('cannot build on mortgaged property group', () => {
            const engine = createGame();
            const player = engine.players[0];
            engine.properties[1].owner = 'p1';
            engine.properties[3].owner = 'p1';
            engine.properties[3].mortgaged = true;
            player.properties = [1, 3];
            player.balance = 500;
            engine.build(player, 1);
            expect(engine.properties[1].houses).toBe(0);
        });
    });

    describe('Mortgage', () => {
        test('mortgaging gives player half the property price', () => {
            const engine = createGame();
            const player = engine.players[0];
            engine.properties[1].owner = 'p1';
            player.properties = [1];
            player.balance = 100;
            engine.toggleMortgage(player, 1);
            expect(engine.properties[1].mortgaged).toBe(true);
            expect(player.balance).toBe(130); // 100 + 60/2
        });

        test('unmortgaging costs 110% of half price', () => {
            const engine = createGame();
            const player = engine.players[0];
            engine.properties[1].owner = 'p1';
            engine.properties[1].mortgaged = true;
            player.properties = [1];
            player.balance = 100;
            engine.toggleMortgage(player, 1);
            expect(engine.properties[1].mortgaged).toBe(false);
            expect(player.balance).toBe(67); // 100 - floor(30 * 1.1) = 100 - 33
        });

        test('cannot mortgage property with buildings in color group', () => {
            const engine = createGame();
            const player = engine.players[0];
            engine.properties[1].owner = 'p1';
            engine.properties[3].owner = 'p1';
            engine.properties[1].houses = 1;
            player.properties = [1, 3];
            player.balance = 100;
            engine.toggleMortgage(player, 3);
            expect(engine.properties[3].mortgaged).toBe(false);
        });
    });

    describe('Bankruptcy', () => {
        test('bankrupt player transfers properties to creditor', () => {
            const engine = createGame();
            const player = engine.players[0];
            const creditor = engine.players[1];
            engine.properties[1].owner = 'p1';
            engine.properties[3].owner = 'p1';
            player.properties = [1, 3];
            engine.bankruptPlayer(player, 'p2');
            expect(player.isBankrupt).toBe(true);
            expect(engine.properties[1].owner).toBe('p2');
            expect(engine.properties[3].owner).toBe('p2');
            expect(creditor.properties).toContain(1);
            expect(creditor.properties).toContain(3);
        });

        test('bankrupt to bank clears properties', () => {
            const engine = createGame({
                players: [
                    { id: 'p1', name: 'Alice', isBot: false, socketId: 's1' },
                    { id: 'p2', name: 'Bob', isBot: false, socketId: 's2' },
                    { id: 'p3', name: 'Carol', isBot: false, socketId: 's3' }
                ]
            });
            const player = engine.players[0];
            engine.properties[1].owner = 'p1';
            engine.properties[1].houses = 2;
            player.properties = [1];
            engine.housesAvailable = 30;
            engine.bankruptPlayer(player, null);
            expect(engine.properties[1].owner).toBeNull();
            expect(engine.properties[1].houses).toBe(0);
            expect(engine.housesAvailable).toBe(32); // got 2 houses back
        });

        test('last player standing wins', () => {
            const engine = createGame();
            const p1 = engine.players[0];
            const p2 = engine.players[1];
            engine.bankruptPlayer(p1, p2.id);
            expect(engine.winner).toBe(p2.id);
            expect(engine.phase).toBe('gameover');
        });
    });

    describe('Card Drawing', () => {
        test('advance card moves player to target position', () => {
            const engine = createGame();
            const player = engine.players[0];
            player.position = 7;
            const deck = [{ id: 'test', text: 'Advance to Go', action: 'advance', target: 0 }];
            engine.drawCard(player, deck, 'chance');
            expect(player.position).toBe(0);
        });

        test('advance card collects CHF 200 when passing Go', () => {
            const engine = createGame();
            const player = engine.players[0];
            player.position = 36; // Chance space
            const deck = [{ id: 'test', text: 'Advance to Südbahnhof', action: 'advance', target: 5 }];
            engine.drawCard(player, deck, 'chance');
            expect(player.position).toBe(5);
            expect(player.balance).toBe(1700); // 1500 + 200
        });

        test('BUG: advance card should respect doubleGo rule', () => {
            const engine = createGame({ rules: { doubleGo: true } });
            const player = engine.players[0];
            player.position = 36;
            const deck = [{ id: 'test', text: 'Advance to Go', action: 'advance', target: 0 }];
            engine.drawCard(player, deck, 'chance');
            expect(player.position).toBe(0);
            // With doubleGo, landing on Go should pay 400
            expect(player.balance).toBe(1900);
        });

        test('go to jail card sends player to jail', () => {
            const engine = createGame();
            const player = engine.players[0];
            player.position = 7;
            const deck = [{ id: 'test', text: 'Go to Jail', action: 'gotojail' }];
            engine.drawCard(player, deck, 'chance');
            expect(player.position).toBe(10);
            expect(player.inJail).toBe(true);
        });

        test('get out of jail card increments card count', () => {
            const engine = createGame();
            const player = engine.players[0];
            const deck = [{ id: 'test', text: 'Get Out of Jail Free', action: 'get_out_of_jail' }];
            engine.drawCard(player, deck, 'chance');
            expect(player.getOutOfJailCards).toBe(1);
        });

        test('pay_money card deducts from player', () => {
            const engine = createGame();
            const player = engine.players[0];
            const deck = [{ id: 'test', text: 'Pay CHF 50', action: 'pay_money', amount: 50 }];
            engine.drawCard(player, deck, 'chance');
            expect(player.balance).toBe(1450);
        });

        test('add_money card adds to player', () => {
            const engine = createGame();
            const player = engine.players[0];
            const deck = [{ id: 'test', text: 'Receive CHF 50', action: 'add_money', amount: 50 }];
            engine.drawCard(player, deck, 'chance');
            expect(player.balance).toBe(1550);
        });

        test('repairs card calculates cost from houses and hotels', () => {
            const engine = createGame();
            const player = engine.players[0];
            engine.properties[1].owner = 'p1';
            engine.properties[1].houses = 3;
            engine.properties[3].owner = 'p1';
            engine.properties[3].hotel = 1;
            player.properties = [1, 3];
            const deck = [{ id: 'test', text: 'Repairs', action: 'repairs', houseCost: 25, hotelCost: 100 }];
            engine.drawCard(player, deck, 'chance');
            // 3 houses * 25 + 1 hotel * 100 = 175
            expect(player.balance).toBe(1325);
        });

        test('pay_players card pays all other players', () => {
            const engine = createGame();
            const player = engine.players[0];
            const deck = [{ id: 'test', text: 'Pay each player CHF 50', action: 'pay_players', amount: 50 }];
            engine.drawCard(player, deck, 'chance');
            expect(player.balance).toBe(1450); // paid 50 to other player
            expect(engine.players[1].balance).toBe(1550);
        });

        test('collect_from_players card collects from all other players', () => {
            const engine = createGame();
            const player = engine.players[0];
            const deck = [{ id: 'test', text: 'Birthday! Collect CHF 10 from each', action: 'collect_from_players', amount: 10 }];
            engine.drawCard(player, deck, 'chance');
            expect(player.balance).toBe(1510);
            expect(engine.players[1].balance).toBe(1490);
        });

        test('move card (go back 3 spaces) works correctly', () => {
            const engine = createGame();
            const player = engine.players[0];
            player.position = 7; // Chance
            const deck = [{ id: 'test', text: 'Go Back 3 Spaces', action: 'move', amount: -3 }];
            engine.drawCard(player, deck, 'chance');
            expect(player.position).toBe(4); // Income Tax
        });

        test('advance_nearest_railroad finds nearest railroad', () => {
            const engine = createGame();
            const player = engine.players[0];
            player.position = 7; // Chance (between Südbahnhof:5 and Westbahnhof:15)
            // The nearest railroad forward from 7 is position 15 (Westbahnhof)
            const deck = [{ id: 'test', text: 'Advance to nearest Railroad', action: 'advance_railroad' }];
            engine.drawCard(player, deck, 'chance');
            expect(player.position).toBe(15);
        });

        test('BUG: advance_railroad card should charge double rent', () => {
            const engine = createGame();
            const player = engine.players[0]; // p1
            const owner = engine.players[1]; // p2
            player.position = 7; // Chance
            // owner (p2) owns Westbahnhof (15)
            engine.properties[15].owner = owner.id;
            owner.properties.push(15);
            
            // Spy on payMoney to check what rent was charged
            const payMoneySpy = jest.spyOn(engine, 'payMoney');
            
            const deck = [{ id: 'test', text: 'Advance to nearest Railroad', action: 'advance_railroad' }];
            engine.drawCard(player, deck, 'chance');
            
            // Normal railroad rent with 1 owned = 25, card says double = 50
            expect(payMoneySpy).toHaveBeenCalledWith(player, 50, owner.id);
        });

        test('BUG: advance_utility card should always use 10x multiplier', () => {
            const engine = createGame();
            const player = engine.players[0]; // p1
            const owner = engine.players[1]; // p2
            player.position = 7; // Chance
            // owner (p2) owns Elektrizitätswerk (12) but NOT Wasserwerk (28)
            engine.properties[12].owner = owner.id;
            owner.properties.push(12);
            engine.dice = [3, 4]; // sum = 7
            
            const payMoneySpy = jest.spyOn(engine, 'payMoney');
            
            const deck = [{ id: 'test', text: 'Advance to nearest Utility', action: 'advance_utility' }];
            engine.drawCard(player, deck, 'chance');
            
            // Card says 10x the dice roll, not normal 4x for single utility
            expect(payMoneySpy).toHaveBeenCalledWith(player, 70, owner.id);
        });
    });

    describe('Trading', () => {
        test('trade proposal sets phase to trade', () => {
            const engine = createGame();
            engine.phase = 'waiting_action';
            engine.properties[1].owner = 'p1';
            engine.players[0].properties = [1];
            engine.proposeTrade(engine.players[0], {
                to: 'p2',
                offerProps: [1],
                offerMoney: 0,
                requestProps: [],
                requestMoney: 100
            });
            expect(engine.phase).toBe('trade');
            expect(engine.trade).not.toBeNull();
        });

        test('accepted trade swaps properties and money', () => {
            const engine = createGame();
            engine.phase = 'waiting_action';
            engine.properties[1].owner = 'p1';
            engine.properties[5].owner = 'p2';
            engine.players[0].properties = [1];
            engine.players[1].properties = [5];
            engine.trade = {
                from: 'p1',
                to: 'p2',
                offerProps: [1],
                offerMoney: 50,
                requestProps: [5],
                requestMoney: 0
            };
            engine.phase = 'trade';
            engine.handleTradeResponse(true);
            expect(engine.properties[1].owner).toBe('p2');
            expect(engine.properties[5].owner).toBe('p1');
            expect(engine.players[0].balance).toBe(1450); // paid 50
            expect(engine.players[1].balance).toBe(1550); // received 50
        });

        test('declined trade returns to waiting_action', () => {
            const engine = createGame();
            engine.trade = { from: 'p1', to: 'p2', offerMoney: 0, offerProps: [], requestMoney: 0, requestProps: [] };
            engine.phase = 'trade';
            engine.handleTradeResponse(false);
            expect(engine.phase).toBe('waiting_action');
            expect(engine.trade).toBeNull();
        });
    });

    describe('Free Parking Rule', () => {
        test('tax money goes to free parking pot when rule enabled', () => {
            const engine = createGame({ rules: { freeParking: true } });
            const player = engine.players[0];
            player.position = 4; // Income Tax, CHF 200
            engine.handleSpace(player);
            expect(engine.freeParking).toBe(200);
        });

        test('landing on free parking collects pot when rule enabled', () => {
            const engine = createGame({ rules: { freeParking: true } });
            const player = engine.players[0];
            engine.freeParking = 500;
            player.position = 20; // Free Parking
            engine.handleSpace(player);
            expect(player.balance).toBe(2000);
            expect(engine.freeParking).toBe(0);
        });
    });

    describe('Bot Integration', () => {
        test('bot rolls dice on its turn', () => {
            const engine = createGame({
                players: [
                    { id: 'bot1', name: 'Bot1', isBot: true, difficulty: 'easy', socketId: null },
                    { id: 'p2', name: 'Bob', isBot: false, socketId: 's2' }
                ]
            });
            engine.phase = 'waiting_roll';
            engine.currentPlayerIndex = 0;
            const handleActionSpy = jest.spyOn(engine, 'handleAction');
            
            // Directly call bot's playTurn
            engine.bots['bot1'].playTurn();
            
            expect(handleActionSpy).toHaveBeenCalledWith('bot1', { type: 'roll' });
        });

        test('BUG: medium bot in jail should be able to pay jail fine', () => {
            const engine = createGame({
                players: [
                    { id: 'bot1', name: 'Bot1', isBot: true, difficulty: 'medium', socketId: null },
                    { id: 'p2', name: 'Bob', isBot: false, socketId: 's2' }
                ]
            });
            // Constructor puts humans first: [p2, bot1]
            const botIndex = engine.players.findIndex(p => p.id === 'bot1');
            const bot = engine.players[botIndex];
            bot.position = 10;
            bot.inJail = true;
            bot.balance = 500;
            engine.phase = 'waiting_roll';
            engine.currentPlayerIndex = botIndex;
            
            // Bot tries pay_jail during waiting_roll - this should work
            engine.bots['bot1'].playTurn();
            
            // After the action, the bot should have paid and be free
            expect(bot.inJail).toBe(false);
            expect(bot.balance).toBe(450);
        });
    });

    describe('Disconnection and Reconnection', () => {
        test('disconnected player is replaced by bot', () => {
            const engine = createGame();
            engine.handleDisconnect('p1');
            expect(engine.players[0].isBot).toBe(true);
            expect(engine.players[0].botDifficulty).toBe('medium');
        });

        test('reconnected player is restored from bot', () => {
            const engine = createGame();
            const p1 = getPlayer(engine, 'p1');
            engine.handleDisconnect('p1');
            engine.handleReconnect('p1', 'newSocket');
            expect(p1.isBot).toBe(false);
            expect(p1.socketId).toBe('newSocket');
        });
    });
});
