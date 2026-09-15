const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const { Redis } = require('@upstash/redis');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DOMAIN = 'https://rijalsatoru-xd.my.id';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

/* ================= Penyimpanan akun (Upstash Redis) ================= */
let redis = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
  });
}

function requireRedis(res) {
  if (!redis) {
    res.status(500).json({
      status: false,
      code: 500,
      message: 'Database belum dikonfigurasi. Set UPSTASH_REDIS_REST_URL dan UPSTASH_REDIS_REST_TOKEN di Environment Variables (lihat PANDUAN-DEPLOY.md).'
    });
    return false;
  }
  return true;
}

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(String(password) + salt).digest('hex');
}

function generateApiKey() {
  return 'rijalsatoru_' + crypto.randomBytes(10).toString('hex');
}

const DEFAULT_SUPPORTED_DOMAINS = [
  'gmail.com', 'yahoo.com', 'yahoo.co.id', 'outlook.com',
  'hotmail.com', 'icloud.com', 'proton.me', 'protonmail.com'
];
const SUPPORTED_EMAIL_DOMAINS = (process.env.SUPPORTED_EMAIL_DOMAINS
  ? process.env.SUPPORTED_EMAIL_DOMAINS.split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
  : DEFAULT_SUPPORTED_DOMAINS);

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}
function isSupportedEmailDomain(email) {
  const domain = String(email || '').split('@')[1];
  return !!domain && SUPPORTED_EMAIL_DOMAINS.includes(domain.toLowerCase());
}

/* ================= AUTH ENDPOINTS (tidak diubah) ================= */

app.post('/api/auth/register', async (req, res) => {
  if (!requireRedis(res)) return;
  const { username, email, password } = req.body || {};

  if (!username || !email || !password) {
    return res.status(400).json({ status: false, code: 400, message: 'Username, email, dan password wajib diisi.' });
  }
  const usernameTrim = String(username).trim();
  const emailTrim = String(email).trim();

  if (usernameTrim.length < 3) {
    return res.status(400).json({ status: false, code: 400, message: 'Username minimal 3 karakter.' });
  }
  if (!isValidEmail(emailTrim)) {
    return res.status(400).json({ status: false, code: 400, message: 'Format email tidak valid.' });
  }
  if (!isSupportedEmailDomain(emailTrim)) {
    return res.status(400).json({
      status: false, code: 400,
      message: `Domain email belum didukung. Gunakan salah satu: ${SUPPORTED_EMAIL_DOMAINS.join(', ')}`
    });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ status: false, code: 400, message: 'Password minimal 6 karakter.' });
  }

  try {
    const usernameLower = usernameTrim.toLowerCase();
    const emailLower = emailTrim.toLowerCase();

    const [existingByUsername, existingByEmail] = await Promise.all([
      redis.get(`user:username:${usernameLower}`),
      redis.get(`user:email:${emailLower}`)
    ]);

    if (existingByUsername) {
      return res.status(409).json({ status: false, code: 409, message: 'Username sudah terdaftar. Gunakan username lain atau login.' });
    }
    if (existingByEmail) {
      return res.status(409).json({ status: false, code: 409, message: 'Email sudah terdaftar. Gunakan email lain atau login.' });
    }

    const salt = crypto.randomBytes(8).toString('hex');
    const passwordHash = hashPassword(password, salt);
    const apikey = generateApiKey();

    const userRecord = {
      username: usernameTrim, email: emailTrim, passwordHash, salt, apikey,
      createdAt: new Date().toISOString()
    };

    await Promise.all([
      redis.set(`user:data:${usernameLower}`, JSON.stringify(userRecord)),
      redis.set(`user:username:${usernameLower}`, usernameLower),
      redis.set(`user:email:${emailLower}`, usernameLower),
      redis.set(`user:apikey:${apikey}`, usernameLower)
    ]);

    return res.json({ status: true, code: 200, message: 'Registrasi berhasil.', username: usernameTrim, email: emailTrim, apikey });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: false, code: 500, message: 'Terjadi kesalahan server saat registrasi.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  if (!requireRedis(res)) return;
  const { identifier, password } = req.body || {};

  if (!identifier || !password) {
    return res.status(400).json({ status: false, code: 400, message: 'Username/email dan password wajib diisi.' });
  }

  try {
    const idLower = String(identifier).trim().toLowerCase();
    let usernameKey = await redis.get(`user:username:${idLower}`);
    if (!usernameKey) usernameKey = await redis.get(`user:email:${idLower}`);

    if (!usernameKey) {
      return res.status(404).json({ status: false, code: 404, message: 'Akun tidak ditemukan. Silakan register terlebih dahulu.' });
    }

    const userRaw = await redis.get(`user:data:${usernameKey}`);
    const user = typeof userRaw === 'string' ? JSON.parse(userRaw) : userRaw;

    if (!user) {
      return res.status(404).json({ status: false, code: 404, message: 'Akun tidak ditemukan. Silakan register terlebih dahulu.' });
    }

    const hashed = hashPassword(password, user.salt);
    if (hashed !== user.passwordHash) {
      return res.status(401).json({ status: false, code: 401, message: 'Password salah. Silakan coba lagi.' });
    }

    return res.json({ status: true, code: 200, message: 'Login berhasil.', username: user.username, email: user.email, apikey: user.apikey });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: false, code: 500, message: 'Terjadi kesalahan server saat login.' });
  }
});

