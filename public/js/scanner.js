// ============================================================
// SAFETY: Monkey-patch getCapabilities para prevenir crash de
// Chromium en ciertos Android WebView (v6432+) donde llamar
// track.getCapabilities() causa NullPointerException en la
// capa Mojo IPC de Chromium (hashCode() on null).
// ============================================================
if (window.MediaStreamTrack && MediaStreamTrack.prototype.getCapabilities) {
    const _origGetCap = MediaStreamTrack.prototype.getCapabilities;
    MediaStreamTrack.prototype.getCapabilities = function() {
        try { return _origGetCap.call(this) || {}; } catch(e) { return {}; }
    };
}

let videoStream = null;
let scanAnimFrameId = null;
let activeWorkerData = null;
let isStartingScanner = false;
let isScanningActive = false;

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', () => {
    startClock();
    loadRecentActivity();
    setInterval(loadRecentActivity, 10000);
});

// Live real-time clock (local al dispositivo)
function startClock() {
    const clockEl = document.getElementById('clock');
    if (!clockEl) return;
    
    const updateTime = () => {
        const now = new Date();
        const dateOpts = { 
            weekday: 'short', 
            day: 'numeric', 
            month: 'short', 
            year: 'numeric' 
        };
        const timeOpts = { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        };
        let dateStr = now.toLocaleDateString('es-ES', dateOpts);
        dateStr = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
        const timeStr = now.toLocaleTimeString('es-ES', timeOpts);
        clockEl.innerHTML = `<span class="clock-date">${dateStr}</span> <span class="clock-time">${timeStr}</span>`;
    };
    
    updateTime();
    setInterval(updateTime, 1000);
}

// ============================================================
// Scanner: getUserMedia directo + jsQR
// Evita html5-qrcode que llama getCapabilities/enumerateDevices
// internamente y causa crashes nativos en Chromium WebView.
// ============================================================

async function stopScannerAsync() {
    isScanningActive = false;

    // Cancelar loop de escaneo
    if (scanAnimFrameId) {
        cancelAnimationFrame(scanAnimFrameId);
        scanAnimFrameId = null;
    }

    // Detener todos los tracks del stream de video
    if (videoStream) {
        videoStream.getTracks().forEach(track => {
            try { track.stop(); } catch(e) { /* ignorar */ }
        });
        videoStream = null;
    }

    // Limpiar elemento video
    const video = document.getElementById('scannerVideo');
    if (video) {
        video.srcObject = null;
    }

    const statusEl = document.getElementById('scannerStatus');
    if (statusEl) {
        statusEl.textContent = 'Cámara detenida';
        statusEl.className = 'scanner-status';
    }
}

function stopScanner() {
    stopScannerAsync();
}

async function startScanner() {
    if (isStartingScanner) return;
    isStartingScanner = true;

    const readerElement = document.getElementById('reader');
    if (readerElement) readerElement.style.display = 'block';

    try {
        // 1. Limpieza de cualquier stream previo
        await stopScannerAsync();

        // 2. Solicitar cámara con constraints mínimos
        //    (NO usar enumerateDevices ni deviceId explícito para evitar
        //     el bug de Chromium que causa NPE en hashCode())
        let stream = null;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' },
                audio: false
            });
        } catch (envErr) {
            console.warn('Cámara trasera no disponible, intentando cualquier cámara:', envErr);
            stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false
            });
        }

        videoStream = stream;

        // 3. Conectar stream al elemento <video>
        const video = document.getElementById('scannerVideo');
        if (!video) throw new Error('Elemento de video no encontrado');

        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        video.muted = true;

        await video.play();

        // 4. Iniciar loop de escaneo con jsQR
        isScanningActive = true;
        scanAnimFrameId = requestAnimationFrame(scanFrame);

        const statusEl = document.getElementById('scannerStatus');
        if (statusEl) {
            statusEl.textContent = 'Cámara activa - Escaneando...';
            statusEl.className = 'scanner-status active';
        }
    } catch (err) {
        console.error('Error al iniciar cámara:', err);
        showNotification('No se pudo acceder a la cámara. Verifica los permisos de la aplicación.', 'error');
        const statusEl = document.getElementById('scannerStatus');
        if (statusEl) {
            statusEl.textContent = 'Cámara no disponible';
            statusEl.className = 'scanner-status';
        }
    } finally {
        isStartingScanner = false;
    }
}

function scanFrame() {
    if (!isScanningActive) return;

    const video = document.getElementById('scannerVideo');
    const canvas = document.getElementById('scannerCanvas');

    if (!video || !canvas || video.paused || video.ended || video.readyState < 2) {
        // Video aún no listo, reintentar en el siguiente frame
        scanAnimFrameId = requestAnimationFrame(scanFrame);
        return;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    if (canvas.width > 0 && canvas.height > 0) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth'
        });

        if (code && code.data) {
            onScanSuccess(code.data);
            return; // Detener loop — se reinicia después de registrar asistencia
        }
    }

    scanAnimFrameId = requestAnimationFrame(scanFrame);
}

// ============================================================
// Procesamiento de QR escaneado
// ============================================================

