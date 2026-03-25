const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/leaderboard', (req, res) => {
  const query = `
    SELECT u.username, s.games_played, s.games_won, s.total_money_earned, s.bankruptcies,
           CASE WHEN s.games_played > 0 THEN (CAST(s.games_won AS FLOAT) / s.games_played) * 100 ELSE 0 END as win_rate
    FROM stats s
    JOIN users u ON s.user_id = u.id
    WHERE s.games_played >= 5
    ORDER BY win_rate DESC
    LIMIT 10
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

router.get('/me', (req, res) => {
  // Extract user ID from token header (basic implementation, assuming token verified in middleware later if needed, but here we just decode)
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });
  
  const token = authHeader.split(' ')[1];
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, 'super-secret-key-for-local-monopoly');
    
    db.get(`SELECT u.username, s.* FROM stats s JOIN users u ON s.user_id = u.id WHERE s.user_id = ?`, [decoded.userId], (err, row) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!row) return res.status(404).json({ error: 'Stats not found' });
      res.json(row);
    });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