/* ================= HANDLER ENDPOINT ASLI =================
   Setiap fungsi di bawah benar-benar mengambil/menghitung data,
   bukan data contoh statis. Kategori yang belum ada di sini akan
   membalas 501 "belum tersedia" — bukan data palsu. */

async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`Upstream error ${r.status}`);
  return r.json();
}
async function fetchText(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`Upstream error ${r.status}`);
  return r.text();
}

const QUOTES = [
  { text: "Hidup adalah 10% apa yang terjadi padamu dan 90% bagaimana kamu meresponnya.", author: "Charles R. Swindoll" },
  { text: "Kesuksesan adalah kemampuan untuk berpindah dari satu kegagalan ke kegagalan lain tanpa kehilangan semangat.", author: "Winston Churchill" },
  { text: "Jangan tunggu waktu yang tepat, karena waktu yang tepat adalah sekarang.", author: "Napoleon Hill" },
  { text: "Belajarlah dari kemarin, hiduplah untuk hari ini, berharaplah untuk esok hari.", author: "Albert Einstein" },
  { text: "Kegagalan hanyalah kesempatan untuk memulai lagi dengan lebih cerdas.", author: "Henry Ford" }
];

const handlers = {
  // ---- tools ----
  'tools/base64': async (req) => {
    const { text, mode = 'encode' } = req.query;
    if (!text) throw { code: 400, message: 'Parameter "text" wajib diisi.' };
    const output = mode === 'decode'
      ? Buffer.from(text, 'base64').toString('utf8')
      : Buffer.from(text, 'utf8').toString('base64');
    return { mode, input: text, output };
  },
  'tools/qrcode': async (req) => {
    const { text } = req.query;
    if (!text) throw { code: 400, message: 'Parameter "text" wajib diisi.' };
    return { qr_image: `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(text)}` };
  },
  'tools/shorturl': async (req) => {
    const { url } = req.query;
    if (!url) throw { code: 400, message: 'Parameter "url" wajib diisi.' };
    const short = await fetchText(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`);
    return { original_url: url, short_url: short.trim() };
  },

  // ---- webzone ----
  'webzone/check-ip': async (req) => {
    const { ip } = req.query;
    if (!ip) throw { code: 400, message: 'Parameter "ip" wajib diisi.' };
    return await fetchJson(`http://ip-api.com/json/${encodeURIComponent(ip)}`);
  },
  'webzone/dns-lookup': async (req) => {
    const { domain } = req.query;
    if (!domain) throw { code: 400, message: 'Parameter "domain" wajib diisi.' };
    const [a, mx, ns] = await Promise.allSettled([
      dns.resolve4(domain), dns.resolveMx(domain), dns.resolveNs(domain)
    ]);
    return {
      domain,
      a: a.status === 'fulfilled' ? a.value : [],
      mx: mx.status === 'fulfilled' ? mx.value : [],
      ns: ns.status === 'fulfilled' ? ns.value : []
    };
  },
  'webzone/whois': async (req) => {
    const { domain } = req.query;
    if (!domain) throw { code: 400, message: 'Parameter "domain" wajib diisi.' };
    return await fetchJson(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
  },

  // ---- islamic ----
  'islamic/jadwal-sholat': async (req) => {
    const { kota = 'Jakarta', negara = 'Indonesia' } = req.query;
    const data = await fetchJson(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(kota)}&country=${encodeURIComponent(negara)}&method=11`);
    return { kota, negara, jadwal: data.data.timings, tanggal: data.data.date.readable };
  },
  'islamic/quran-surah': async (req) => {
    const { nomor } = req.query;
    if (!nomor) throw { code: 400, message: 'Parameter "nomor" (1-114) wajib diisi.' };
    return await fetchJson(`https://equran.id/api/v2/surat/${encodeURIComponent(nomor)}`);
  },

  // ---- news ----
  'news/detik': async () => {
    const xml = await fetchText('https://rss.detik.com/index.php/detikcom');
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 10).map(m => {
      const block = m[1];
      const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [,''])[1];
      const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [,''])[1];
      return { title: title.replace('<![CDATA[', '').replace(']]>', '').trim(), url: link.trim() };
    });
    return items;
  },

  // ---- random ----
  'random/quote': async () => QUOTES[Math.floor(Math.random() * QUOTES.length)],

  // ---- anime & wallpaper (gambar asli, acak) ----
  'anime/*': async () => {
    const data = await fetchJson('https://api.waifu.pics/sfw/waifu');
    return { image: data.url };
  },
  'wallpaper/*': async () => ({ image: `https://picsum.photos/1080/1920?random=${Date.now()}` })
};

