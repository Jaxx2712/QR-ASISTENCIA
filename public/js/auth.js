const API_URL = 'https://qr-asistencia-backend-keum.onrender.com';

// Al cargar cualquier página, aplicar el tema guardado
document.addEventListener("DOMContentLoaded", () => {
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "dark") {
        document.body.classList.add("dark-mode");
    } else {
        document.body.classList.remove("dark-mode");
    }
});

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

// Automatically attach Bearer token and device Timezone to all /api/ fetch requests
(function () {
    const originalFetch = window.fetch;
    window.fetch = function (url, options = {}) {
        const token = getAuthToken();
        const urlStr = String(url);
        const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

        if (urlStr.includes('/api/')) {
            options = Object.assign({}, options);
            if (options.headers instanceof Headers) {
                if (token && !urlStr.includes('/api/auth/login') && !urlStr.includes('/api/auth/register')) {
                    if (!options.headers.has('Authorization')) options.headers.set('Authorization', `Bearer ${token}`);
                }
                if (!options.headers.has('X-Timezone')) options.headers.set('X-Timezone', deviceTz);
            } else if (Array.isArray(options.headers)) {
                options.headers = options.headers.slice();
                if (token && !urlStr.includes('/api/auth/login') && !urlStr.includes('/api/auth/register')) {
                    options.headers.push(['Authorization', `Bearer ${token}`]);
                }
                options.headers.push(['X-Timezone', deviceTz]);
            } else {
                options.headers = Object.assign({}, options.headers);
                if (token && !urlStr.includes('/api/auth/login') && !urlStr.includes('/api/auth/register')) {
                    if (!options.headers['Authorization'] && !options.headers['authorization']) {
                        options.headers['Authorization'] = `Bearer ${token}`;
                    }
                }
                if (!options.headers['X-Timezone'] && !options.headers['x-timezone']) {
                    options.headers['X-Timezone'] = deviceTz;
                }
            }
        }
        return originalFetch.call(this, url, options).then(res => {
            if (res.status === 401 && !window.location.pathname.endsWith('login.html')) {
                localStorage.removeItem('qr_token');
                localStorage.removeItem('qr_user');
                window.location.replace('login.html');
            }
            return res;
        });
    };
})();

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
    const avatarContent = (user.foto && user.foto.trim())
        ? `<img src="${user.foto}" class="user-avatar-img" alt="Foto">`
        : `<i class="fa-solid fa-user"></i>`;

    userProfileEl.innerHTML = `
        <div class="user-avatar-small">${avatarContent}</div>
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

    const avatarInner = (user.foto && user.foto.trim())
        ? `<img src="${user.foto}" class="profile-avatar-img" id="profileAvatarImg" alt="Foto">`
        : `<span id="profileAvatarInitials">${initials}</span>`;

    const removeBtnDisplay = (user.foto && user.foto.trim()) ? 'inline-block' : 'none';

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
                    <div class="profile-avatar-wrapper">
                        <div class="profile-avatar-large" id="profileAvatarLarge">
                            ${avatarInner}
                            <label for="profilePhotoInput" class="profile-avatar-edit-btn" title="Cambiar foto de perfil">
                                <i class="fa-solid fa-camera"></i>
                            </label>
                            <input type="file" id="profilePhotoInput" accept="image/*" style="display: none;" onchange="handleProfilePhotoUpload(this)">
                        </div>
                        <button type="button" id="btnRemoveProfilePhoto" class="btn-remove-photo" style="display: ${removeBtnDisplay};" onclick="removeProfilePhoto()">
                            <i class="fa-solid fa-trash"></i> Quitar foto
                        </button>
                    </div>
                    <div class="profile-user-info">
                        <h4 title="${escapeAuthHtml(user.nombre)}">${escapeAuthHtml(user.nombre)}</h4>
                        <p style="margin-bottom: 8px;"><i class="fa-regular fa-id-card"></i> DNI: <strong>${escapeAuthHtml(user.dni)}</strong></p>
                        <span class="role-badge ${roleBadgeClass}">
                            <i class="fa-solid ${user.cargo === 'Administrador' ? 'fa-shield-halved' : 'fa-camera'}"></i>
                            ${escapeAuthHtml(user.cargo)}
                        </span>
                    </div>
                </div>

                <div id="profilePhotoMsg" class="profile-photo-msg" style="display: none;"></div>

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

// Upload & compress profile photo
async function handleProfilePhotoUpload(input) {
    if (!input || !input.files || input.files.length === 0) return;
    const file = input.files[0];
    if (!file.type.startsWith('image/')) {
        showProfilePhotoMsg('Por favor selecciona un archivo de imagen válido.', 'error');
        return;
    }

    showProfilePhotoMsg('Procesando imagen...', 'info');

    try {
        const compressedBase64 = await resizeImage(file, 400, 400, 0.85);
        const token = getAuthToken();
        const res = await fetch(`${API_URL}/api/auth/profile/photo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ foto: compressedBase64 })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.message || 'Error al guardar foto');
        }

        // Update local storage
        const user = getAuthUser() || {};
        user.foto = data.foto;
        localStorage.setItem('qr_user', JSON.stringify(user));

        // Update UI
        updateProfileAvatarUI(data.foto);
        showProfilePhotoMsg('¡Foto de perfil actualizada!', 'success');
    } catch (err) {
        console.error('Error al subir foto de perfil:', err);
        showProfilePhotoMsg(err.message || 'Error al actualizar la foto.', 'error');
    } finally {
        input.value = '';
    }
}

