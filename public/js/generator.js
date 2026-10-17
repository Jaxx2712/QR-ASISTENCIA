document.addEventListener('DOMContentLoaded', () => {
    startClock();
    loadWorkersList();
});

// Live clock
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

async function generateQR() {
    const dni = document.getElementById('workerDni').value.trim();
    const nombre = document.getElementById('workerName').value.trim();
    const cargo = document.getElementById('workerCargo').value.trim();
    const empresa = document.getElementById('workerEmpresa').value.trim();
    const photoInput = document.getElementById('workerFoto');

    // Validation
    if (!dni || !nombre) {
        showNotification('Por favor ingresa DNI y Nombre completo.', 'error');
        return;
    }
    
    if (!/^\d{8}$/.test(dni)) {
        showNotification('El DNI debe contener exactamente 8 números.', 'error');
        return;
    }

    if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/.test(nombre)) {
        showNotification('El nombre solo puede contener letras y espacios.', 'error');
        return;
    }

    // Read photo if any
    let foto = '';
    if (photoInput && photoInput.files.length > 0) {
        foto = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(photoInput.files[0]);
        });
    }

    try {
        const response = await fetch('/api/workers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dni, nombre, cargo, empresa, foto })
        });

        const data = await response.json();

        if (!response.ok) {
            showNotification(data.message || data.error, 'error');
            return;
        }

        // Generate QR code
        const qrCanvas = document.getElementById('qrCanvas');
        new QRious({
            element: qrCanvas,
            value: JSON.stringify({ dni, nombre }),
            size: 200,
            level: 'H',
            background: '#ffffff',
            foreground: '#1e3a5f'
        });

        // Show the badge preview
        renderBadgePreview({ dni, nombre, cargo, empresa, foto });
        
        showNotification('¡Trabajador registrado exitosamente!', 'success');
        loadWorkersList();

    } catch (error) {
        showNotification('Error de conexión con el servidor.', 'error');
    }
}

