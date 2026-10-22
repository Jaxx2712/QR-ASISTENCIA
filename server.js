const express = require('express');
const cors = require('cors');
const { createClient } = require('@libsql/client');
require('dotenv').config();
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const ExcelJS = require('exceljs');

const app = express();
app.use(cors()); // Esto permite que cualquier origen (incluyendo tu app móvil) se conecte al backend
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    
    // Una sola política de CSP unificada permitiendo Render y fuentes externas:
    res.setHeader('Content-Security-Policy', 
        "default-src 'self' https: data: blob:; " +
        "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://unpkg.com; " +
        "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; " +
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; " +
        "img-src 'self' data: blob:; " +
        "connect-src 'self' https://qr-asistencia-backend-keum.onrender.com https://*.onrender.com;"
    );
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
    url: process.env.TURSO_DATABASE_URL || 'file:asistencia.db',
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

        await ensureUsersTable();

        console.log('Connected to database and initialized tables.');
    } catch (err) {
        console.error('Error initializing database:', err.message);
    }
}

let isUsersTableReady = false;
async function ensureUsersTable() {
    if (isUsersTableReady) return;
    try {
        await db.execute(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            dni TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            cargo TEXT NOT NULL CHECK(cargo IN ('Administrador','Supervisor')),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        try {
            const userCount = await db.execute(`SELECT COUNT(*) as count FROM users`);
            if (Number(userCount.rows[0]?.count || 0) === 0) {
                const salt = crypto.randomBytes(16).toString('hex');
                const hash = crypto.scryptSync('admin123', salt, 64).toString('hex');
                await db.execute({
                    sql: `INSERT INTO users (nombre, dni, email, password_hash, salt, cargo) VALUES (?, ?, ?, ?, ?, ?)`,
                    args: ['Administrador Principal', '11111111', 'admin@qrasistencia.com', hash, salt, 'Administrador']
                });
                console.log('Cuenta de Administrador inicial creada: admin@qrasistencia.com (DNI: 11111111 / Clave: admin123)');
            }
        } catch (e) {
            // ignore count error
        }

        isUsersTableReady = true;
    } catch (err) {
        console.error('Error ensuring users table:', err.message);
    }
}

initDB();

function getLocalTime() {
    const now = new Date();
    const tz = process.env.TIMEZONE || 'America/Caracas';
    let options = {};
    try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
        options = { timeZone: tz };
    } catch (e) {
        options = {};
    }
    const fecha = now.toLocaleDateString('en-CA', options); // YYYY-MM-DD
    const hora = now.toLocaleTimeString('en-GB', options);   // HH:MM:SS
    return { fecha, hora };
}

function formatTime12h(timeStr) {
    if (!timeStr) return '';
    const parts = timeStr.split(':');
    let hours = parseInt(parts[0], 10);
    const minutes = parts[1] || '00';
    if (isNaN(hours)) return timeStr;
    const ampm = hours >= 12 ? 'p. m.' : 'a. m.';
    hours = hours % 12;
    if (hours === 0) hours = 12;
    return `${hours}:${minutes} ${ampm}`;
}

// Authentication Helpers & Sessions
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return { salt, hash };
}

function verifyPassword(password, salt, originalHash) {
    try {
        const hash = crypto.scryptSync(password, salt, 64).toString('hex');
        return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(originalHash, 'hex'));
    } catch (e) {
        return false;
    }
}

// Active session store: token -> user session
const activeSessions = new Map();

function createSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days validity
    activeSessions.set(token, {
        userId: user.id,
        nombre: user.nombre,
        dni: user.dni,
        email: user.email,
        cargo: user.cargo,
        expiresAt
    });
    return token;
}

function getSessionUser(req) {
    const authHeader = req.headers['authorization'];
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    } else if (req.query && req.query.token) {
        token = req.query.token;
    }
    if (!token) return null;
    const session = activeSessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
        activeSessions.delete(token);
        return null;
    }
    return session;
}

function requireAuth(req, res, next) {
    const user = getSessionUser(req);
    if (!user) {
        return res.status(401).json({ success: false, message: 'No autorizado. Inicie sesión.' });
    }
    req.user = user;
    next();
}

function requireAdmin(req, res, next) {
    const user = getSessionUser(req);
    if (!user) {
        return res.status(401).json({ success: false, message: 'No autorizado. Inicie sesión.' });
    }
    if (user.cargo !== 'Administrador') {
        return res.status(403).json({ success: false, message: 'Acceso restringido: Solo para Administradores.' });
    }
    req.user = user;
    next();
}

// Auth Routes

