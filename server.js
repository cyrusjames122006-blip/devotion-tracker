const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('public'));

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('Error:', err.message);
    else console.log('Connected to SQLite database.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        address TEXT NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS devotions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        user_name TEXT,
        date TEXT NOT NULL,
        scripture TEXT,
        observation TEXT,
        application TEXT,
        prayer_request TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        meeting_date TEXT NOT NULL,
        meeting_time TEXT NOT NULL,
        meeting_link TEXT,
        created_by TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        schedule_id INTEGER,
        user_id INTEGER,
        user_name TEXT,
        status TEXT NOT NULL,
        reason TEXT
    )`);

    // Default Admin Account: admin / admin123
    const adminName = 'admin';
    db.get(`SELECT * FROM users WHERE name = ?`, [adminName], async (err, row) => {
        if (!row) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            db.run(`INSERT INTO users (name, address, password, role) VALUES (?, ?, ?, ?)`,
                [adminName, 'Main Office', hashedPassword, 'admin']
            );
        }
    });

    console.log('Database tables ready.');
});

// Register
app.post('/api/register', async (req, res) => {
    const { name, address, password } = req.body;
    if (!name || !address || !password) return res.status(400).json({ error: 'Kailangan tapusin ang lahat ng fields!' });

    if (name.toLowerCase() === 'admin') {
        return res.status(400).json({ error: 'Bawal gamitin ang pangalang admin!' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (name, address, password, role) VALUES (?, ?, ?, 'user')`, 
            [name, address, hashedPassword], 
            function (err) {
                if (err) return res.status(400).json({ error: 'May nagmamay-ari na ng pangalang ito.' });
                res.json({ message: 'Registration successful!' });
            }
        );
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
});

// Login
app.post('/api/login', (req, res) => {
    const { name, password } = req.body;
    db.get(`SELECT * FROM users WHERE name = ?`, [name], async (err, user) => {
        if (err || !user) return res.status(400).json({ error: 'Hindi nahanap ang user!' });

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ error: 'Maling password!' });

        res.json({
            message: 'Login successful!',
            user: { id: user.id, name: user.name, address: user.address, role: user.role }
        });
    });
});

// Submit/Post Devotion
app.post('/api/devotions', (req, res) => {
    const { user_id, user_name, date, scripture, observation, application, prayer_request } = req.body;
    db.run(
        `INSERT INTO devotions (user_id, user_name, date, scripture, observation, application, prayer_request) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [user_id, user_name, date, scripture, observation, application, prayer_request],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Matagumpay na nai-submit at nai-post ang iyong Devotion!' });
        }
    );
});

// Get Devotions para sa Specific User
app.get('/api/devotions/:userId', (req, res) => {
    db.all(`SELECT * FROM devotions WHERE user_id = ? ORDER BY id DESC`, [req.params.userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Community Devotion Status (Names & Dates Only)
app.get('/api/community/devotions-status', (req, res) => {
    const query = `SELECT DISTINCT user_id, user_name, date FROM devotions ORDER BY id DESC`;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Get ALL Unique Users na Nag-submit ng Devotion (Para sa Admin Dashboard)
app.get('/api/admin/devoting-users', (req, res) => {
    const query = `SELECT DISTINCT user_id, user_name FROM devotions WHERE user_name IS NOT NULL AND user_name != ''`;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Add Schedule
app.post('/api/schedules', (req, res) => {
    const { title, meeting_date, meeting_time, meeting_link, created_by } = req.body;
    db.run(
        `INSERT INTO schedules (title, meeting_date, meeting_time, meeting_link, created_by) VALUES (?, ?, ?, ?, ?)`,
        [title, meeting_date, meeting_time, meeting_link, created_by],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Meeting schedule published!' });
        }
    );
});

// Get Schedules
app.get('/api/schedules', (req, res) => {
    db.all(`SELECT * FROM schedules ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Delete Schedule (Admin Only)
app.delete('/api/schedules/:id', (req, res) => {
    const scheduleId = req.params.id;
    db.run(`DELETE FROM schedules WHERE id = ?`, [scheduleId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        db.run(`DELETE FROM attendance WHERE schedule_id = ?`, [scheduleId]);
        res.json({ message: 'Schedule deleted successfully!' });
    });
});

// Submit Attendance / RSVP
app.post('/api/attendance', (req, res) => {
    const { schedule_id, user_id, user_name, status, reason } = req.body;
    db.get(`SELECT * FROM attendance WHERE schedule_id = ? AND user_id = ?`, [schedule_id, user_id], (err, row) => {
        if (row) {
            db.run(`UPDATE attendance SET status = ?, reason = ? WHERE schedule_id = ? AND user_id = ?`,
                [status, reason || '', schedule_id, user_id],
                function (err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ message: 'Attendance updated!' });
                }
            );
        } else {
            db.run(`INSERT INTO attendance (schedule_id, user_id, user_name, status, reason) VALUES (?, ?, ?, ?, ?)`,
                [schedule_id, user_id, user_name, status, reason || ''],
                function (err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ message: 'Attendance submitted!' });
                }
            );
        }
    });
});

// Get Attendance for a schedule
app.get('/api/attendance/:scheduleId', (req, res) => {
    db.all(`SELECT * FROM attendance WHERE schedule_id = ?`, [req.params.scheduleId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.listen(PORT, () => console.log(`Server is running at http://localhost:${PORT}`));