const express = require('express');
const { createClient } = require('@libsql/client');
require('dotenv').config();
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://unpkg.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data: blob:; connect-src 'self'");
    next();
});

// Simple rate limiting (per IP, max 100 requests per minute)
const rateLimitMap = new Map();
app.use((req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = 60000;
    const maxRequests = 100;

    if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, []);
    }
    const timestamps = rateLimitMap.get(ip).filter(t => now - t < windowMs);
    timestamps.push(now);
    rateLimitMap.set(ip, timestamps);

    if (timestamps.length > maxRequests) {
        return res.status(429).json({ success: false, message: 'Demasiadas solicitudes. Intenta más tarde.' });
    }
    next();
});

// Clean old rate limit entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of rateLimitMap) {
        const filtered = timestamps.filter(t => now - t < 60000);
        if (filtered.length === 0) rateLimitMap.delete(ip);
        else rateLimitMap.set(ip, filtered);
    }
}, 300000);

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
    const dni = req.params.dni;
    if (!/^\d{8}$/.test(dni)) {
        return res.status(400).json({ success: false, message: 'DNI inválido.' });
    }
    try {
        const result = await db.execute({
            sql: `SELECT * FROM workers WHERE dni = ?`,
            args: [dni]
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
    const dni = req.params.dni;
    if (!/^\d{8}$/.test(dni)) {
        return res.status(400).json({ success: false, message: 'DNI inválido.' });
    }
    try {
        await db.batch([
            {
                sql: `DELETE FROM attendance WHERE worker_dni = ?`,
                args: [dni]
            },
            {
                sql: `DELETE FROM workers WHERE dni = ?`,
                args: [dni]
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
        return res.status(400).json({ success: false, message: 'Datos inválidos.' });
    }
    if (!/^\d{8}$/.test(worker_dni)) {
        return res.status(400).json({ success: false, message: 'DNI inválido.' });
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
    const dni = req.params.dni;
    if (!/^\d{8}$/.test(dni)) {
        return res.status(400).json({ success: false, message: 'DNI inválido.' });
    }

    let month = req.query.month;
    if (!month) {
        const { fecha } = getLocalTime();
        month = fecha.substring(0, 7); // YYYY-MM
    }
    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ success: false, message: 'Formato de mes inválido.' });
    }
    
    try {
        const result = await db.execute({
            sql: `SELECT * FROM attendance WHERE worker_dni = ? AND fecha LIKE ? ORDER BY timestamp DESC`,
            args: [dni, `${month}%`]
        });
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/attendance - Get all recent attendance
app.get('/api/attendance', async (req, res) => {
    let limit = parseInt(req.query.limit) || 50;
    if (limit < 1) limit = 1;
    if (limit > 200) limit = 200;
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