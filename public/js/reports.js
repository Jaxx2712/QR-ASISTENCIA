// Reports Functionality: Diarios, Semanales y Mensuales

let currentSubSection = 'daily'; // 'daily' | 'weekly' | 'monthly'
let currentRecords = [];

document.addEventListener('DOMContentLoaded', () => {
    initFilters();
    startClock();
    loadCurrentReport();

    // Auto-refresh every 30 seconds
    setInterval(() => {
        loadCurrentReport(true);
    }, 30000);
});

// Helper to escape HTML and prevent XSS
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatLocalTime(fechaStr, horaStr) {
    if (!horaStr) return '';
    // Asegurar formato ISO con 'Z' para conversión UTC -> Local automática
    const cleanHora = horaStr.includes('Z') ? horaStr : `${horaStr}Z`;
    const dateObj = new Date(`${fechaStr}T${cleanHora}`);
    
    if (!isNaN(dateObj.getTime())) {
        return dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }
    return horaStr;
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

// Format local date YYYY-MM-DD
function getTodayString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getCurrentMonthString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

// Initialize filter values
function initFilters() {
    const today = getTodayString();
    const curMonth = getCurrentMonthString();

    const dateInput = document.getElementById('reportDate');
    if (dateInput && !dateInput.value) dateInput.value = today;

    const weekInput = document.getElementById('reportWeekDate');
    if (weekInput && !weekInput.value) weekInput.value = today;

    const monthInput = document.getElementById('reportMonth');
    if (monthInput && !monthInput.value) monthInput.value = curMonth;
}

function setTodayDate() {
    const dateInput = document.getElementById('reportDate');
    if (dateInput) dateInput.value = getTodayString();
    loadCurrentReport();
}

function setCurrentWeekDate() {
    const weekInput = document.getElementById('reportWeekDate');
    if (weekInput) weekInput.value = getTodayString();
    loadCurrentReport();
}

function setCurrentMonth() {
    const monthInput = document.getElementById('reportMonth');
    if (monthInput) monthInput.value = getCurrentMonthString();
    loadCurrentReport();
}

// Switch between sub-sections
function switchReportSubSection(section) {
    if (currentSubSection === section) return;
    currentSubSection = section;

    // Update buttons active state
    document.getElementById('tabDailyBtn').classList.toggle('active', section === 'daily');
    document.getElementById('tabWeeklyBtn').classList.toggle('active', section === 'weekly');
    document.getElementById('tabMonthlyBtn').classList.toggle('active', section === 'monthly');

    // Toggle filter bars
    document.getElementById('filterContainerDaily').style.display = section === 'daily' ? 'flex' : 'none';
    document.getElementById('filterContainerWeekly').style.display = section === 'weekly' ? 'flex' : 'none';
    document.getElementById('filterContainerMonthly').style.display = section === 'monthly' ? 'flex' : 'none';

    // Update descriptions and headers
    const bannerTitle = document.getElementById('reportBannerTitle');
    const bannerDesc = document.getElementById('reportBannerDesc');
    const thCol3 = document.getElementById('thCol3');
    const thCol4 = document.getElementById('thCol4');
    const thCol5 = document.getElementById('thCol5');
    const titleCell = document.getElementById('excelTableTitle');
    const btnExcel = document.getElementById('btnDownloadExcel');

    if (section === 'daily') {
        bannerTitle.innerHTML = '<i class="fa-solid fa-calendar-day" style="color: #f59e0b;"></i> Reportes Diarios';
        bannerDesc.textContent = 'Registro de asistencia diaria: DNI, Nombre, Hora de entrada, Hora de salida y Horas trabajadas.';
        thCol3.textContent = 'hora de entrada';
        thCol4.textContent = 'hora de salida';
        if (thCol5) thCol5.style.display = '';
        if (titleCell) titleCell.colSpan = 5;
        btnExcel.innerHTML = '<i class="fa-solid fa-file-excel"></i> Descargar Excel Diario';
        document.getElementById('statLabel1').textContent = 'Asistieron Hoy';
        document.getElementById('statLabel2').textContent = 'En Sitio (Presentes)';
        document.getElementById('statLabel3').textContent = 'Salidas Registradas';
    } else if (section === 'weekly') {
        bannerTitle.innerHTML = '<i class="fa-solid fa-calendar-week" style="color: #3b82f6;"></i> Reportes Semanales';
        bannerDesc.textContent = 'Resumen semanal de asistencia: DNI, Nombre, Días asistidos y Días faltados.';
        thCol3.textContent = 'dias asistidos';
        thCol4.textContent = 'dias faltados';
        if (thCol5) thCol5.style.display = 'none';
        if (titleCell) titleCell.colSpan = 4;
        btnExcel.innerHTML = '<i class="fa-solid fa-file-excel"></i> Descargar Excel Semanal';
        document.getElementById('statLabel1').textContent = 'Total Trabajadores';
        document.getElementById('statLabel2').textContent = 'Promedio Días Asist.';
        document.getElementById('statLabel3').textContent = 'Días Faltados Totales';
    } else if (section === 'monthly') {
        bannerTitle.innerHTML = '<i class="fa-solid fa-calendar-days" style="color: #10b981;"></i> Reportes Mensuales';
        bannerDesc.textContent = 'Balance mensual de asistencia: DNI, Nombre, Días asistidos y Días faltados.';
        thCol3.textContent = 'dias asistidos';
        thCol4.textContent = 'dias faltados';
        if (thCol5) thCol5.style.display = 'none';
        if (titleCell) titleCell.colSpan = 4;
        btnExcel.innerHTML = '<i class="fa-solid fa-file-excel"></i> Descargar Excel Mensual';
        document.getElementById('statLabel1').textContent = 'Total Trabajadores';
        document.getElementById('statLabel2').textContent = 'Promedio Días Asist.';
        document.getElementById('statLabel3').textContent = 'Días Faltados Totales';
    }

    loadCurrentReport();
}

// Router to load the active report
function loadCurrentReport(isSilent = false) {
    if (currentSubSection === 'daily') {
        loadDailyReport(isSilent);
    } else if (currentSubSection === 'weekly') {
        loadWeeklyReport(isSilent);
    } else if (currentSubSection === 'monthly') {
        loadMonthlyReport(isSilent);
    }
}

// Helper para calcular horas trabajadas en el frontend
function calculateClientHoursWorked(fechaStr, entrada, salida) {
    if (!entrada || !salida) return '-';
    try {
        let d1 = new Date(`${fechaStr}T${entrada}`);
        let d2 = new Date(`${fechaStr}T${salida}`);     
        
        // Si la hora de salida es menor o igual a la de entrada, el turno pasa al día siguiente
        if (d2 <= d1) {
            d2.setDate(d2.getDate() + 1);
        }

        const diffMs = d2.getTime() - d1.getTime();
        if (diffMs <= 0) return '0 hrs';
        
        const totalMinutes = Math.round(diffMs / 60000);
        const hrs = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        
        if (mins === 0) return `${hrs} ${hrs === 1 ? 'hora' : 'horas'}`;
        if (hrs === 0) return `${mins} min`;
        return `${hrs}h ${mins}m`;
    } catch (e) {
        return '-';
    }
}

// Load daily report
async function loadDailyReport(isSilent = false) {
    const dateInput = document.getElementById('reportDate');
    const selectedDate = (dateInput && dateInput.value) ? dateInput.value : getTodayString();
    const userTz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');

    try {
        const res = await fetch(`${API_URL}/api/reports/daily?fecha=${encodeURIComponent(selectedDate)}&tz=${userTz}`);
        if (!res.ok) throw new Error('Error al consultar el reporte diario');
        const data = await res.json();

        currentRecords = data.records || [];
        renderDailyTable(data);
    } catch (err) {
        console.error('Error cargando reporte diario:', err);
        if (!isSilent) {
            alert('No se pudo cargar el reporte diario: ' + err.message);
        }
    }
}

// Load weekly report
async function loadWeeklyReport(isSilent = false) {
    const weekInput = document.getElementById('reportWeekDate');
    const selectedDate = (weekInput && weekInput.value) ? weekInput.value : getTodayString();

    try {
        const res = await fetch(`${API_URL}/api/reports/weekly?fecha=${encodeURIComponent(selectedDate)}`);
        if (!res.ok) throw new Error('Error al consultar el reporte semanal');
        const data = await res.json();

        currentRecords = data.records || [];
        renderWeeklyTable(data);
    } catch (err) {
        console.error('Error cargando reporte semanal:', err);
        if (!isSilent) {
            alert('No se pudo cargar el reporte semanal: ' + err.message);
        }
    }
}

// Load monthly report
async function loadMonthlyReport(isSilent = false) {
    const monthInput = document.getElementById('reportMonth');
    const selectedMonth = (monthInput && monthInput.value) ? monthInput.value : getCurrentMonthString();

    try {
        const res = await fetch(`${API_URL}/api/reports/monthly?mes=${encodeURIComponent(selectedMonth)}`);
        if (!res.ok) throw new Error('Error al consultar el reporte mensual');
        const data = await res.json();

        currentRecords = data.records || [];
        renderMonthlyTable(data);
    } catch (err) {
        console.error('Error cargando reporte mensual:', err);
        if (!isSilent) {
            alert('No se pudo cargar el reporte mensual: ' + err.message);
        }
    }
}

// Render Daily Table (con 5 columnas incluyendo horas trabajadas)
function renderDailyTable(data) {
    const diaNumber = data.dia;
    const records = data.records || [];
    
    const titleText = data.titulo || `Dia ${diaNumber}`;
    const titleCell = document.getElementById('excelTableTitle');
    if (titleCell) {
        titleCell.textContent = titleText;
        titleCell.colSpan = 5;
    }
    const thCol5 = document.getElementById('thCol5');
    if (thCol5) thCol5.style.display = '';

    document.getElementById('badgeDiaTitle').textContent = `Dia ${diaNumber}`;

    let totalAttended = records.length;
    let presentCount = 0;
    let exitedCount = 0;

    records.forEach(r => {
        if (r.hora_entrada && !r.hora_salida) {
            presentCount++;
        } else if (r.hora_salida) {
            exitedCount++;
        }
    });

    document.getElementById('statVal1').textContent = totalAttended;
    document.getElementById('statVal2').textContent = presentCount;
    document.getElementById('statVal3').textContent = exitedCount;

    // APLICAMOS LA CONVERSIÓN A HORA LOCAL Y CÁLCULO DE HORAS TRABAJADAS:
    renderTableBody(records, rec => {
        const localEntrada = formatLocalTime(data.fecha, rec.hora_entrada);
        const localSalida = formatLocalTime(data.fecha, rec.hora_salida);
        const horas = rec.total_horas || calculateClientHoursWorked(data.fecha, rec.hora_entrada, rec.hora_salida);
        return `
            <td>${escapeHtml(rec.dni)}</td>
            <td>${escapeHtml(rec.nombre)}</td>
            <td>${escapeHtml(localEntrada || '-')}</td>
            <td>${escapeHtml(localSalida || '-')}</td>
            <td><span class="badge-hours">${escapeHtml(horas)}</span></td>
        `;
    }, 5);
}

// Render Weekly Table
function renderWeeklyTable(data) {
    const records = data.records || [];
    const titleText = data.titulo || 'Reporte Semanal';
    
    const titleCell = document.getElementById('excelTableTitle');
    if (titleCell) {
        titleCell.textContent = titleText;
        titleCell.colSpan = 4;
    }
    const thCol5 = document.getElementById('thCol5');
    if (thCol5) thCol5.style.display = 'none';

    document.getElementById('badgeDiaTitle').textContent = `Semana (${data.startDate || ''} al ${data.endDate || ''})`;

    const totalWorkers = records.length;
    let totalAsistidos = 0;
    let totalFaltados = 0;

    records.forEach(r => {
        totalAsistidos += Number(r.dias_asistidos || 0);
        totalFaltados += Number(r.dias_faltados || 0);
    });

    const avgAsist = totalWorkers > 0 ? (totalAsistidos / totalWorkers).toFixed(1) : '0';

    document.getElementById('statVal1').textContent = totalWorkers;
    document.getElementById('statVal2').textContent = avgAsist;
    document.getElementById('statVal3').textContent = totalFaltados;

    renderTableBody(records, rec => `
        <td>${escapeHtml(rec.dni)}</td>
        <td>${escapeHtml(rec.nombre)}</td>
        <td>${escapeHtml(rec.dias_asistidos)}</td>
        <td>${escapeHtml(rec.dias_faltados)}</td>
    `, 4);
}

// Render Monthly Table
function renderMonthlyTable(data) {
    const records = data.records || [];
    const titleText = data.titulo || `Mes ${data.mes || ''}`;
    
    const titleCell = document.getElementById('excelTableTitle');
    if (titleCell) {
        titleCell.textContent = titleText;
        titleCell.colSpan = 4;
    }
    const thCol5 = document.getElementById('thCol5');
    if (thCol5) thCol5.style.display = 'none';

    document.getElementById('badgeDiaTitle').textContent = `Mes (${data.mes || ''})`;

    const totalWorkers = records.length;
    let totalAsistidos = 0;
    let totalFaltados = 0;

    records.forEach(r => {
        totalAsistidos += Number(r.dias_asistidos || 0);
        totalFaltados += Number(r.dias_faltados || 0);
    });

    const avgAsist = totalWorkers > 0 ? (totalAsistidos / totalWorkers).toFixed(1) : '0';

    document.getElementById('statVal1').textContent = totalWorkers;
    document.getElementById('statVal2').textContent = avgAsist;
    document.getElementById('statVal3').textContent = totalFaltados;

    renderTableBody(records, rec => `
        <td>${escapeHtml(rec.dni)}</td>
        <td>${escapeHtml(rec.nombre)}</td>
        <td>${escapeHtml(rec.dias_asistidos)}</td>
        <td>${escapeHtml(rec.dias_faltados)}</td>
    `, 4);
}

// Common Table Body Renderer with 13 rows minimum formatting and dynamic column count
function renderTableBody(records, rowFormatter, colCount = 4) {
    const tbody = document.getElementById('excelTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    records.forEach(rec => {
        const tr = document.createElement('tr');
        tr.className = 'excel-data-row';
        tr.innerHTML = rowFormatter(rec);
        tbody.appendChild(tr);
    });

    const minRows = 13;
    const emptyRowsToAdd = Math.max(0, minRows - records.length);
    for (let i = 0; i < emptyRowsToAdd; i++) {
        const emptyTr = document.createElement('tr');
        emptyTr.className = 'excel-empty-row';
        let emptyCells = '';
        for (let c = 0; c < colCount; c++) {
            emptyCells += '<td>&nbsp;</td>';
        }
        emptyTr.innerHTML = emptyCells;
        tbody.appendChild(emptyTr);
    }
}