function renderBadgePreview({ dni, nombre, cargo, empresa, foto }) {
    // Show the badge section
    document.getElementById('badgePreview').style.display = 'block';
    
    // Update badge content
    document.getElementById('badgeEmpresa').textContent = empresa || 'EMPRESA';
    document.getElementById('badgeNombre').textContent = nombre;
    document.getElementById('badgeCargo').textContent = cargo || 'Trabajador';
    document.getElementById('badgeDni').textContent = `DNI: ${dni}`;
    
    // Avatar
    const avatar = document.getElementById('badgeAvatar');
    if (foto) {
        avatar.innerHTML = `<img src="${foto}" alt="Perfil" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
        avatar.style.backgroundColor = 'transparent';
    } else {
        const initials = nombre.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        avatar.textContent = initials;
        avatar.style.backgroundColor = getAvatarColor(nombre);
    }
    
    // Scroll to badge
    document.getElementById('badgePreview').scrollIntoView({ behavior: 'smooth' });
}

async function downloadBadge() {
    // Create an offscreen canvas and draw the badge exactly like the UI
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 600;
    canvas.height = 900;
    
    // Background
    ctx.beginPath();
    ctx.fillStyle = '#ffffff';
    ctx.roundRect(0, 0, 600, 900, 24); // 12px * 2
    ctx.fill();
    
    // Header gradient
    ctx.beginPath();
    const headerGrad = ctx.createLinearGradient(0, 0, 600, 0);
    headerGrad.addColorStop(0, '#1e3a5f');
    headerGrad.addColorStop(1, '#2d5a8e');
    ctx.fillStyle = headerGrad;
    ctx.roundRect(0, 0, 600, 160, [24, 24, 0, 0]); // 80px * 2
    ctx.fill();
    
    // Company name
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px Inter, sans-serif'; // 18px * 2
    ctx.textAlign = 'center';
    const empresa = document.getElementById('badgeEmpresa').textContent;
    ctx.fillText(empresa, 300, 80);
    
    // Subtitle
    ctx.font = '20px Inter, sans-serif'; // 10px * 2
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('CARNET DE ASISTENCIA', 300, 120);
    
    // Avatar circle (matches the UI overlapping position)
    const centerY = 200; // 40px * 2 (top) + 50px * 2 (center)
    const outerRadius = 60; // 50px * 2
    const innerRadius = 50; // (50px - 4px) * 2

    // White padding background for avatar
    ctx.beginPath();
    ctx.arc(300, centerY, outerRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Avatar image or initials
    const nombre = document.getElementById('badgeNombre').textContent;
    const avatarContainer = document.getElementById('badgeAvatar');
    const imgEl = avatarContainer.querySelector('img');

    ctx.beginPath();
    ctx.arc(300, centerY, innerRadius, 0, Math.PI * 2);
    
    if (imgEl) {
        ctx.save();
        ctx.clip();
        
        // Simulating object-fit: cover
        const imgRatio = (imgEl.naturalWidth || 1) / (imgEl.naturalHeight || 1);
        const targetSize = innerRadius * 2;
        let drawWidth = targetSize;
        let drawHeight = targetSize;
        let offsetX = 300 - innerRadius;
        let offsetY = centerY - innerRadius;

        if (imgRatio > 1) { // Landscape
            drawWidth = targetSize * imgRatio;
            offsetX = 300 - (drawWidth / 2);
        } else if (imgRatio < 1) { // Portrait
            drawHeight = targetSize / imgRatio;
            offsetY = centerY - (drawHeight / 2);
        }

        ctx.drawImage(imgEl, offsetX, offsetY, drawWidth, drawHeight);
        ctx.restore();
    } else {
        const initials = nombre.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        ctx.fillStyle = getAvatarColor(nombre);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 64px Inter, sans-serif'; 
        ctx.fillText(initials, 300, centerY + 22);
    }
    
    // Name
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 36px Inter, sans-serif'; 
    ctx.fillText(nombre, 300, 320);
    
    // Cargo
    const cargo = document.getElementById('badgeCargo').textContent;
    ctx.font = '26px Inter, sans-serif'; 
    ctx.fillStyle = '#64748b';
    ctx.fillText(cargo, 300, 365);
    
    // DNI
    const dniText = document.getElementById('badgeDni').textContent;
    ctx.font = '24px Inter, sans-serif'; 
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(dniText, 300, 405);
    
    // Separator line
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(120, 440);
    ctx.lineTo(480, 440);
    ctx.stroke();
    
    // QR Code Container
    // UI: width 130px (scaled to 260px), padding 5px (10px), border 1px (2px), border-radius 5px (10px)
    ctx.beginPath();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.roundRect(170, 480, 260, 260, 10);
    ctx.fill();
    ctx.stroke();
    
    // QR Code Image
    const qrCanvas = document.getElementById('qrCanvas');
    ctx.drawImage(qrCanvas, 180, 490, 240, 240);
    
    // Footer text
    ctx.font = '18px Inter, sans-serif'; // 9px * 2
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Escanea este código para', 300, 780);
    ctx.fillText('registrar asistencia', 300, 805);
    
    // Outer Card border (matches the 1px solid #e2e8f0)
    ctx.beginPath();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.roundRect(1, 1, 598, 898, 24);
    ctx.stroke();
    
    // Download
    const link = document.createElement('a');
    const safeName = nombre.replace(/\s+/g, '_');
    link.download = `Carnet_${safeName}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

// For re-downloading a badge from the workers list
async function regenerateBadge(dni) {
    const res = await fetch(`/api/workers/${dni}`);
    const worker = await res.json();
    
    // Generate QR
    const qrCanvas = document.getElementById('qrCanvas');
    new QRious({
        element: qrCanvas,
        value: JSON.stringify({ dni: worker.dni, nombre: worker.nombre }),
        size: 200,
        level: 'H',
        background: '#ffffff',
        foreground: '#1e3a5f'
    });
    
    renderBadgePreview(worker);
    // Auto download after a small delay
    setTimeout(() => downloadBadge(), 500);
}

function resetForm() {
    document.getElementById('workerDni').value = '';
    document.getElementById('workerName').value = '';
    document.getElementById('workerCargo').value = '';
    document.getElementById('workerEmpresa').value = '';
    const photoInput = document.getElementById('workerFoto');
    if (photoInput) photoInput.value = '';
    document.getElementById('badgePreview').style.display = 'none';
    document.getElementById('workerDni').focus();
}

// Sanitize string to prevent XSS
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

async function loadWorkersList() {
    try {
        const res = await fetch('/api/workers');
        const workers = await res.json();
        const tbody = document.getElementById('workersTable');
        tbody.innerHTML = '';
        
        workers.forEach(w => {
            const date = new Date(w.created_at).toLocaleDateString('es-PE');
            const safeDni = escapeHtml(w.dni);
            const safeName = escapeHtml(w.nombre);
            const safeCargo = escapeHtml(w.cargo) || '-';
            const safeEmpresa = escapeHtml(w.empresa) || '-';
            tbody.innerHTML += `
                <tr>
                    <td>${safeDni}</td>
                    <td>${safeName}</td>
                    <td>${safeCargo}</td>
                    <td>${safeEmpresa}</td>
                    <td>${date}</td>
                    <td>
                        <button class="btn-icon" onclick="regenerateBadge('${safeDni}')" title="Descargar carnet">
                            <i class="fas fa-download"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
    } catch (error) {
        console.error('Error loading workers:', error);
    }
}

function showNotification(message, type) {
    const notif = document.getElementById('notification');
    notif.textContent = message;
    notif.className = `notification ${type} show`;
    setTimeout(() => notif.classList.remove('show'), 3000);
}

function getAvatarColor(name) {
    const colors = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

// Sidebar toggle
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