// POST /api/auth/register - Register a user by DNI (Administrador or Supervisor)
app.post('/api/auth/register', async (req, res) => {
    const { nombre, dni, password, cargo } = req.body;
    
    if (!nombre || !dni || !password || !cargo) {
        return res.status(400).json({ success: false, message: 'Todos los campos son obligatorios.' });
    }

    const cleanNombre = String(nombre).trim();
    const cleanDni = String(dni).trim();
    const cleanCargo = String(cargo).trim();

    if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]{3,60}$/.test(cleanNombre)) {
        return res.status(400).json({ success: false, message: 'El nombre solo puede contener letras y espacios (mínimo 3 letras).' });
    }

    if (!/^\d{8}$/.test(cleanDni)) {
        return res.status(400).json({ success: false, message: 'El DNI debe contener exactamente 8 números.' });
    }

    if (String(password).length < 6) {
        return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    if (!['Administrador', 'Supervisor'].includes(cleanCargo)) {
        return res.status(400).json({ success: false, message: 'El cargo debe ser Administrador o Supervisor.' });
    }

    try {
        await ensureUsersTable();

        let existing;
        try {
            existing = await db.execute({
                sql: `SELECT dni FROM users WHERE dni = ?`,
                args: [cleanDni]
            });
        } catch (dbErr) {
            if (dbErr.message && dbErr.message.includes('no such table')) {
                isUsersTableReady = false;
                await ensureUsersTable();
                existing = await db.execute({
                    sql: `SELECT dni FROM users WHERE dni = ?`,
                    args: [cleanDni]
                });
            } else {
                throw dbErr;
            }
        }

        if (existing.rows.length > 0) {
            return res.status(409).json({ success: false, message: 'Ya existe un usuario registrado con este DNI.' });
        }

        const { salt, hash } = hashPassword(password);
        const emailVal = req.body.email ? String(req.body.email).trim().toLowerCase() : `${cleanDni}@qrasistencia.local`;
        const insertRes = await db.execute({
            sql: `INSERT INTO users (nombre, dni, email, password_hash, salt, cargo) VALUES (?, ?, ?, ?, ?, ?)`,
            args: [cleanNombre, cleanDni, emailVal, hash, salt, cleanCargo]
        });

        const userObj = {
            id: Number(insertRes.lastInsertRowid || 0),
            nombre: cleanNombre,
            dni: cleanDni,
            cargo: cleanCargo
        };

        const token = createSession(userObj);
        res.json({
            success: true,
            message: 'Registro exitoso.',
            token,
            user: userObj
        });
    } catch (err) {
        console.error('Error al registrar usuario:', err);
        res.status(500).json({ success: false, message: 'Error interno al registrar usuario: ' + err.message });
    }
});

// POST /api/auth/login - Login with DNI
app.post('/api/auth/login', async (req, res) => {
    const { dni, identifier, password } = req.body;
    const loginDni = String(dni || identifier || '').trim();
    if (!loginDni || !password) {
        return res.status(400).json({ success: false, message: 'Por favor ingresa tu DNI y contraseña.' });
    }

    try {
        await ensureUsersTable();

        let result;
        try {
            result = await db.execute({
                sql: `SELECT * FROM users WHERE dni = ? OR LOWER(email) = ?`,
                args: [loginDni, loginDni.toLowerCase()]
            });
        } catch (dbErr) {
            if (dbErr.message && dbErr.message.includes('no such table')) {
                isUsersTableReady = false;
                await ensureUsersTable();
                result = await db.execute({
                    sql: `SELECT * FROM users WHERE dni = ? OR LOWER(email) = ?`,
                    args: [loginDni, loginDni.toLowerCase()]
                });
            } else {
                throw dbErr;
            }
        }

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'DNI o contraseña incorrectos.' });
        }

        const user = result.rows[0];
        const isValid = verifyPassword(password, user.salt, user.password_hash);
        if (!isValid) {
            return res.status(401).json({ success: false, message: 'DNI o contraseña incorrectos.' });
        }

        const userObj = {
            id: user.id,
            nombre: user.nombre,
            dni: user.dni,
            cargo: user.cargo
        };

        const token = createSession(userObj);
        res.json({
            success: true,
            message: 'Inicio de sesión exitoso.',
            token,
            user: userObj
        });
    } catch (err) {
        console.error('Error al iniciar sesión:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor al iniciar sesión.' });
    }
});

// GET /api/auth/me - Verify current session
app.get('/api/auth/me', (req, res) => {
    const user = getSessionUser(req);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Sesión no válida o expirada.' });
    }
    res.json({
        success: true,
        user: {
            nombre: user.nombre,
            dni: user.dni,
            email: user.email,
            cargo: user.cargo
        }
    });
});

// POST /api/auth/logout - Logout
app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        activeSessions.delete(token);
    }
    res.json({ success: true, message: 'Sesión finalizada correctamente.' });
});

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
            sql: `SELECT COUNT(DISTINCT worker_dni) as count FROM attendance WHERE fecha = ? AND tipo = 'Entrada'`,
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

