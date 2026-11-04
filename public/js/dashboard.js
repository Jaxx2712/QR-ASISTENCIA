// Main dashboard functionality

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function isValidImageDataUrl(url) {
    return typeof url === 'string' && /^data:image\/(png|jpeg|jpg|webp);base64,/.test(url.trim());
}

let allWorkers = [];
let currentModalWorkerDni = null;
let currentModalYear = new Date().getFullYear();
let currentModalMonth = new Date().getMonth();

document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    loadWorkers();
    startClock();
    
    // Refresh every 30 seconds
    setInterval(() => {
        loadStats();
        loadWorkers();
    }, 30000);
});

// Clock
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

// Stats
async function loadStats() {
    try {
        const res = await fetch(`${API_URL}/api/dashboard`);
        if (!res.ok) throw new Error('Network error');
        const data = await res.json();
        
        animateValue('stat-total', data.totalWorkers || 0);
        animateValue('stat-asistencias', data.attendanceToday || 0);
        animateValue('stat-presentes', data.workersPresent || 0);
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

function animateValue(id, end) {
    const obj = document.getElementById(id);
    if (!obj) return;
    const start = parseInt(obj.textContent) || 0;
    if (start === end) return;
    
    const duration = 1000;
    const startTime = performance.now();
    
    const step = (currentTime) => {
        const progress = Math.min((currentTime - startTime) / duration, 1);
        const current = Math.floor(progress * (end - start) + start);
        obj.textContent = current;
        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            obj.textContent = end;
        }
    };
    requestAnimationFrame(step);
}

// Workers
async function loadWorkers() {
    try {
        const res = await fetch(`${API_URL}/api/workers`);
        if (!res.ok) throw new Error('Network error');
        allWorkers = await res.json();
        
        renderWorkers(allWorkers);
    } catch (error) {
        console.error('Error loading workers:', error);
        document.getElementById('workersGrid').innerHTML = '<p>Error al cargar trabajadores.</p>';
    }
}

async function renderWorkers(workersToRender) {
    const grid = document.getElementById('workersGrid');
    grid.innerHTML = '';
    
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    // 1. Obtener la asistencia de todos los trabajadores en paralelo
    const attendancePromises = workersToRender.map(async (worker) => {
        let attendanceDays = new Set();
        try {
            const attRes = await fetch(`${API_URL}/api/attendance/${worker.dni}?month=${year}-${String(month + 1).padStart(2, '0')}`);
            if (attRes.ok) {
                const attData = await attRes.json();
                attData.forEach(record => {
                    const utcString = record.timestamp || `${record.fecha}T${record.hora || '00:00:00'}Z`;
                    const localDate = new Date(utcString);
                    
                    if (localDate.getFullYear() === year && localDate.getMonth() === month) {
                        attendanceDays.add(localDate.getDate());
                    }
                });
            }
        } catch (e) {
            console.error('Error fetching attendance for', worker.dni);
        }
        return { dni: worker.dni, attendanceDays };
    });

    const attendanceResults = await Promise.all(attendancePromises);

    const attendanceMap = {};
    attendanceResults.forEach(item => {
        attendanceMap[item.dni] = item.attendanceDays;
    });

    // 2. Renderizar las tarjetas en la interfaz de forma fluida
    for (const worker of workersToRender) {
        const card = document.createElement('div');
        card.className = 'worker-card';
        
        const safeNombre = escapeHtml(worker.nombre);
        const safeDni = escapeHtml(worker.dni);
        const safeCargo = escapeHtml(worker.cargo || 'Empleado');

        const avatarColor = getAvatarColor(worker.nombre);
        const initials = worker.nombre.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        
        let avatarHtml = `<div class="avatar" style="background-color: ${avatarColor}">${initials}</div>`;
        if (worker.foto && isValidImageDataUrl(worker.foto)) {
            avatarHtml = `<div class="avatar" style="background-color: transparent; overflow: hidden;"><img src="${worker.foto}" style="width: 100%; height: 100%; object-fit: cover;"></div>`;
        }
        
        const attendanceDays = attendanceMap[worker.dni] || new Set();
        const miniCalendarHtml = generateMiniCalendar(year, month, attendanceDays);

        card.innerHTML = `
            <button class="btn-delete" onclick="deleteWorker(event, '${safeDni}')" title="Eliminar trabajador">
                <i class="fa-solid fa-trash"></i>
            </button>
            <div class="card-header">
                ${avatarHtml}
                <div class="worker-info">
                    <div class="worker-name" title="${safeNombre}">${safeNombre}</div>
                    <div class="worker-meta">DNI: ${safeDni} | ${safeCargo}</div>
                </div>
            </div>
            ${miniCalendarHtml}
            <button class="btn-detail" onclick="showWorkerDetail('${safeDni}')">Ver Detalle</button>
        `;
        
        grid.appendChild(card);
    }
}

// Search/Filter
function filterWorkers(query) {
    query = query.toLowerCase().trim();
    const filtered = allWorkers.filter(w => 
        w.nombre.toLowerCase().includes(query) || 
        w.dni.includes(query)
    );
    renderWorkers(filtered);
}

// Mini Calendar Generation
function generateMiniCalendar(year, month, attendanceDays) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay(); // 0 is Sunday
    // Adjust to Monday first (0=Mon, 6=Sun)
    let startDay = firstDay === 0 ? 6 : firstDay - 1;
    
    const now = new Date();
    const today = now.getDate();
    const isCurrentMonth = now.getFullYear() === year && now.getMonth() === month;

    let html = `
    <div class="mini-calendar">
        <div class="mc-header">
            <span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span>
        </div>
        <div class="mc-grid">
    `;

    // Empty cells before start day
    for (let i = 0; i < startDay; i++) {
        html += `<div class="mc-cell empty"></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
        let classes = ['mc-cell'];
        
        // Calculate day of week (0=Mon, 6=Sun)
        let dow = (startDay + day - 1) % 7;
        let isWeekend = (dow === 5 || dow === 6);

        if (attendanceDays.has(day)) {
            classes.push('attended');
        } else {
            if (isCurrentMonth) {
                if (day > today) {
                    classes.push('future');
                } else {
                    classes.push('absent');
                    if (isWeekend) classes.push('weekend');
                }
            } else if (new Date(year, month, day) > now) {
                classes.push('future');
            } else {
                classes.push('absent');
                if (isWeekend) classes.push('weekend');
            }
        }

        if (isCurrentMonth && day === today) {
            classes.push('today');
        }

        html += `<div class="${classes.join(' ')}">${day}</div>`;
    }

    html += `
        </div>
    </div>
    `;
    
    return html;
}

// Worker Detail Modal
async function showWorkerDetail(dni) {
    currentModalWorkerDni = dni;
    const worker = allWorkers.find(w => w.dni === dni);
    if (!worker) return;

    // Set Header
    const avatarEl = document.getElementById('modalAvatar');
    if (worker.foto && isValidImageDataUrl(worker.foto)) {
        avatarEl.innerHTML = `<img src="${worker.foto}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
        avatarEl.style.backgroundColor = 'transparent';
    } else {
        const avatarColor = getAvatarColor(worker.nombre);
        const initials = worker.nombre.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        avatarEl.style.backgroundColor = avatarColor;
        avatarEl.textContent = initials;
    }
    
    document.getElementById('modalWorkerName').textContent = worker.nombre;
    document.getElementById('modalWorkerDni').textContent = `DNI: ${worker.dni} | Cargo: ${worker.cargo || 'Empleado'}`;

    // Reset month to current
    const now = new Date();
    currentModalYear = now.getFullYear();
    currentModalMonth = now.getMonth();

    await loadModalCalendar(dni, currentModalYear, currentModalMonth);

    // Show modal
    document.getElementById('workerModal').classList.add('active');
}

