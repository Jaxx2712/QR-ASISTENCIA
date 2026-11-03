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

        await db.execute(`CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            nombre TEXT NOT NULL,
            dni TEXT NOT NULL,
            email TEXT,
            cargo TEXT NOT NULL,
            foto TEXT DEFAULT '',
            expires_at INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        await ensureUsersTable();

        // Pre-cargar sesiones válidas desde la base de datos para persistencia total
        try {
            const validSessions = await db.execute({
                sql: `SELECT * FROM sessions WHERE expires_at > ?`,
                args: [Date.now()]
            });
            for (const row of validSessions.rows) {
                activeSessions.set(row.token, {
                    userId: row.user_id,
                    nombre: row.nombre,
                    dni: row.dni,
                    email: row.email,
                    cargo: row.cargo,
                    foto: row.foto || '',
                    expiresAt: row.expires_at
                });
            }
            console.log(`Sesiones activas cargadas desde base de datos: ${validSessions.rows.length}`);
        } catch (sErr) {
            console.warn('Advertencia al cargar sesiones previas:', sErr.message);
        }

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
            foto TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        try {
            await db.execute(`ALTER TABLE users ADD COLUMN foto TEXT DEFAULT ''`);
        } catch (e) {
            // Ignorar si ya existe
        }

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

// =========================================================================
// TIEMPO Y ZONAS HORARIAS (Hora Base UTC con Conversión Automática a Local)
// =========================================================================
function getUtcTime() {
    const now = new Date();
    // Extrae la fecha y hora exacta en formato universal UTC
    const fecha = now.toISOString().split('T')[0]; // YYYY-MM-DD (UTC)
    const hora = now.toISOString().split('T')[1].split('.')[0]; // HH:MM:SS (UTC)
    return { fecha, hora };
}

// Mantener getLocalTime como alias de getUtcTime para consistencia en la base UTC
function getLocalTime() {
    return getUtcTime();
}

// Obtener fecha del cliente según su zona horaria
function getClientDate(clientTimeZone = 'UTC') {
    try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: clientTimeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        return formatter.format(now);
    } catch (e) {
        return getUtcTime().fecha;
    }
}

// Helper para convertir la hora UTC a la zona horaria del cliente (12h am/pm)
function formatUtcToLocal12h(fechaStr, horaStr, clientTimeZone = 'UTC') {
    if (!horaStr || !fechaStr) return '';
    try {
        const utcDate = new Date(`${fechaStr}T${horaStr}Z`);
        return utcDate.toLocaleTimeString('es-ES', {
            timeZone: clientTimeZone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    } catch (e) {
        return formatTime12h(horaStr);
    }
}

// Cálculo del total de horas trabajadas en el día
function calculateWorkedHours(fechaStr, horaEntrada, horaSalida) {
    if (!horaEntrada || !horaSalida) return '-';
    try {
        const d1 = new Date(`${fechaStr}T${horaEntrada}Z`);
        const d2 = new Date(`${fechaStr}T${horaSalida}Z`);
        const diffMs = d2.getTime() - d1.getTime();
        if (diffMs <= 0) return '0 hrs';
        
        const totalMinutes = Math.round(diffMs / 60000);
        const hrs = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        
        if (mins === 0) {
            return `${hrs} ${hrs === 1 ? 'hora' : 'horas'}`;
        }
        if (hrs === 0) {
            return `${mins} min`;
        }
        return `${hrs}h ${mins}m`;
    } catch (e) {
        return '-';
    }
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
const failedLoginAttempts = new Map(); // IP -> { count, firstAttempt }
function checkLoginRateLimit(ip) {
    const now = Date.now();
    const entry = failedLoginAttempts.get(ip);
    if (!entry) return true;
    if (now - entry.firstAttempt > 15 * 60 * 1000) {
        failedLoginAttempts.delete(ip);
        return true;
    }
    return entry.count < 10;
}
function recordFailedLogin(ip) {
    const now = Date.now();
    const entry = failedLoginAttempts.get(ip) || { count: 0, firstAttempt: now };
    if (now - entry.firstAttempt > 15 * 60 * 1000) {
        entry.count = 1;
        entry.firstAttempt = now;
    } else {
        entry.count++;
    }
    failedLoginAttempts.set(ip, entry);
}
function clearFailedLogin(ip) {
    failedLoginAttempts.delete(ip);
}

function sanitizeForExcel(val) {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (/^[=+\-@]/.test(str)) {
        return "'" + str;
    }
    return str;
}

function getWeekRange(dateStr) {
    const parts = dateStr.split('-');
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    const day = d.getDay();
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const fmt = dt => {
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const dayNum = String(dt.getDate()).padStart(2, '0');
        return `${y}-${m}-${dayNum}`;
    };

    return { startDate: fmt(monday), endDate: fmt(sunday) };
}

function countWorkingDays(startDateStr, endDateStr, todayStr) {
    const start = new Date(startDateStr + 'T12:00:00');
    const end = new Date(endDateStr + 'T12:00:00');
    const today = new Date(todayStr + 'T12:00:00');
    const limit = end < today ? end : today;
    
    let count = 0;
    const cur = new Date(start);
    while (cur <= limit) {
        const day = cur.getDay();
        if (day !== 0) { // Lunes a Sábado laborables
            count++;
        }
        cur.setDate(cur.getDate() + 1);
    }
    return Math.max(1, count);
}

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


// Active session store: token -> user session (en memoria + persistencia SQLite)
const activeSessions = new Map();

function createSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 días de persistencia garantizada
    const sessionData = {
        userId: user.id,
        nombre: user.nombre,
        dni: user.dni,
        email: user.email,
        cargo: user.cargo,
        foto: user.foto || '',
        expiresAt
    };
    activeSessions.set(token, sessionData);

    // Guardar en la base de datos para que la sesión no se pierda al reiniciar el servidor o el dispositivo
    db.execute({
        sql: `INSERT OR REPLACE INTO sessions (token, user_id, nombre, dni, email, cargo, foto, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [token, user.id || 0, user.nombre, user.dni, user.email || '', user.cargo, user.foto || '', expiresAt]
    }).catch(err => {
        console.error('Error al persistir sesión en base de datos:', err.message);
    });

    return token;
}