// GET /api/reports/daily - Daily attendance report (00:00 - 23:59)
app.get('/api/reports/daily', async (req, res) => {
    let fecha = req.query.fecha;
    if (!fecha) {
        fecha = getLocalTime().fecha;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return res.status(400).json({ success: false, message: 'Formato de fecha inválido (YYYY-MM-DD).' });
    }

    try {
        const result = await db.execute({
            sql: `
                SELECT 
                    w.dni,
                    w.nombre,
                    MIN(CASE WHEN a.tipo = 'Entrada' THEN a.hora END) as hora_entrada,
                    MAX(CASE WHEN a.tipo = 'Salida' THEN a.hora END) as hora_salida
                FROM attendance a
                JOIN workers w ON a.worker_dni = w.dni
                WHERE a.fecha = ?
                GROUP BY w.dni, w.nombre
                ORDER BY hora_entrada ASC, w.nombre ASC
            `,
            args: [fecha]
        });

        const dayNumber = parseInt(fecha.split('-')[2], 10);
        const records = result.rows.map(row => ({
            dni: row.dni,
            nombre: row.nombre,
            hora_entrada: row.hora_entrada,
            hora_salida: row.hora_salida,
            hora_entrada_fmt: formatTime12h(row.hora_entrada),
            hora_salida_fmt: formatTime12h(row.hora_salida)
        }));

        res.json({
            success: true,
            fecha,
            dia: dayNumber,
            titulo: `Dia ${dayNumber}`,
            records
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/reports/daily/download - Download daily attendance report formatted as Excel (.xlsx) matching exact specification
app.get('/api/reports/daily/download', async (req, res) => {
    let fecha = req.query.fecha;
    if (!fecha) {
        fecha = getLocalTime().fecha;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return res.status(400).send('Formato de fecha inválido (YYYY-MM-DD).');
    }

    try {
        const result = await db.execute({
            sql: `
                SELECT 
                    w.dni,
                    w.nombre,
                    MIN(CASE WHEN a.tipo = 'Entrada' THEN a.hora END) as hora_entrada,
                    MAX(CASE WHEN a.tipo = 'Salida' THEN a.hora END) as hora_salida
                FROM attendance a
                JOIN workers w ON a.worker_dni = w.dni
                WHERE a.fecha = ?
                GROUP BY w.dni, w.nombre
                ORDER BY hora_entrada ASC, w.nombre ASC
            `,
            args: [fecha]
        });

        const dayNumber = parseInt(fecha.split('-')[2], 10);
        const records = result.rows.map(row => ({
            dni: row.dni,
            nombre: row.nombre,
            hora_entrada_fmt: formatTime12h(row.hora_entrada),
            hora_salida_fmt: formatTime12h(row.hora_salida)
        }));

        const wb = new ExcelJS.Workbook();
        wb.creator = 'QR Asistencia';
        wb.created = new Date();
        const ws = wb.addWorksheet(`Dia ${dayNumber}`);

        // Format definitions matching exact spreadsheet specifications
        const fontNormal = { name: 'Calibri', size: 11, bold: false };
        const centerAlign = { horizontal: 'center', vertical: 'middle' };
        const thinBorder = {
            top: { style: 'thin', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'thin', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } }
        };

        // Row 1: Merged Title "Dia X"
        ws.mergeCells('A1:D1');
        const titleCell = ws.getCell('A1');
        titleCell.value = `Dia ${dayNumber}`;
        titleCell.alignment = centerAlign;
        titleCell.font = fontNormal;

        // Row 2: Headers
        const headers = ['DNI', 'Nombre', 'hora de entrada', 'hora de salida'];
        const headerRow = ws.getRow(2);
        headers.forEach((h, i) => {
            const cell = headerRow.getCell(i + 1);
            cell.value = h;
            cell.alignment = centerAlign;
            cell.font = fontNormal;
        });

        // Rows 3+: Worker Data
        records.forEach((rec, idx) => {
            const row = ws.getRow(3 + idx);
            row.getCell(1).value = rec.dni;
            row.getCell(2).value = rec.nombre;
            row.getCell(3).value = rec.hora_entrada_fmt || '';
            row.getCell(4).value = rec.hora_salida_fmt || '';
            for (let c = 1; c <= 4; c++) {
                row.getCell(c).alignment = centerAlign;
                row.getCell(c).font = fontNormal;
            }
        });

        // Grid lines matching image: at least 15 rows formatted with thin borders
        const totalRows = Math.max(15, records.length + 2);
        for (let r = 1; r <= totalRows; r++) {
            for (let c = 1; c <= 4; c++) {
                ws.getCell(r, c).border = thinBorder;
                if (r > 2 + records.length) {
                    ws.getCell(r, c).alignment = centerAlign;
                    ws.getCell(r, c).font = fontNormal;
                }
            }
        }

        // Set optimal column widths
        ws.columns = [
            { width: 16 },
            { width: 26 },
            { width: 22 },
            { width: 22 }
        ];

        const buffer = await wb.xlsx.writeBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Reporte_Dia_${dayNumber}_${fecha}.xlsx"`);
        res.send(buffer);
    } catch (err) {
        res.status(500).send('Error al generar el reporte de Excel: ' + err.message);
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