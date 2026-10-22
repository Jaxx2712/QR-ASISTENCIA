const API_URL = 'https://qr-asistencia-backend-keum.onrender.com';

// Client Authentication, Role Permissions and Theme Management

(function () {
    // 1. Immediately apply theme before rendering to avoid flicker
    const savedTheme = localStorage.getItem('qr_theme') || 'light';
    if (savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        if (document.body) document.body.classList.add('dark-mode');
        else document.addEventListener('DOMContentLoaded', () => document.body.classList.add('dark-mode'));
    }
})();

function getAuthToken() {
    return localStorage.getItem('qr_token');
}

function getAuthUser() {
    try {
        const u = localStorage.getItem('qr_user');
        return u ? JSON.parse(u) : null;
    } catch (e) {
        return null;
    }
}

// Check session and permissions on every protected page
function enforceAuth() {
    const isLoginPage = window.location.pathname.endsWith('login.html');
    const token = getAuthToken();
    const user = getAuthUser();

    if (isLoginPage) {
        // If already logged in on login page, redirect according to role
        if (token && user) {
            if (user.cargo === 'Supervisor') {
                window.location.replace('scanner.html');
            } else {
                window.location.replace('index.html');
            }
        }
        return;
    }

    // On protected pages: require authentication
    if (!token || !user) {
        localStorage.removeItem('qr_token');
        localStorage.removeItem('qr_user');
        window.location.replace('login.html');
        return;
    }

    // Role-based page access control
    const currentPath = window.location.pathname.toLowerCase();
    const isScanner = currentPath.endsWith('scanner.html');

    if (user.cargo === 'Supervisor') {
        // Supervisor is ONLY allowed on scanner.html
        if (!isScanner) {
            window.location.replace('scanner.html');
            return;
        }
    }

    // Apply UI role restrictions and setup profile in header
    document.addEventListener('DOMContentLoaded', () => {
        applyRoleRestrictions(user);
        setupUserProfileButton(user);
        injectProfileModal();
    });
}

// Hide restricted navigation items for Supervisor
function applyRoleRestrictions(user) {
    if (user.cargo === 'Supervisor') {
        // Hide all sidebar links except Escáner
        const navDashboard = document.querySelector('.nav-dashboard');
        const navGenerar = document.querySelector('.nav-generar');
        const navReportes = document.querySelector('.nav-reportes');

        if (navDashboard) navDashboard.style.display = 'none';
        if (navGenerar) navGenerar.style.display = 'none';
        if (navReportes) navReportes.style.display = 'none';
    }
}

// Setup Top Bar user profile button
function setupUserProfileButton(user) {
    const userProfileEl = document.querySelector('.user-profile');
    if (!userProfileEl) return;

    // Remove any previous alert onclick
    userProfileEl.removeAttribute('onclick');
    userProfileEl.onclick = openProfileModal;

    const firstName = user.nombre ? user.nombre.split(' ')[0] : 'Usuario';
    const roleClass = user.cargo === 'Administrador' ? 'admin' : 'supervisor';

    userProfileEl.innerHTML = `
        <div class="user-avatar-small"><i class="fa-solid fa-user"></i></div>
        <span>${escapeAuthHtml(firstName)} (${escapeAuthHtml(user.cargo)})</span>
        <i class="fa-solid fa-chevron-down" style="font-size: 11px; margin-left: 2px; color: var(--text-light);"></i>
    `;
    userProfileEl.setAttribute('title', 'Configuración de cuenta y tema');
}