app.get('/api/:category/:endpoint', async (req, res) => {
  const { category, endpoint } = req.params;
  const { apikey } = req.query;

  if (!apikey) {
    return res.status(401).json({
      status: false, code: 401, creator: 'Rijalsatoru',
      message: `Error: API Key tidak ditemukan! Sertakan ?apikey=API_KEY_ANDA. Belum punya API Key? Registrasi di ${PUBLIC_DOMAIN}/register.html`
    });
  }
  if (!requireRedis(res)) return;

  try {
    const usernameKey = await redis.get(`user:apikey:${apikey}`);
    if (!usernameKey) {
      return res.status(403).json({
        status: false, code: 403, creator: 'Rijalsatoru',
        message: `Error: API Key tidak valid atau belum terdaftar. Registrasi di ${PUBLIC_DOMAIN}/register.html`
      });
    }

    const catKey = category.toLowerCase();
    const exactKey = `${catKey}/${endpoint.toLowerCase()}`;
    const wildcardKey = `${catKey}/*`;
    const handler = handlers[exactKey] || handlers[wildcardKey];

    if (!handler) {
      return res.status(501).json({
        status: false, code: 501, creator: 'Rijalsatoru',
        category: catKey, endpoint,
        message: `Endpoint /${catKey}/${endpoint} belum diimplementasikan dengan data asli. Sedang dikerjakan bertahap.`
      });
    }

    const result = await handler(req);
    return res.json({
      status: true, code: 200, creator: 'Rijalsatoru', domain: 'rijalsatoru-xd.my.id',
      category: catKey, endpoint, result, executed_at: new Date().toISOString()
    });
  } catch (err) {
    const code = err && err.code ? err.code : 500;
    console.error(err);
    return res.status(code).json({ status: false, code, message: (err && err.message) || 'Terjadi kesalahan server.' });
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'register.html')));

if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(PORT, () => {
    console.log(`Server RijalSatoru-Api aktif di http://localhost:${PORT} (production: ${PUBLIC_DOMAIN})`);
  });
}
