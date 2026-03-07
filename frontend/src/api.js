// ─── API CLIENT ──────────────────────────────────────────────────────────────
// All calls to the real backend. Token is stored in localStorage.

const BASE = import.meta.env.VITE_API_URL || 'https://eloc-backend.onrender.com';

function getToken() {
  return localStorage.getItem('eloc_token');
}

async function request(method, path, body, isFormData = false) {
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isFormData) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: isFormData ? body : body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    localStorage.removeItem('eloc_token');
    window.location.reload();
    return;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Error ${res.status}`);
  return data;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const api = {
  auth: {
    login:    (email, password)  => request('POST', '/auth/login', { email, password }),
    register: (body)             => request('POST', '/auth/register', body),
    me:       ()                 => request('GET',  '/auth/me'),
    changePassword: (body)       => request('PUT',  '/auth/password', body),
  },

  // ── Users ─────────────────────────────────────────────────────────────────
  users: {
    list:   ()         => request('GET',    '/users'),
    get:    (id)       => request('GET',    `/users/${id}`),
    create: (body)     => request('POST',   '/users', body),
    update: (id, body) => request('PUT',    `/users/${id}`, body),
    delete: (id)       => request('DELETE', `/users/${id}`),
  },

  // ── Groups ────────────────────────────────────────────────────────────────
  groups: {
    list:   ()         => request('GET',    '/groups'),
    create: (body)     => request('POST',   '/groups', body),
    update: (id, body) => request('PUT',    `/groups/${id}`, body),
    delete: (id)       => request('DELETE', `/groups/${id}`),
  },

  // ── Sessions ──────────────────────────────────────────────────────────────
  sessions: {
    list:           ()               => request('GET',  '/sessions'),
    create:         (body)           => request('POST', '/sessions', body),
    update:         (id, body)       => request('PUT',  `/sessions/${id}`, body),
    delete:         (id)             => request('DELETE', `/sessions/${id}`),
    markAttendance: (id, attendance) => request('PUT',  `/sessions/${id}/attendance`, { attendance }),
  },

  // ── Payments ──────────────────────────────────────────────────────────────
  payments: {
    list:   ()         => request('GET',    '/payments'),
    create: (body)     => request('POST',   '/payments', body),
    update: (id, body) => request('PUT',    `/payments/${id}`, body),
    delete: (id)       => request('DELETE', `/payments/${id}`),
  },

  // ── Books ─────────────────────────────────────────────────────────────────
  books: {
    list:      ()           => request('GET',    '/books'),
    create:    (body)       => request('POST',   '/books', body),
    update:    (id, body)   => request('PUT',    `/books/${id}`, body),
    delete:    (id)         => request('DELETE', `/books/${id}`),
    uploadPDF: (id, file)   => {
      const fd = new FormData();
      fd.append('file', file);
      return request('POST', `/books/${id}/upload`, fd, true);
    },
  },

  // ── Lessons ───────────────────────────────────────────────────────────────
  lessons: {
    list:       ()                   => request('GET',    '/lessons'),
    create:     (body)               => request('POST',   '/lessons', body),
    update:     (id, body)           => request('PUT',    `/lessons/${id}`, body),
    delete:     (id)                 => request('DELETE', `/lessons/${id}`),
    uploadFile: (id, file)           => {
      const fd = new FormData();
      fd.append('file', file);
      return request('POST', `/lessons/${id}/files`, fd, true);
    },
    deleteFile: (lessonId, publicId) =>
      request('DELETE', `/lessons/${lessonId}/files/${encodeURIComponent(publicId)}`),
  },

  // ── Series ────────────────────────────────────────────────────────────────
  series: {
    list:   ()         => request('GET',    '/series'),
    create: (body)     => request('POST',   '/series', body),
    update: (id, body) => request('PUT',    `/series/${id}`, body),
    delete: (id)       => request('DELETE', `/series/${id}`),
  },
};

// ── Token helpers ─────────────────────────────────────────────────────────────
export const saveToken  = (token) => localStorage.setItem('eloc_token', token);
export const clearToken = ()      => localStorage.removeItem('eloc_token');
export const hasToken   = ()      => !!localStorage.getItem('eloc_token');