async function getSessionUser(req) {
    const authHeader = req.headers['authorization'];
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    } else if (req.query && req.query.token) {
        token = req.query.token;
    }
    if (!token) return null;

    // 1. Revisar memoria rápida
    const session = activeSessions.get(token);
    if (session) {
        if (Date.now() > session.expiresAt) {
            activeSessions.delete(token);
            db.execute({ sql: `DELETE FROM sessions WHERE token = ?`, args: [token] }).catch(() => {});
            return null;
        }
        return session;
    }

    // 2. Si no está en memoria (ej. tras reinicio del servidor), recuperar de la base de datos
    try {
        const dbRes = await db.execute({
            sql: `SELECT * FROM sessions WHERE token = ?`,
            args: [token]
        });
        if (dbRes.rows.length > 0) {
            const row = dbRes.rows[0];
            if (Date.now() <= Number(row.expires_at)) {
                const recoveredSession = {
                    userId: row.user_id,
                    nombre: row.nombre,
                    dni: row.dni,
                    email: row.email,
                    cargo: row.cargo,
                    foto: row.foto || '',
                    expiresAt: Number(row.expires_at)
                };
                activeSessions.set(token, recoveredSession);
                return recoveredSession;
            } else {
                db.execute({ sql: `DELETE FROM sessions WHERE token = ?`, args: [token] }).catch(() => {});
            }
        }
    } catch (e) {
        console.error('Error recuperando sesión persistente:', e.message);
    }

    return null;
}

async function requireAuth(req, res, next) {
    const user = await getSessionUser(req);
    if (!user) {
        return res.status(401).json({ success: false, message: 'No autorizado. Inicie sesión.' });
    }
    req.user = user;
    next();
}

async function requireAdmin(req, res, next) {
    const user = await getSessionUser(req);
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
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    if (!checkLoginRateLimit(ip)) {
        return res.status(429).json({ success: false, message: 'Demasiados intentos fallidos. Intenta nuevamente en 15 minutos.' });
    }

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
            recordFailedLogin(ip);
            return res.status(401).json({ success: false, message: 'DNI o contraseña incorrectos.' });
        }

        const user = result.rows[0];
        const isValid = verifyPassword(password, user.salt, user.password_hash);
        if (!isValid) {
            recordFailedLogin(ip);
            return res.status(401).json({ success: false, message: 'DNI o contraseña incorrectos.' });
        }

        clearFailedLogin(ip);
        const userObj = {
            id: user.id,
            nombre: user.nombre,
            dni: user.dni,
            cargo: user.cargo,
            foto: user.foto || ''
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
app.get('/api/auth/me', async (req, res) => {
    const user = await getSessionUser(req);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Sesión no válida o expirada.' });
    }
    res.json({
        success: true,
        user: {
            nombre: user.nombre,
            dni: user.dni,
            email: user.email,
            cargo: user.cargo,
            foto: user.foto || ''
        }
    });
});