// Download Excel report according to active sub-section
function downloadCurrentExcelReport() {
    const token = getAuthToken() || '';
    const tokenQuery = token ? `&token=${encodeURIComponent(token)}` : '';
    
    // 1. Esto detecta la zona horaria de tu teléfono (ej. "America/Santiago")
    const userTz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    
    let downloadUrl = '';

    if (currentSubSection === 'daily') {
        const dateInput = document.getElementById('reportDate');
        const fecha = (dateInput && dateInput.value) ? dateInput.value : getTodayString();
        
        // 2. IMPORTANTE: Asegúrate de que lleve "&tz=" al final de la URL
        downloadUrl = `${API_URL}/api/reports/daily/download?fecha=${encodeURIComponent(fecha)}&tz=${userTz}${tokenQuery}`;
    } else if (currentSubSection === 'weekly') {
        const weekInput = document.getElementById('reportWeekDate');
        const fecha = (weekInput && weekInput.value) ? weekInput.value : getTodayString();
        downloadUrl = `${API_URL}/api/reports/weekly/download?fecha=${encodeURIComponent(fecha)}&tz=${userTz}${tokenQuery}`;
    } else if (currentSubSection === 'monthly') {
        const monthInput = document.getElementById('reportMonth');
        const mes = (monthInput && monthInput.value) ? monthInput.value : getCurrentMonthString();
        downloadUrl = `${API_URL}/api/reports/monthly/download?mes=${encodeURIComponent(mes)}&tz=${userTz}${tokenQuery}`;
    }

    if (!downloadUrl) return;

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
