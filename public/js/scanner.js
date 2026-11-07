let html5QrcodeScanner = null;
let activeWorkerData = null;
let isStartingScanner = false;

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

async function stopScannerAsync() {
    if (html5QrcodeScanner) {
        try {
            if (html5QrcodeScanner.isScanning) {
                await html5QrcodeScanner.stop();
            }
            await html5QrcodeScanner.clear();
        } catch (e) {
            console.warn('Aviso al detener el escáner:', e);
        }
        html5QrcodeScanner = null;
        
        const statusEl = document.getElementById('scannerStatus');
        if (statusEl) {
            statusEl.textContent = 'Cámara detenida';
            statusEl.className = 'scanner-status';
        }
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
        // 1. Limpieza segura y completa de cualquier instancia previa
        await stopScannerAsync();

        // 2. Instancia nueva de Html5Qrcode
        html5QrcodeScanner = new Html5Qrcode('reader');
        
        const config = { 
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0,
            disableFlip: true
        };

        // 3. Iniciar cámara trasera de forma segura con facingMode 'environment'
        // Esto evita enumerar dispositivos y previene pasar IDs nulos/vacíos a Chromium
        await html5QrcodeScanner.start(
            { facingMode: 'environment' },
            config,
            onScanSuccess,
            () => {} // Ignorar fotogramas sin QR para fluidez
        );

        const statusEl = document.getElementById('scannerStatus');
        if (statusEl) {
            statusEl.textContent = 'Cámara activa - Escaneando...';
            statusEl.className = 'scanner-status active';
        }
    } catch (err) {
        console.warn('Aviso al iniciar cámara trasera, probando fallback:', err);
        
        // Fallback controlado a cámara frontal o genérica
        try {
            if (html5QrcodeScanner) {
                await html5QrcodeScanner.start(
                    { facingMode: 'user' },
                    { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0, disableFlip: true },
                    onScanSuccess,
                    () => {}
                );
                const statusEl = document.getElementById('scannerStatus');
                if (statusEl) {
                    statusEl.textContent = 'Cámara activa (Frontal) - Escaneando...';
                    statusEl.className = 'scanner-status active';
                }
                return;
            }
        } catch (fallbackErr) {
            console.error('Fallo en fallback de cámara:', fallbackErr);
        }

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

async function onScanSuccess(decodedText) {
    try {
        const data = JSON.parse(decodedText);
        if (data.dni && data.nombre) {
            if (!/^\d{8}$/.test(data.dni)) {
                showNotification('QR inválido: Formato de DNI incorrecto.', 'error');
                return;
            }
            activeWorkerData = data;
            
            // Show result section
            const resultSection = document.getElementById('scanResult');
            if (resultSection) {
                resultSection.style.display = 'block';
                resultSection.classList.add('animate-in');
            }
            
            // Update worker info
            const initials = data.nombre.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            const avatarEl = document.getElementById('resultAvatar');
            if (avatarEl) {
                avatarEl.textContent = initials;
                avatarEl.style.backgroundColor = getAvatarColor(data.nombre);
            }
            const nameEl = document.getElementById('resultName');
            if (nameEl) nameEl.textContent = data.nombre;
            const dniEl = document.getElementById('resultDni');
            if (dniEl) dniEl.textContent = `DNI: ${data.dni}`;
            
            // Detener el escáner de forma limpia mientras se confirma entrada/salida
            await stopScannerAsync();
            
            // Vibración háptica suave si está soportada
            if (navigator.vibrate) navigator.vibrate(200);
        }
    } catch (e) {
        showNotification('QR no reconocido. Intenta de nuevo.', 'error');
    }
}

// Sustituye la función recordAttendance por esta versión:
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
