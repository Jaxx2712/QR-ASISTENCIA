const express = require('express');
const { createClient } = require('@libsql/client');
require('dotenv').config();
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Database setup con Turso / LibSQL
const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initDB() {
    try {
        await db.execute(`CREATE TABLE IF NOT EXISTS workers (
            dni TEXT PRIMARY KEY,
            nombre TEXT NOT NULL,
            cargo TEXT DEFAULT '',
            empresa TEXT DEFAULT '',
            foto TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        try {
            await db.execute(`ALTER TABLE workers ADD COLUMN foto TEXT DEFAULT ''`);
        } catch (e) {
            // Ignorar si la columna ya existe
        }

        await db.execute(`CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            worker_dni TEXT NOT NULL,
            tipo TEXT NOT NULL CHECK(tipo IN ('Entrada','Salida')),
            fecha DATE NOT NULL,
            hora TIME NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(worker_dni) REFERENCES workers(dni)
        )`);

        console.log('Connected to Turso database and initialized tables.');
    } catch (err) {
        console.error('Error initializing database:', err.message);
    }
}

initDB();

function getLocalTime() {
    const now = new Date();
    const options = { timeZone: 'America/Lima' };
    const fecha = now.toLocaleDateString('en-CA', options); // YYYY-MM-DD
    const hora = now.toLocaleTimeString('en-GB', options);   // HH:MM:SS
    return { fecha, hora };
}

// Routes

// POST /api/workers - Register a worker
app.post('/api/workers', async (req, res) => {
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

    try {
        await db.execute({
            sql: `INSERT INTO workers (dni, nombre, cargo, empresa, foto) VALUES (?, ?, ?, ?, ?)`,
            args: [dni, nombre, cargo, empresa, foto]
        });
        res.json({ success: true, message: 'Trabajador registrado exitosamente.' });
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ success: false, message: 'Trabajador ya existe.' });
        }
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/workers - Get all workers
app.get('/api/workers', async (req, res) => {
    try {
        const result = await db.execute(`SELECT * FROM workers ORDER BY nombre`);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/workers/:dni - Get single worker
app.get('/api/workers/:dni', async (req, res) => {
    try {
        const result = await db.execute({
            sql: `SELECT * FROM workers WHERE dni = ?`,
            args: [req.params.dni]
        });
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Trabajador no encontrado' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// DELETE /api/workers/:dni - Delete worker and their attendance
app.delete('/api/workers/:dni', async (req, res) => {
    try {
        await db.batch([
            {
                sql: `DELETE FROM attendance WHERE worker_dni = ?`,
                args: [req.params.dni]
            },
            {
                sql: `DELETE FROM workers WHERE dni = ?`,
                args: [req.params.dni]
            }
        ]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/attendance - Record attendance
app.post('/api/attendance', async (req, res) => {
    const { worker_dni, tipo } = req.body;
    if (!worker_dni || !tipo || !['Entrada', 'Salida'].includes(tipo)) {
        return res.status(400).json({ success: false, message: 'Invalid data' });
    }

    try {
        const workerResult = await db.execute({
            sql: `SELECT nombre FROM workers WHERE dni = ?`,
            args: [worker_dni]
        });

        if (workerResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Trabajador no encontrado' });
        }

        const worker = workerResult.rows[0];
        const { fecha, hora } = getLocalTime();

        await db.execute({
            sql: `INSERT INTO attendance (worker_dni, tipo, fecha, hora) VALUES (?, ?, ?, ?)`,
            args: [worker_dni, tipo, fecha, hora]
        });

        res.json({ success: true, nombre: worker.nombre, tipo, fecha, hora });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/attendance/:dni - Get attendance for a specific worker
app.get('/api/attendance/:dni', async (req, res) => {
    let month = req.query.month;
    if (!month) {
        const { fecha } = getLocalTime();
        month = fecha.substring(0, 7); // YYYY-MM
    }
    
    try {
        const result = await db.execute({
            sql: `SELECT * FROM attendance WHERE worker_dni = ? AND fecha LIKE ? ORDER BY timestamp DESC`,
            args: [req.params.dni, `${month}%`]
        });
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/attendance - Get all recent attendance
app.get('/api/attendance', async (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    try {
        const result = await db.execute({
            sql: `SELECT a.*, w.nombre FROM attendance a JOIN workers w ON a.worker_dni = w.dni ORDER BY a.timestamp DESC LIMIT ?`,
            args: [limit]
        });
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/dashboard - Dashboard stats
app.get('/api/dashboard', async (req, res) => {
    const { fecha } = getLocalTime();
    
    try {
        const totalWorkersRes = await db.execute(`SELECT COUNT(*) as count FROM workers`);
        const totalWorkers = Number(totalWorkersRes.rows[0]?.count || 0);

        const attendanceTodayRes = await db.execute({
            sql: `SELECT COUNT(*) as count FROM attendance WHERE fecha = ?`,
            args: [fecha]
        });
        const attendanceToday = Number(attendanceTodayRes.rows[0]?.count || 0);

        const workersPresentRes = await db.execute({
            sql: `
                SELECT COUNT(*) as count 
                FROM (
                    SELECT worker_dni, tipo, 
                            ROW_NUMBER() OVER(PARTITION BY worker_dni ORDER BY timestamp DESC) as rn 
                    FROM attendance 
                    WHERE fecha = ?
                ) 
                WHERE rn = 1 AND tipo = 'Entrada'
            `,
            args: [fecha]
        });
        const workersPresent = Number(workersPresentRes.rows[0]?.count || 0);

        res.json({ totalWorkers, attendanceToday, workersPresent });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
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