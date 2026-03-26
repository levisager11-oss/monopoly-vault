const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'monopoly.db');

const mode = process.argv[2];

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

db.serialize(() => {
  if (mode === 'all') {
    console.log('Clearing ALL data (users and stats)...');
    db.run('DELETE FROM stats');
    db.run('DELETE FROM users', () => {
      db.run('DELETE FROM sqlite_sequence WHERE name IN ("users", "stats")');
      console.log('Database wiped successfully.');
    });
  } else if (mode === 'stats') {
    console.log('Clearing STATS data only...');
    db.run('DELETE FROM stats', () => {
      console.log('Stats table wiped successfully.');
    });
  } else if (mode === 'users') {
    console.log('Clearing USERS and associated STATS...');
    db.run('DELETE FROM stats');
    db.run('DELETE FROM users', () => {
      db.run('DELETE FROM sqlite_sequence WHERE name IN ("users", "stats")');
      console.log('Users and stats wiped successfully.');
    });
  } else {
    console.log('Usage: node clear.js [all|stats|users]');
  }
});

db.close();