async function onScanSuccess(decodedText) {
    try {
        let dni = '';
        let nombre = 'Trabajador';

        // Intentar parsear como JSON por si el QR fue generado con objeto
        try {
            const data = JSON.parse(decodedText);
            dni = data.dni || '';
            nombre = data.nombre || 'Trabajador';
        } catch (e) {
            // Si no es JSON, asumimos que el texto escaneado es directamente el DNI
            dni = decodedText.trim();
        }

        if (dni) {
            if (!/^\d{8}$/.test(dni)) {
                showNotification('QR inválido: Formato de DNI incorrecto.', 'error');
                if (isScanningActive) scanAnimFrameId = requestAnimationFrame(scanFrame);
                return;
            }

            // Opcional: Consultar los datos del trabajador al servidor si solo tenemos el DNI
            activeWorkerData = { dni: dni, nombre: nombre };
            
            const resultSection = document.getElementById('scanResult');
            if (resultSection) {
                resultSection.style.display = 'block';
                resultSection.classList.add('animate-in');
            }
            
            const initials = nombre.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            const avatarEl = document.getElementById('resultAvatar');
            if (avatarEl) {
                avatarEl.textContent = initials;
                avatarEl.style.backgroundColor = getAvatarColor(nombre);
            }
            const nameEl = document.getElementById('resultName');
            if (nameEl) nameEl.textContent = nombre;
            const dniEl = document.getElementById('resultDni');
            if (dniEl) dniEl.textContent = `DNI: ${dni}`;
            
            // Detener la cámara mientras el usuario confirma Entrada o Salida
            await stopScannerAsync();
            
            if (navigator.vibrate) navigator.vibrate(200);
        } else {
            if (isScanningActive) scanAnimFrameId = requestAnimationFrame(scanFrame);
        }
    } catch (e) {
        console.error('Error procesando QR:', e);
        showNotification('QR no reconocido. Intenta de nuevo.', 'error');
        if (isScanningActive) scanAnimFrameId = requestAnimationFrame(scanFrame);
    }
}

// ============================================================
// Registro de asistencia
// ============================================================

async function recordAttendance(tipo) {
    if (!activeWorkerData) return;

    try {
        const response = await fetch(`${API_URL}/api/attendance`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({ 
                worker_dni: activeWorkerData.dni, 
                tipo: tipo 
            })
        });

        const data = await response.json();

        if (response.ok) {
            showNotification(data.message || `¡Asistencia (${tipo.toUpperCase()}) registrada correctamente!`, 'success');
            document.getElementById('scanResult').style.display = 'none';
            activeWorkerData = null;
            await startScanner();
            loadRecentActivity();
        } else {
            showNotification(data.message || 'Error al registrar asistencia', 'error');
        }
    } catch (err) {
        console.error('Error:', err);
        showNotification('Error de conexión con el servidor', 'error');
    }
}

// ============================================================
// Actividad reciente
// ============================================================

async function loadRecentActivity() {
    try {
        const res = await fetch(`${API_URL}/api/attendance?limit=20`);
        const records = await res.json();
        
        const container = document.getElementById('activityList');
        container.innerHTML = '';
        
        records.forEach(record => {
            const isEntrada = record.tipo === 'Entrada';
            const icon = isEntrada ? 'fa-sign-in-alt' : 'fa-sign-out-alt';
            const colorClass = isEntrada ? 'entry' : 'exit';
            const safeName = escapeHtml(record.nombre || record.name);
            const safeDni = escapeHtml(record.worker_dni || record.id);
            const safeTipo = escapeHtml(record.tipo || record.type);
            
            // Convertir UTC a hora y fecha local del dispositivo
            let safeHora = '--:--:--';
            let safeFecha = '--/--/----';
            if (record.fecha && record.hora) {
                const cleanHora = record.hora.includes('Z') ? record.hora : `${record.hora}Z`;
                const utcString = `${record.fecha}T${cleanHora}`;
                const localDate = new Date(utcString);
                if (!isNaN(localDate.getTime())) {
                    safeHora = escapeHtml(localDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
                    safeFecha = escapeHtml(localDate.toLocaleDateString([], { year: 'numeric', month: '2-digit', day: '2-digit' }));
                } else {
                    safeHora = escapeHtml(record.hora);
                    safeFecha = escapeHtml(record.fecha);
                }
            }
            
            container.innerHTML += `
                <div class="activity-item ${colorClass}">
                    <div class="activity-icon ${colorClass}">
                        <i class="fas ${icon}"></i>
                    </div>
                    <div class="activity-info">
                        <span class="activity-name">${safeName}</span>
                        <span class="activity-detail">DNI: ${safeDni} • ${safeTipo}</span>
                    </div>
                    <div class="activity-time">
                        ${safeHora}<br>
                        <small>${safeFecha}</small>
                    </div>
                </div>
            `;
        });
        
        if (records.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay registros de hoy</p>';
        }
    } catch (error) {
        console.error('Error loading activity:', error);
    }
}

// ============================================================
// Utilidades
// ============================================================

function showNotification(message, type) {
    const notif = document.getElementById('notification');
    notif.textContent = message;
    notif.className = `notification ${type} show`;
    setTimeout(() => notif.classList.remove('show'), 4000);
}

function getAvatarColor(name) {
    const colors = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

// Sidebar toggle for mobile & tablet
function toggleSidebar(force) {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.overlay');
    if (!sidebar) return;
    
    const shouldOpen = (typeof force === 'boolean') ? force : !sidebar.classList.contains('active');
    if (shouldOpen) {
        sidebar.classList.add('active');
        if (overlay) overlay.classList.add('active');
    } else {
        sidebar.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
    }
}
window.toggleSidebar = toggleSidebar;

function closeSidebar() {
    toggleSidebar(false);
}
window.closeSidebar = closeSidebar;
