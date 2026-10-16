const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const os = require('os');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Enable CORS
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Database setup
const db = new sqlite3.Database(path.join(__dirname, 'asistencia.db'), (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initDB();
    }
});

function initDB() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS workers (
            dni TEXT PRIMARY KEY,
            nombre TEXT NOT NULL,
            cargo TEXT DEFAULT '',
            empresa TEXT DEFAULT '',
            foto TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, () => {
            db.run(`ALTER TABLE workers ADD COLUMN foto TEXT DEFAULT ''`, (err) => {});
        });

        db.run(`CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            worker_dni TEXT NOT NULL,
            tipo TEXT NOT NULL CHECK(tipo IN ('Entrada','Salida')),
            fecha DATE NOT NULL,
            hora TIME NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(worker_dni) REFERENCES workers(dni)
        )`);
    });
}

function getLocalTime() {
    const now = new Date();
    const options = { timeZone: 'America/Lima' };
    const fecha = now.toLocaleDateString('en-CA', options); // YYYY-MM-DD
    const hora = now.toLocaleTimeString('en-GB', options);   // HH:MM:SS
    return { fecha, hora };
}

// Routes

// POST /api/workers - Register a worker
app.post('/api/workers', (req, res) => {
    const { dni, nombre, cargo = '', empresa = '', foto = '' } = req.body;
    
    if (!dni || !nombre) {
        return res.status(400).json({ success: false, message: 'DNI and nombre are required' });
    }
    
    // Strict validations
    if (!/^\d{8}$/.test(dni)) {
        return res.status(400).json({ success: false, message: 'El DNI debe contener exactamente 8 números.' });
    }
    if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/.test(nombre)) {
        return res.status(400).json({ success: false, message: 'El nombre solo puede contener letras y espacios.' });
    }

    db.run(
        `INSERT INTO workers (dni, nombre, cargo, empresa, foto) VALUES (?, ?, ?, ?, ?)`,
        [dni, nombre, cargo, empresa, foto],
        function (err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(409).json({ success: false, message: 'Trabajador ya existe.' });
                }
                return res.status(500).json({ success: false, message: err.message });
            }
            res.json({ success: true, message: 'Trabajador registrado exitosamente.' });
        }
    );
});

// GET /api/workers - Get all workers
app.get('/api/workers', (req, res) => {
    db.all(`SELECT * FROM workers ORDER BY nombre`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json(rows);
    });
});

// GET /api/workers/:dni - Get single worker
app.get('/api/workers/:dni', (req, res) => {
    db.get(`SELECT * FROM workers WHERE dni = ?`, [req.params.dni], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (!row) return res.status(404).json({ success: false, message: 'Trabajador no encontrado' });
        res.json(row);
    });
});

// DELETE /api/workers/:dni - Delete worker and their attendance
app.delete('/api/workers/:dni', (req, res) => {
    db.serialize(() => {
        db.run(`BEGIN TRANSACTION`);
        db.run(`DELETE FROM attendance WHERE worker_dni = ?`, [req.params.dni]);
        db.run(`DELETE FROM workers WHERE dni = ?`, [req.params.dni], function(err) {
            if (err) {
                db.run(`ROLLBACK`);
                return res.status(500).json({ success: false, message: err.message });
            }
            db.run(`COMMIT`);
            res.json({ success: true });
        });
    });
});

// POST /api/attendance - Record attendance
app.post('/api/attendance', (req, res) => {
    const { worker_dni, tipo } = req.body;
    if (!worker_dni || !tipo || !['Entrada', 'Salida'].includes(tipo)) {
        return res.status(400).json({ success: false, message: 'Invalid data' });
    }

    db.get(`SELECT nombre FROM workers WHERE dni = ?`, [worker_dni], (err, worker) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (!worker) return res.status(404).json({ success: false, message: 'Trabajador no encontrado' });

        const { fecha, hora } = getLocalTime();
        db.run(
            `INSERT INTO attendance (worker_dni, tipo, fecha, hora) VALUES (?, ?, ?, ?)`,
            [worker_dni, tipo, fecha, hora],
            function (err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true, nombre: worker.nombre, tipo, fecha, hora });
            }
        );
    });
});

// GET /api/attendance/:dni - Get attendance for a specific worker
app.get('/api/attendance/:dni', (req, res) => {
    let month = req.query.month;
    if (!month) {
        const { fecha } = getLocalTime();
        month = fecha.substring(0, 7); // YYYY-MM
    }
    
    db.all(
        `SELECT * FROM attendance WHERE worker_dni = ? AND fecha LIKE ? ORDER BY timestamp DESC`,
        [req.params.dni, `${month}%`],
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json(rows);
        }
    );
});

// GET /api/attendance - Get all recent attendance
app.get('/api/attendance', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    db.all(
        `SELECT a.*, w.nombre FROM attendance a JOIN workers w ON a.worker_dni = w.dni ORDER BY a.timestamp DESC LIMIT ?`,
        [limit],
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json(rows);
        }
    );
});

// GET /api/dashboard - Dashboard stats
app.get('/api/dashboard', (req, res) => {
    const { fecha } = getLocalTime();
    
    db.serialize(() => {
        let totalWorkers = 0;
        let attendanceToday = 0;
        let workersPresent = 0;
        
        db.get(`SELECT COUNT(*) as count FROM workers`, (err, row) => {
            if (!err) totalWorkers = row.count;
            
            db.get(`SELECT COUNT(*) as count FROM attendance WHERE fecha = ?`, [fecha], (err, row) => {
                if (!err) attendanceToday = row.count;
                
                db.get(`
                    SELECT COUNT(*) as count 
                    FROM (
                        SELECT worker_dni, tipo, 
                               ROW_NUMBER() OVER(PARTITION BY worker_dni ORDER BY timestamp DESC) as rn 
                        FROM attendance 
                        WHERE fecha = ?
                    ) 
                    WHERE rn = 1 AND tipo = 'Entrada'
                `, [fecha], (err, row) => {
                    if (!err) workersPresent = row.count;
                    
                    res.json({ totalWorkers, attendanceToday, workersPresent });
                });
            });
        });
    });
});

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return 'localhost';
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Local: http://localhost:${PORT}`);
    console.log(`Network: http://${getLocalIP()}:${PORT}`);
});