// Remove profile photo
async function removeProfilePhoto() {
    if (!confirm('¿Deseas quitar tu foto de perfil?')) return;
    showProfilePhotoMsg('Quitando foto...', 'info');

    try {
        const token = getAuthToken();
        const res = await fetch(`${API_URL}/api/auth/profile/photo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ foto: '' })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.message || 'Error al quitar foto');
        }

        const user = getAuthUser() || {};
        user.foto = '';
        localStorage.setItem('qr_user', JSON.stringify(user));

        updateProfileAvatarUI('');
        showProfilePhotoMsg('Foto de perfil eliminada.', 'success');
    } catch (err) {
        console.error('Error al quitar foto:', err);
        showProfilePhotoMsg(err.message || 'Error al quitar foto.', 'error');
    }
}

function updateProfileAvatarUI(fotoUrl) {
    const user = getAuthUser() || {};
    const initials = user.nombre ? user.nombre.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : 'US';
    
    // Top bar
    const topBarAvatar = document.querySelector('.user-avatar-small');
    if (topBarAvatar) {
        topBarAvatar.innerHTML = (fotoUrl && fotoUrl.trim())
            ? `<img src="${fotoUrl}" class="user-avatar-img" alt="Foto">`
            : `<i class="fa-solid fa-user"></i>`;
    }

    // Modal
    const modalAvatar = document.getElementById('profileAvatarLarge');
    const btnRemove = document.getElementById('btnRemoveProfilePhoto');
    if (modalAvatar) {
        const inner = (fotoUrl && fotoUrl.trim())
            ? `<img src="${fotoUrl}" class="profile-avatar-img" id="profileAvatarImg" alt="Foto">`
            : `<span id="profileAvatarInitials">${initials}</span>`;
        
        modalAvatar.innerHTML = `
            ${inner}
            <label for="profilePhotoInput" class="profile-avatar-edit-btn" title="Cambiar foto de perfil">
                <i class="fa-solid fa-camera"></i>
            </label>
            <input type="file" id="profilePhotoInput" accept="image/*" style="display: none;" onchange="handleProfilePhotoUpload(this)">
        `;
    }

    if (btnRemove) {
        btnRemove.style.display = (fotoUrl && fotoUrl.trim()) ? 'inline-block' : 'none';
    }
}

function showProfilePhotoMsg(msg, type = 'info') {
    const box = document.getElementById('profilePhotoMsg');
    if (!box) return;
    box.textContent = msg;
    box.className = `profile-photo-msg ${type}`;
    box.style.display = 'block';
    setTimeout(() => {
        if (box) box.style.display = 'none';
    }, 4000);
}

// Client-side image resizer to keep payloads lightweight & high performance
function resizeImage(file, maxWidth, maxHeight, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        maxHeight = maxHeight;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(dataUrl);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
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

