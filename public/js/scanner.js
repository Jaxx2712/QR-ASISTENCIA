let html5QrcodeScanner = null;
let activeWorkerData = null;

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

// Live real-time clock
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

function startScanner() {
    if (html5QrcodeScanner) return;
    
    const readerElement = document.getElementById('reader');
    readerElement.style.display = 'block';
    
    html5QrcodeScanner = new Html5Qrcode('reader');
    
    html5QrcodeScanner.start(
        { facingMode: 'environment' },
        { 
            fps: 10, 
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0
        },
        onScanSuccess,
        () => {} // Ignore frame errors
    ).then(() => {
        document.getElementById('scannerStatus').textContent = 'Cámara activa - Esperando QR...';
        document.getElementById('scannerStatus').className = 'scanner-status active';
    }).catch(err => {
        showNotification('No se pudo acceder a la cámara. Verifica los permisos.', 'error');
    });
}

function stopScanner() {
    if (html5QrcodeScanner) {
        html5QrcodeScanner.stop().then(() => {
            html5QrcodeScanner = null;
            document.getElementById('scannerStatus').textContent = 'Cámara detenida';
            document.getElementById('scannerStatus').className = 'scanner-status';
        });
    }
}

function onScanSuccess(decodedText) {
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
            resultSection.style.display = 'block';
            resultSection.classList.add('animate-in');
            
            // Update worker info
            const initials = data.nombre.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            document.getElementById('resultAvatar').textContent = initials;
            document.getElementById('resultAvatar').style.backgroundColor = getAvatarColor(data.nombre);
            document.getElementById('resultName').textContent = data.nombre;
            document.getElementById('resultDni').textContent = `DNI: ${data.dni}`;
            
            // Stop scanner temporarily
            stopScanner();
            
            // Play a subtle beep/vibration if available
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
        // Obtenemos la hora LOCAL exacta del dispositivo (evita el salto de 4 horas)
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const fechaLocal = `${year}-${month}-${day}`;

        // Usamos getHours(), getMinutes() y getSeconds() locales
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const horaLocal = `${hours}:${minutes}:${seconds}`;

        const response = await fetch(`${API_URL}/api/attendance`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({ 
                worker_dni: activeWorkerData.dni, 
                tipo: tipo,
                fecha: fechaLocal,  // Enviamos la fecha local correcta
                hora: horaLocal     // Enviamos la hora local exacta (2:21 en vez de 6:21)
            })
        });

        const data = await response.json();

        if (response.ok) {
            showNotification(data.message || `¡Asistencia (${tipo.toUpperCase()}) registrada correctamente!`, 'success');
            
            const resultSection = document.getElementById('scanResult');
            if (resultSection) resultSection.style.display = 'none';
            activeWorkerData = null;
            
            if (typeof startScanner === 'function') startScanner();
            if (typeof loadRecentActivity === 'function') loadRecentActivity();
        } else {
            showNotification(data.message || data.error || 'Error al registrar asistencia', 'error');
        }
    } catch (err) {
        console.error('Error registrando asistencia:', err);
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
            
            // Usar directamente la hora y fecha local guardadas sin parsearlas con new Date()
            let safeHora = escapeHtml(record.hora || '--:--:--');
            let safeFecha = escapeHtml(record.fecha || '--/--/----');
            
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