// Inject Profile and Settings Modal
function injectProfileModal() {
    if (document.getElementById('profileModalOverlay')) return;

    const user = getAuthUser() || { nombre: 'Usuario', dni: '--------', cargo: '---' };
    const initials = user.nombre ? user.nombre.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : 'US';
    const roleBadgeClass = user.cargo === 'Administrador' ? 'admin' : 'supervisor';
    const currentTheme = localStorage.getItem('qr_theme') || 'light';

    const modalHtml = `
    <div id="profileModalOverlay" class="profile-modal-overlay" onclick="handleProfileOverlayClick(event)">
        <div class="profile-modal-card" onclick="event.stopPropagation()">
            <div class="profile-modal-header">
                <h3><i class="fa-solid fa-gear" style="color: var(--accent);"></i> Configuración de Cuenta</h3>
                <button type="button" class="profile-modal-close" onclick="closeProfileModal()" aria-label="Cerrar">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>
            <div class="profile-modal-body">
                <div class="profile-user-badge-card">
                    <div class="profile-avatar-large">${initials}</div>
                    <div class="profile-user-info">
                        <h4 title="${escapeAuthHtml(user.nombre)}">${escapeAuthHtml(user.nombre)}</h4>
                        <p style="margin-bottom: 8px;"><i class="fa-regular fa-id-card"></i> DNI: <strong>${escapeAuthHtml(user.dni)}</strong></p>
                        <span class="role-badge ${roleBadgeClass}">
                            <i class="fa-solid ${user.cargo === 'Administrador' ? 'fa-shield-halved' : 'fa-camera'}"></i>
                            ${escapeAuthHtml(user.cargo)}
                        </span>
                    </div>
                </div>

                <div>
                    <div class="profile-section-title"><i class="fa-solid fa-palette"></i> Tema de la Aplicación</div>
                    <div class="theme-switch-container">
                        <button type="button" id="btnThemeLight" class="theme-switch-btn ${currentTheme !== 'dark' ? 'active' : ''}" onclick="setAppTheme('light')">
                            <i class="fa-solid fa-sun" style="color: #f59e0b;"></i> Modo Claro
                        </button>
                        <button type="button" id="btnThemeDark" class="theme-switch-btn ${currentTheme === 'dark' ? 'active' : ''}" onclick="setAppTheme('dark')">
                            <i class="fa-solid fa-moon" style="color: #6366f1;"></i> Modo Oscuro
                        </button>
                    </div>
                </div>
            </div>
            <div class="profile-modal-footer">
                <button type="button" class="btn-logout" onclick="logoutSession()">
                    <i class="fa-solid fa-arrow-right-from-bracket"></i> Cerrar Sesión
                </button>
            </div>
        </div>
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function openProfileModal() {
    const overlay = document.getElementById('profileModalOverlay');
    if (overlay) {
        overlay.classList.add('active');
    }
}

function closeProfileModal() {
    const overlay = document.getElementById('profileModalOverlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
}

function handleProfileOverlayClick(event) {
    if (event.target.id === 'profileModalOverlay') {
        closeProfileModal();
    }
}

// Switch between Light and Dark mode
function setAppTheme(theme) {
    localStorage.setItem('qr_theme', theme);

    if (theme === 'dark') {
        document.body.classList.add('dark-mode');
        document.documentElement.setAttribute('data-theme', 'dark');
        const btnLight = document.getElementById('btnThemeLight');
        const btnDark = document.getElementById('btnThemeDark');
        if (btnLight) btnLight.classList.remove('active');
        if (btnDark) btnDark.classList.add('active');
    } else {
        document.body.classList.remove('dark-mode');
        document.documentElement.removeAttribute('data-theme');
        const btnLight = document.getElementById('btnThemeLight');
        const btnDark = document.getElementById('btnThemeDark');
        if (btnLight) btnLight.classList.add('active');
        if (btnDark) btnDark.classList.remove('active');
    }
}

// Logout session
async function logoutSession() {
    try {
        const token = getAuthToken();
        if (token) {
            await fetch(`${API_URL}/api/auth/logout`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        }
    } catch (e) {
        console.error('Logout error:', e);
    } finally {
        localStorage.removeItem('qr_token');
        localStorage.removeItem('qr_user');
        window.location.replace('login.html');
    }
}

function escapeAuthHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Run auth enforcement
enforceAuth();

