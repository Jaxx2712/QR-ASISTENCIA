const API_URL = 'https://qr-asistencia-backend-keum.onrender.com';

// Daily Attendance Report Functionality

let currentRecords = [];
let currentFecha = '';
let currentDia = 1;

document.addEventListener('DOMContentLoaded', () => {
    initDate();
    startClock();
    loadDailyReport();

    // Auto-refresh every 30 seconds to show live entries and exits
    setInterval(() => {
        loadDailyReport(true);
    }, 30000);
});

// Helper to escape HTML and prevent XSS
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

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

// Initialize date input to today
function initDate() {
    const dateInput = document.getElementById('reportDate');
    if (!dateInput) return;
    
    const now = new Date();
    // Use Peru timezone / local date
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;
    
    dateInput.value = todayStr;
    currentFecha = todayStr;
}

function setTodayDate() {
    initDate();
    loadDailyReport();
}

// Load daily attendance from API
async function loadDailyReport(isSilent = false) {
    const dateInput = document.getElementById('reportDate');
    const selectedDate = dateInput ? dateInput.value : currentFecha;
    
    if (!selectedDate) return;
    currentFecha = selectedDate;

    try {
        const res = await fetch(`${API_URL}/api/reports/daily?fecha=${selectedDate}`);
        if (!res.ok) throw new Error('Error al consultar el reporte');
        const data = await res.json();

        currentRecords = data.records || [];
        currentDia = data.dia || parseInt(selectedDate.split('-')[2], 10);

        renderReport(data);
    } catch (err) {
        console.error('Error cargando reporte diario:', err);
        if (!isSilent) {
            alert('No se pudo cargar el reporte: ' + err.message);
        }
    }
}

// Render Table and Stats
function renderReport(data) {
    const diaNumber = data.dia;
    const records = data.records || [];
    
    // Update titles
    const titleText = `Dia ${diaNumber}`;
    const excelTableTitle = document.getElementById('excelTableTitle');
    const badgeDiaTitle = document.getElementById('badgeDiaTitle');
    if (excelTableTitle) excelTableTitle.textContent = titleText;
    if (badgeDiaTitle) badgeDiaTitle.textContent = titleText;

    // Calculate stats
    const totalAttended = records.length;
    let presentCount = 0;
    let exitedCount = 0;

    records.forEach(r => {
        if (r.hora_entrada && !r.hora_salida) {
            presentCount++;
        } else if (r.hora_salida) {
            exitedCount++;
        }
    });

    const statTotalEl = document.getElementById('statTotalAttended');
    const statPresentEl = document.getElementById('statPresent');
    const statExitedEl = document.getElementById('statExited');

    if (statTotalEl) statTotalEl.textContent = totalAttended;
    if (statPresentEl) statPresentEl.textContent = presentCount;
    if (statExitedEl) statExitedEl.textContent = exitedCount;

    // Render table body
    const tbody = document.getElementById('excelTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Render worker records
    records.forEach(rec => {
        const tr = document.createElement('tr');
        tr.className = 'excel-data-row';
        tr.innerHTML = `
            <td>${escapeHtml(rec.dni)}</td>
            <td>${escapeHtml(rec.nombre)}</td>
            <td>${escapeHtml(rec.hora_entrada_fmt || '')}</td>
            <td>${escapeHtml(rec.hora_salida_fmt || '')}</td>
        `;
        tbody.appendChild(tr);
    });

    // To mirror the image format exactly, render empty bordered rows up to 15 total rows
    const minRows = 13; // 2 header rows + 13 data rows = 15 rows total in sheet
    const emptyRowsToAdd = Math.max(0, minRows - records.length);
    for (let i = 0; i < emptyRowsToAdd; i++) {
        const emptyTr = document.createElement('tr');
        emptyTr.className = 'excel-empty-row';
        emptyTr.innerHTML = `
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
        `;
        tbody.appendChild(emptyTr);
    }
}

// Download Excel report
function downloadExcelReport() {
    const dateInput = document.getElementById('reportDate');
    const fecha = dateInput ? dateInput.value : currentFecha;
    if (!fecha) {
        alert('Selecciona una fecha válida');
        return;
    }

    // Direct download from server (guarantees native Excel styling, exact borders and fonts)
    const downloadUrl = `${API_URL}/api/reports/daily/download?fecha=${encodeURIComponent(fecha)}`;
    
    // Trigger download
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