// POST /api/auth/logout - Logout
app.post('/api/auth/logout', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        activeSessions.delete(token);
        db.execute({ sql: `DELETE FROM sessions WHERE token = ?`, args: [token] }).catch(() => {});
    }
    res.json({ success: true, message: 'Sesión finalizada correctamente.' });
});

// POST /api/auth/profile/photo - Actualizar foto de perfil del usuario logueado
app.post('/api/auth/profile/photo', requireAuth, async (req, res) => {
    const { foto } = req.body;
    let cleanFoto = '';
    if (foto && typeof foto === 'string' && foto.trim()) {
        const trimmed = foto.trim();
        if (/^data:image\/(png|jpeg|jpg|webp);base64,/.test(trimmed) && trimmed.length <= 4 * 1024 * 1024) {
            cleanFoto = trimmed;
        } else {
            return res.status(400).json({ success: false, message: 'Formato de imagen inválido o excede el límite permitido.' });
        }
    }

    try {
        const userDni = req.user.dni;
        await db.execute({
            sql: `UPDATE users SET foto = ? WHERE dni = ?`,
            args: [cleanFoto, userDni]
        });
        await db.execute({
            sql: `UPDATE sessions SET foto = ? WHERE dni = ?`,
            args: [cleanFoto, userDni]
        });

        // Actualizar en memoria activa
        req.user.foto = cleanFoto;
        for (const [t, s] of activeSessions) {
            if (s.dni === userDni) {
                s.foto = cleanFoto;
            }
        }

        res.json({
            success: true,
            message: 'Foto de perfil actualizada exitosamente.',
            foto: cleanFoto
        });
    } catch (err) {
        console.error('Error al actualizar foto de perfil:', err);
        res.status(500).json({ success: false, message: 'Error interno al actualizar foto de perfil.' });
    }
});

// Routes

// Helper to build standardized Excel sheets
async function buildExcelSheet({ title, headers, rows, sheetName, res, filename }) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Asistencia QR';
    wb.created = new Date();
    const ws = wb.addWorksheet(sheetName || 'Reporte');

    const fontNormal = { name: 'Calibri', size: 11, bold: false };
    const fontHeader = { name: 'Calibri', size: 11, bold: true };
    const centerAlign = { horizontal: 'center', vertical: 'middle' };
    const thinBorder = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
    };

    // Row 1: Merged Title
    const colCount = headers.length;
    const endColLetter = String.fromCharCode(64 + colCount);
    ws.mergeCells(`A1:${endColLetter}1`);
    const titleCell = ws.getCell('A1');
    titleCell.value = sanitizeForExcel(title);
    titleCell.alignment = centerAlign;
    titleCell.font = fontHeader;

    // Row 2: Headers
    const headerRow = ws.getRow(2);
    headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.alignment = centerAlign;
        cell.font = fontHeader;
    });

    // Rows 3+: Data
    rows.forEach((r, idx) => {
        const row = ws.getRow(3 + idx);
        r.forEach((val, colIdx) => {
            const cell = row.getCell(colIdx + 1);
            cell.value = sanitizeForExcel(val);
            cell.alignment = centerAlign;
            cell.font = fontNormal;
        });
    });

    // Grid lines: minimum 15 total rows
    const totalRows = Math.max(15, rows.length + 2);
    for (let r = 1; r <= totalRows; r++) {
        for (let c = 1; c <= colCount; c++) {
            ws.getCell(r, c).border = thinBorder;
            if (r > 2 + rows.length) {
                ws.getCell(r, c).alignment = centerAlign;
                ws.getCell(r, c).font = fontNormal;
            }
        }
    }

    ws.columns = headers.map((h, i) => {
        if (i === 0) return { width: 16 };
        if (i === 1) return { width: 28 };
        if (i === 4) return { width: 22 };
        return { width: 20 };
    });

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
}