function closeModal() {
    document.getElementById('workerModal').classList.remove('active');
    currentModalWorkerDni = null;
}

// Month navigation in modal
async function prevMonth() {
    currentModalMonth--;
    if (currentModalMonth < 0) {
        currentModalMonth = 11;
        currentModalYear--;
    }
    await loadModalCalendar(currentModalWorkerDni, currentModalYear, currentModalMonth);
}

async function nextMonth() {
    currentModalMonth++;
    if (currentModalMonth > 11) {
        currentModalMonth = 0;
        currentModalYear++;
    }
    await loadModalCalendar(currentModalWorkerDni, currentModalYear, currentModalMonth);
}

async function loadModalCalendar(dni, year, month) {
    // Update month name header
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    document.getElementById('modalMonthName').textContent = `${monthNames[month]} ${year}`;

    const grid = document.getElementById('modalCalendarGrid');
    grid.innerHTML = '';

    // Fetch attendance
    let attendanceData = {};
    // CÓDIGO ACTUALIZADO PARA EL MODAL DE DETALLE:
    try {
        const attRes = await fetch(`${API_URL}/api/attendance/${dni}?month=${year}-${String(month + 1).padStart(2, '0')}`);
        if (attRes.ok) {
            const records = await attRes.json();
            records.forEach(r => {
                const utcString = r.timestamp || `${r.fecha}T${r.hora || '00:00:00'}Z`;
                const localDate = new Date(utcString);
                
                if (localDate.getFullYear() === year && localDate.getMonth() === month) {
                    const day = localDate.getDate();
                    if (!attendanceData[day]) {
                        attendanceData[day] = { hora_entrada: null, hora_salida: null };
                    }
                    
                    // Convertimos también las horas de entrada/salida a formato local
                    const horaLocalStr = localDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    
                    if (r.tipo === 'Entrada') {
                        attendanceData[day].hora_entrada = horaLocalStr;
                    } else if (r.tipo === 'Salida') {
                        attendanceData[day].hora_salida = horaLocalStr;
                    }
                }
            });
        }
    } catch (e) {
        console.error('Error fetching details for modal:', e);
    }

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    let startDay = firstDay === 0 ? 6 : firstDay - 1;
    
    const now = new Date();
    const today = now.getDate();
    const isCurrentMonth = now.getFullYear() === year && now.getMonth() === month;

    let attendedDaysCount = 0;
    let workDaysCount = 0;

    // Empty cells before start
    for (let i = 0; i < startDay; i++) {
        const cell = document.createElement('div');
        cell.className = 'lc-cell empty';
        grid.appendChild(cell);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        let dow = (startDay + day - 1) % 7;
        let isWeekend = (dow === 5 || dow === 6);
        
        const cell = document.createElement('div');
        let classes = ['lc-cell'];
        let contentHtml = `<div class="lc-date">${day}</div>`;

        if (attendanceData[day]) {
            classes.push('attended');
            attendedDaysCount++;
            if(!isWeekend) workDaysCount++;
            
            contentHtml += `<div class="lc-times">`;
            if (attendanceData[day].hora_entrada) {
                contentHtml += `<span class="lc-time-in">Ent: ${attendanceData[day].hora_entrada}</span>`;
            }
            if (attendanceData[day].hora_salida) {
                contentHtml += `<span class="lc-time-out">Sal: ${attendanceData[day].hora_salida}</span>`;
            }
            contentHtml += `</div>`;
        } else {
            if (isCurrentMonth) {
                if (day > today) {
                    classes.push('future');
                } else {
                    classes.push('absent');
                    if(!isWeekend) workDaysCount++;
                }
            } else if (new Date(year, month, day) > now) {
                classes.push('future');
            } else {
                classes.push('absent');
                if(!isWeekend) workDaysCount++;
            }
        }

        cell.className = classes.join(' ');
        cell.innerHTML = contentHtml;
        grid.appendChild(cell);
    }

    // Fill remaining cells
    const totalCells = startDay + daysInMonth;
    const remainingCells = (7 - (totalCells % 7)) % 7;
    for (let i = 0; i < remainingCells; i++) {
        const cell = document.createElement('div');
        cell.className = 'lc-cell empty';
        grid.appendChild(cell);
    }

    // Update stats
    // Let's count total laborable days as weekdays up to today for current month, or all weekdays for past months
    let totalLaborable = 0;
    for (let day = 1; day <= daysInMonth; day++) {
        let dow = (startDay + day - 1) % 7;
        if (dow !== 5 && dow !== 6) { // Not weekend
            if (isCurrentMonth) {
                if (day <= today) totalLaborable++;
            } else if (new Date(year, month, day) < now) {
                totalLaborable++;
            }
        }
    }

    document.getElementById('summaryAttended').textContent = attendedDaysCount;
    document.getElementById('summaryTotal').textContent = totalLaborable;
    
    let percentage = totalLaborable > 0 ? Math.round((attendedDaysCount / totalLaborable) * 100) : 0;
    // Cap at 100 if they attended weekends
    if (percentage > 100) percentage = 100;
    
    document.getElementById('summaryPercentage').textContent = `${percentage}%`;
}

// Avatar color generator
function getAvatarColor(name) {
    const colors = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

// Delete worker
async function deleteWorker(e, dni) {
    // Evitar propagación de eventos de forma segura con el argumento 'e'
    if (e) {
        e.stopPropagation();
    }

    if (!confirm('¿Estás seguro de eliminar este trabajador y todos sus registros?')) return;

    try {
        const res = await fetch(`${API_URL}/api/workers/${dni}`, { method: 'DELETE' });
        if (res.ok) {
            // Remove from global array and re-render
            allWorkers = allWorkers.filter(w => w.dni !== dni);
            renderWorkers(allWorkers);
            loadStats();
        } else {
            alert('Error al eliminar el trabajador');
        }
    } catch (e) {
        console.error('Error deleting worker:', e);
        alert('Error de conexión al eliminar el trabajador');
    }
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
