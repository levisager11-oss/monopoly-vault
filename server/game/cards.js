const chanceCards = [
    { id: "c1", text: "Advance to Go (Collect CHF 200)", action: "advance", target: 0 },
    { id: "c2", text: "Advance to Schlossallee", action: "advance", target: 39 },
    { id: "c3", text: "Advance to the nearest Utility. If unowned, you may buy it from the Bank. If owned, throw dice and pay owner a total 10 times the amount thrown.", action: "advance_utility" },
    { id: "c4", text: "Advance to the nearest Railroad. If unowned, you may buy it from the Bank. If owned, pay owner twice the rental to which they are otherwise entitled.", action: "advance_railroad" },
    { id: "c5", text: "Advance to the nearest Railroad. If unowned, you may buy it from the Bank. If owned, pay owner twice the rental to which they are otherwise entitled.", action: "advance_railroad" },
    { id: "c6", text: "Bank pays you dividend of CHF 50", action: "add_money", amount: 50 },
    { id: "c7", text: "Get Out of Jail Free", action: "get_out_of_jail" },
    { id: "c8", text: "Go Back 3 Spaces", action: "move", amount: -3 },
    { id: "c9", text: "Go to Jail. Go directly to Jail, do not pass Go, do not collect CHF 200", action: "gotojail" },
    { id: "c10", text: "Make general repairs on all your property. For each house pay CHF 25. For each hotel pay CHF 100", action: "repairs", houseCost: 25, hotelCost: 100 },
    { id: "c11", text: "Speeding fine CHF 15", action: "pay_money", amount: 15 },
    { id: "c12", text: "Take a trip to Südbahnhof. If you pass Go, collect CHF 200", action: "advance", target: 5 },
    { id: "c13", text: "You have been elected Chairman of the Board. Pay each player CHF 50", action: "pay_players", amount: 50 },
    { id: "c14", text: "Your building loan matures. Collect CHF 150", action: "add_money", amount: 150 },
    { id: "c15", text: "Advance to Seestrasse. If you pass Go, collect CHF 200", action: "advance", target: 11 },
    { id: "c16", text: "Advance to Opernplatz. If you pass Go, collect CHF 200", action: "advance", target: 24 }
];

const communityChestCards = [
    { id: "cc1", text: "Advance to Go (Collect CHF 200)", action: "advance", target: 0 },
    { id: "cc2", text: "Bank error in your favor. Collect CHF 200", action: "add_money", amount: 200 },
    { id: "cc3", text: "Doctor's fee. Pay CHF 50", action: "pay_money", amount: 50 },
    { id: "cc4", text: "From sale of stock you get CHF 50", action: "add_money", amount: 50 },
    { id: "cc5", text: "Get Out of Jail Free", action: "get_out_of_jail" },
    { id: "cc6", text: "Go to Jail. Go directly to jail, do not pass Go, do not collect CHF 200", action: "gotojail" },
    { id: "cc7", text: "Holiday fund matures. Receive CHF 100", action: "add_money", amount: 100 },
    { id: "cc8", text: "Income tax refund. Collect CHF 20", action: "add_money", amount: 20 },
    { id: "cc9", text: "It is your birthday. Collect CHF 10 from every player", action: "collect_from_players", amount: 10 },
    { id: "cc10", text: "Life insurance matures. Collect CHF 100", action: "add_money", amount: 100 },
    { id: "cc11", text: "Pay hospital fees of CHF 100", action: "pay_money", amount: 100 },
    { id: "cc12", text: "Pay school fees of CHF 50", action: "pay_money", amount: 50 },
    { id: "cc13", text: "Receive CHF 25 consultancy fee", action: "add_money", amount: 25 },
    { id: "cc14", text: "You are assessed for street repairs. CHF 40 per house. CHF 115 per hotel", action: "repairs", houseCost: 40, hotelCost: 115 },
    { id: "cc15", text: "You have won second prize in a beauty contest. Collect CHF 10", action: "add_money", amount: 10 },
    { id: "cc16", text: "You inherit CHF 100", action: "add_money", amount: 100 }
];

module.exports = { chanceCards, communityChestCards };