// POST /api/workers - Register a worker (Admin only)
app.post('/api/workers', requireAdmin, async (req, res) => {
    const { dni, nombre, cargo = '', empresa = '', foto = '' } = req.body;
    
    if (!dni || !nombre) {
        return res.status(400).json({ success: false, message: 'DNI y nombre son requeridos.' });
    }
    
    const cleanDni = String(dni).trim();
    const cleanNombre = String(nombre).trim();
    // Limitar primero el tamaño de la cadena y luego limpiar los caracteres HTML
    // Función para escapar caracteres HTML de forma segura
    const escapeHtml = (str) => String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');

    // Aplicación en las variables
    const cleanCargo = escapeHtml(cargo).substring(0, 100).trim();
    const cleanEmpresa = escapeHtml(empresa).substring(0, 100).trim();

    // Strict validations
    if (!/^\d{8}$/.test(cleanDni)) {
        return res.status(400).json({ success: false, message: 'El DNI debe contener exactamente 8 números.' });
    }
    if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]{2,80}$/.test(cleanNombre)) {
        return res.status(400).json({ success: false, message: 'El nombre solo puede contener letras y espacios.' });
    }

    let cleanFoto = '';
    if (foto && typeof foto === 'string' && foto.trim()) {
        const trimmedFoto = foto.trim();
        if (/^data:image\/(png|jpeg|jpg|webp);base64,/.test(trimmedFoto) && trimmedFoto.length <= 4 * 1024 * 1024) {
            cleanFoto = trimmedFoto;
        } else {
            return res.status(400).json({ success: false, message: 'Formato de imagen inválido o excede el límite permitido.' });
        }
    }

    try {
        await db.execute({
            sql: `INSERT INTO workers (dni, nombre, cargo, empresa, foto) VALUES (?, ?, ?, ?, ?)`,
            args: [cleanDni, cleanNombre, cleanCargo, cleanEmpresa, cleanFoto]
        });
        res.json({ success: true, message: 'Trabajador registrado exitosamente.' });
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ success: false, message: 'Trabajador ya existe con este DNI.' });
        }
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/workers - Get all workers (Admin only)
app.get('/api/workers', requireAdmin, async (req, res) => {
    try {
        const result = await db.execute(`SELECT * FROM workers ORDER BY nombre`);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/workers/:dni - Get single worker (Admin or Supervisor for scanner)
app.get('/api/workers/:dni', requireAuth, async (req, res) => {
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
            return res.status(404).json({ success: false, message: 'Trabajador no encontrado.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// DELETE /api/workers/:dni - Delete worker and their attendance (Admin only)
app.delete('/api/workers/:dni', requireAdmin, async (req, res) => {
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

// POST /api/attendance - Record attendance (Admin or Supervisor)
app.post('/api/attendance', requireAuth, async (req, res) => {
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
            return res.status(404).json({ success: false, message: 'Trabajador no encontrado.' });
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

// GET /api/attendance/:dni - Get attendance for a specific worker (Admin only)
app.get('/api/attendance/:dni', requireAdmin, async (req, res) => {
    const dni = req.params.dni;
    if (!/^\d{8}$/.test(dni)) {
        return res.status(400).json({ success: false, message: 'DNI inválido.' });
    }

    let month = req.query.month;
    if (!month) {
        const { fecha } = getLocalTime();
        month = fecha.substring(0, 7);
    }
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

// GET /api/attendance - Get recent attendance (Admin or Supervisor)
app.get('/api/attendance', requireAuth, async (req, res) => {
    const clientTz = req.headers['x-timezone'] || req.query.tz || 'UTC';
    let limit = parseInt(req.query.limit, 10) || 50;
    if (limit < 1) limit = 1;
    if (limit > 200) limit = 200;
    try {
        const result = await db.execute({
            sql: `SELECT a.*, w.nombre FROM attendance a JOIN workers w ON a.worker_dni = w.dni ORDER BY a.timestamp DESC LIMIT ?`,
            args: [limit]
        });
        const rows = result.rows.map(row => ({
            ...row,
            hora_local: formatUtcToLocal12h(row.fecha, row.hora, clientTz)
        }));
        res.json(rows);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/dashboard - Dashboard stats (Admin only)
app.get('/api/dashboard', requireAdmin, async (req, res) => {
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

// =========================================================================
// REPORTES (Diarios, Semanales y Mensuales)
// =========================================================================

// GET /api/reports/daily - Reporte Diario
app.get('/api/reports/daily', requireAdmin, async (req, res) => {
    const clientTz = req.headers['x-timezone'] || req.query.tz || 'UTC';
    let fecha = req.query.fecha;
    if (!fecha) {
        fecha = getClientDate(clientTz);
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
            hora_entrada_fmt: formatUtcToLocal12h(fecha, row.hora_entrada, clientTz),
            hora_salida_fmt: formatUtcToLocal12h(fecha, row.hora_salida, clientTz),
            total_horas: calculateWorkedHours(fecha, row.hora_entrada, row.hora_salida)
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

// GET /api/reports/daily/download - Descarga Excel Diario con Hora Local y Total de Horas Trabajadas
app.get('/api/reports/daily/download', requireAdmin, async (req, res) => {
    const clientTz = req.query.tz || req.headers['x-timezone'] || 'UTC'; // Captura la zona horaria enviada por el frontend
    let fecha = req.query.fecha;
    
    if (!fecha) {
        fecha = getClientDate(clientTz);
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
        
        // Mapea las filas aplicando la conversión a la zona horaria local del usuario y calculando las horas trabajadas
        const rows = result.rows.map(row => [
            row.dni,
            row.nombre,
            formatUtcToLocal12h(fecha, row.hora_entrada, clientTz),
            formatUtcToLocal12h(fecha, row.hora_salida, clientTz),
            calculateWorkedHours(fecha, row.hora_entrada, row.hora_salida)
        ]);

        await buildExcelSheet({
            title: `Dia ${dayNumber}`,
            headers: ['DNI', 'Nombre', 'hora de entrada', 'hora de salida', 'Horas Trabajadas'],
            rows,
            sheetName: `Dia ${dayNumber}`,
            res,
            filename: `Reporte_Diario_Dia_${dayNumber}_${fecha}.xlsx`
        });
    } catch (err) {
        res.status(500).send('Error al generar el reporte de Excel: ' + err.message);
    }
});

// GET /api/reports/weekly - Reporte Semanal
app.get('/api/reports/weekly', requireAdmin, async (req, res) => {
    let fecha = req.query.fecha;
    const { fecha: todayFecha } = getLocalTime();
    if (!fecha) fecha = todayFecha;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return res.status(400).json({ success: false, message: 'Formato de fecha inválido (YYYY-MM-DD).' });
    }

    try {
        const { startDate, endDate } = getWeekRange(fecha);
        const totalWorkingDays = countWorkingDays(startDate, endDate, todayFecha);

        const result = await db.execute({
            sql: `
                SELECT 
                    w.dni,
                    w.nombre,
                    COUNT(DISTINCT CASE WHEN a.tipo = 'Entrada' THEN a.fecha END) as dias_asistidos
                FROM workers w
                LEFT JOIN attendance a ON a.worker_dni = w.dni AND a.fecha BETWEEN ? AND ?
                GROUP BY w.dni, w.nombre
                ORDER BY w.nombre ASC
            `,
            args: [startDate, endDate]
        });

        const records = result.rows.map(row => {
            const asistidos = Number(row.dias_asistidos || 0);
            const faltados = Math.max(0, totalWorkingDays - asistidos);
            return {
                dni: row.dni,
                nombre: row.nombre,
                dias_asistidos: asistidos,
                dias_faltados: faltados
            };
        });

        res.json({
            success: true,
            fecha,
            startDate,
            endDate,
            totalWorkingDays,
            titulo: `Semana del ${startDate} al ${endDate}`,
            records
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/reports/weekly/download - Descarga Excel Semanal
app.get('/api/reports/weekly/download', requireAdmin, async (req, res) => {
    let fecha = req.query.fecha;
    const { fecha: todayFecha } = getLocalTime();
    if (!fecha) fecha = todayFecha;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return res.status(400).send('Formato de fecha inválido (YYYY-MM-DD).');
    }

    try {
        const { startDate, endDate } = getWeekRange(fecha);
        const totalWorkingDays = countWorkingDays(startDate, endDate, todayFecha);

        const result = await db.execute({
            sql: `
                SELECT 
                    w.dni,
                    w.nombre,
                    COUNT(DISTINCT CASE WHEN a.tipo = 'Entrada' THEN a.fecha END) as dias_asistidos
                FROM workers w
                LEFT JOIN attendance a ON a.worker_dni = w.dni AND a.fecha BETWEEN ? AND ?
                GROUP BY w.dni, w.nombre
                ORDER BY w.nombre ASC
            `,
            args: [startDate, endDate]
        });

        const rows = result.rows.map(row => {
            const asistidos = Number(row.dias_asistidos || 0);
            const faltados = Math.max(0, totalWorkingDays - asistidos);
            return [
                row.dni,
                row.nombre,
                asistidos,
                faltados
            ];
        });

        await buildExcelSheet({
            title: `Reporte Semanal (${startDate} al ${endDate})`,
            headers: ['DNI', 'Nombre', 'dias asistidos', 'dias faltados'],
            rows,
            sheetName: 'Reporte Semanal',
            res,
            filename: `Reporte_Semanal_${startDate}_${endDate}.xlsx`
        });
    } catch (err) {
        res.status(500).send('Error al generar el reporte de Excel: ' + err.message);
    }
});

// GET /api/reports/monthly - Reporte Mensual
app.get('/api/reports/monthly', requireAdmin, async (req, res) => {
    let mes = req.query.mes;
    const { fecha: todayFecha } = getLocalTime();
    if (!mes) mes = todayFecha.substring(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mes)) {
        return res.status(400).json({ success: false, message: 'Formato de mes inválido (YYYY-MM).' });
    }

    try {
        const [yearStr, monthStr] = mes.split('-');
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);
        const daysInMonth = new Date(year, month, 0).getDate();
        const startDate = `${mes}-01`;
        const endDate = `${mes}-${String(daysInMonth).padStart(2, '0')}`;
        const totalWorkingDays = countWorkingDays(startDate, endDate, todayFecha);

        const result = await db.execute({
            sql: `
                SELECT 
                    w.dni,
                    w.nombre,
                    COUNT(DISTINCT CASE WHEN a.tipo = 'Entrada' THEN a.fecha END) as dias_asistidos
                FROM workers w
                LEFT JOIN attendance a ON a.worker_dni = w.dni AND a.fecha LIKE ?
                GROUP BY w.dni, w.nombre
                ORDER BY w.nombre ASC
            `,
            args: [`${mes}%`]
        });

        const records = result.rows.map(row => {
            const asistidos = Number(row.dias_asistidos || 0);
            const faltados = Math.max(0, totalWorkingDays - asistidos);
            return {
                dni: row.dni,
                nombre: row.nombre,
                dias_asistidos: asistidos,
                dias_faltados: faltados
            };
        });

        const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const monthName = monthNames[month - 1] || mes;

        res.json({
            success: true,
            mes,
            startDate,
            endDate,
            totalWorkingDays,
            titulo: `Mes de ${monthName} ${year}`,
            records
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/reports/monthly/download - Descarga Excel Mensual
app.get('/api/reports/monthly/download', requireAdmin, async (req, res) => {
    let mes = req.query.mes;
    const { fecha: todayFecha } = getLocalTime();
    if (!mes) mes = todayFecha.substring(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mes)) {
        return res.status(400).send('Formato de mes inválido (YYYY-MM).');
    }

    try {
        const [yearStr, monthStr] = mes.split('-');
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);
        const daysInMonth = new Date(year, month, 0).getDate();
        const startDate = `${mes}-01`;
        const endDate = `${mes}-${String(daysInMonth).padStart(2, '0')}`;
        const totalWorkingDays = countWorkingDays(startDate, endDate, todayFecha);

        const result = await db.execute({
            sql: `
                SELECT 
                    w.dni,
                    w.nombre,
                    COUNT(DISTINCT CASE WHEN a.tipo = 'Entrada' THEN a.fecha END) as dias_asistidos
                FROM workers w
                LEFT JOIN attendance a ON a.worker_dni = w.dni AND a.fecha LIKE ?
                GROUP BY w.dni, w.nombre
                ORDER BY w.nombre ASC
            `,
            args: [`${mes}%`]
        });

        const rows = result.rows.map(row => {
            const asistidos = Number(row.dias_asistidos || 0);
            const faltados = Math.max(0, totalWorkingDays - asistidos);
            return [
                row.dni,
                row.nombre,
                asistidos,
                faltados
            ];
        });

        const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const monthName = monthNames[month - 1] || mes;

        await buildExcelSheet({
            title: `Reporte Mensual (${monthName} ${year})`,
            headers: ['DNI', 'Nombre', 'dias asistidos', 'dias faltados'],
            rows,
            sheetName: `Mes ${monthName}`,
            res,
            filename: `Reporte_Mensual_${mes}.xlsx`
        });
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