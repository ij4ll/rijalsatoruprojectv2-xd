/* common.js — RijalSatoru-Api
   Modal notifikasi bersama (pengganti alert bawaan browser). */

const API_BASE_DOMAIN = "https://rijalsatoru-xd.my.id";

function ensureNotifyModal() {
  if (document.getElementById('notifyModal')) return;
  const modal = document.createElement('div');
  modal.id = 'notifyModal';
  modal.className = 'fixed inset-0 bg-slate-950/80 backdrop-blur-md hidden z-[60] items-center justify-center p-4';
  modal.innerHTML = `
    <div id="notifyBox" class="bg-slate-900 border border-cyan-500/40 p-6 rounded-3xl max-w-sm w-full text-center shadow-2xl animate-fade-up">
      <div id="notifyIconWrap" class="w-14 h-14 bg-cyan-500/20 text-cyan-400 rounded-2xl flex items-center justify-center mx-auto mb-4 text-2xl">
        <i id="notifyIcon" class="fa-solid fa-circle-info"></i>
      </div>
      <h3 id="notifyTitle" class="text-lg font-black text-white mb-2"></h3>
      <p id="notifyMessage" class="text-xs text-slate-400 mb-6"></p>
      <div id="notifyButtons" class="flex gap-2">
        <button onclick="closeNotify()" class="flex-1 py-2.5 bg-cyan-400 text-slate-950 font-black text-xs rounded-xl hover:bg-cyan-300 transition">Tutup</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeNotify(); });
}

function showNotify(type, title, message, onClose, actionButton) {
  ensureNotifyModal();
  const box = document.getElementById('notifyBox');
  const iconWrap = document.getElementById('notifyIconWrap');
  const icon = document.getElementById('notifyIcon');
  const buttonsWrap = document.getElementById('notifyButtons');

  const styles = {
    success: { border: 'border-emerald-500/40', bg: 'bg-emerald-500/20 text-emerald-400', cls: 'fa-circle-check' },
    error:   { border: 'border-red-500/40',     bg: 'bg-red-500/20 text-red-400',     cls: 'fa-circle-exclamation' },
    warning: { border: 'border-amber-500/40',   bg: 'bg-amber-500/20 text-amber-400', cls: 'fa-triangle-exclamation' },
    info:    { border: 'border-cyan-500/40',    bg: 'bg-cyan-500/20 text-cyan-400',   cls: 'fa-circle-info' }
  };
  const s = styles[type] || styles.info;

  box.className = `bg-slate-900 border ${s.border} p-6 rounded-3xl max-w-sm w-full text-center shadow-2xl animate-fade-up`;
  iconWrap.className = `w-14 h-14 ${s.bg} rounded-2xl flex items-center justify-center mx-auto mb-4 text-2xl`;
  icon.className = `fa-solid ${s.cls}`;
  document.getElementById('notifyTitle').innerText = title;
  document.getElementById('notifyMessage').innerText = message;

  // Susun tombol: kalau ada actionButton, tampilkan tombol aksi utama + tombol "Tutup" sekunder.
  // Kalau tidak, cukup satu tombol "Tutup" penuh seperti biasa.
  if (actionButton && actionButton.label) {
    buttonsWrap.innerHTML = `
      <button onclick="closeNotify()" class="flex-1 py-2.5 bg-slate-800 text-slate-200 font-bold text-xs rounded-xl hover:bg-slate-700 transition">Nanti Saja</button>
      <button id="notifyActionBtn" class="flex-1 py-2.5 bg-purple-600 text-white font-black text-xs rounded-xl hover:bg-purple-500 transition">${actionButton.label}</button>
    `;
    document.getElementById('notifyActionBtn').onclick = function () {
      window._notifyOnClose = null;
      const m = document.getElementById('notifyModal');
      if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
      actionButton.onClick();
    };
  } else {
    buttonsWrap.innerHTML = `
      <button onclick="closeNotify()" class="flex-1 py-2.5 bg-cyan-400 text-slate-950 font-black text-xs rounded-xl hover:bg-cyan-300 transition">Tutup</button>
    `;
  }

  document.getElementById('notifyModal').classList.remove('hidden');
  document.getElementById('notifyModal').classList.add('flex');

  window._notifyOnClose = onClose || null;
}

function closeNotify() {
  const m = document.getElementById('notifyModal');
  if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
  if (typeof window._notifyOnClose === 'function') {
    const cb = window._notifyOnClose;
    window._notifyOnClose = null;
    cb();
  }
}

/* Ambil pesan error dari response backend dengan aman */
async function readErrorMessage(response, fallback) {
  try {
    const data = await response.json();
    return data && data.message ? data.message : fallback;
  } catch (e) {
    return fallback;
  }
}
