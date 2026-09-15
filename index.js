const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { Redis } = require('@upstash/redis');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DOMAIN = 'https://rijalsatoru-xd.my.id';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

/* ================= Penyimpanan akun (Upstash Redis) =================
   PENTING: Vercel adalah platform serverless — filesystem-nya di-reset
   setiap kali function dijalankan ulang, jadi data TIDAK BOLEH disimpan
   ke file lokal (users.json). Di sini data akun disimpan permanen di
   Upstash Redis (gratis, berbasis REST API, cocok untuk serverless).

   Wajib diisi di Environment Variables (lihat PANDUAN-DEPLOY.md):
   - UPSTASH_REDIS_REST_URL
   - UPSTASH_REDIS_REST_TOKEN
*/

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

/* ================= Validasi email =================
   Karena tidak tersedia layanan gratis yang aman untuk mengirim kode
   verifikasi (OTP) via WhatsApp maupun email untuk skala ini, verifikasi
   diganti dengan validasi format + validasi domain email yang didukung.
   Silakan tambah/kurangi domain di bawah sesuai kebutuhan, atau isi lewat
   Environment Variable SUPPORTED_EMAIL_DOMAINS (dipisah koma). */
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

/* ================= AUTH ENDPOINTS ================= */

// REGISTRASI -> membuat akun + API Key asli di server
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
      status: false,
      code: 400,
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
      username: usernameTrim,
      email: emailTrim,
      passwordHash,
      salt,
      apikey,
      createdAt: new Date().toISOString()
    };

    // Simpan record utama + 3 index pencarian (username, email, apikey)
    await Promise.all([
      redis.set(`user:data:${usernameLower}`, JSON.stringify(userRecord)),
      redis.set(`user:username:${usernameLower}`, usernameLower),
      redis.set(`user:email:${emailLower}`, usernameLower),
      redis.set(`user:apikey:${apikey}`, usernameLower)
    ]);

    return res.json({
      status: true,
      code: 200,
      message: 'Registrasi berhasil.',
      username: usernameTrim,
      email: emailTrim,
      apikey
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: false, code: 500, message: 'Terjadi kesalahan server saat registrasi.' });
  }
});

// LOGIN -> validasi username/email + password terhadap data di server
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

    return res.json({
      status: true,
      code: 200,
      message: 'Login berhasil.',
      username: user.username,
      email: user.email,
      apikey: user.apikey
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: false, code: 500, message: 'Terjadi kesalahan server saat login.' });
  }
});

/* ================= Data respons sampel untuk 24 kategori ================= */
const categoryResponses = {
  anime: { title: "Anime Endpoint Result", data: "https://files.catbox.moe/bwzgb5.jpg" },
  asupan: { title: "Asupan Video Result", data: "https://files.catbox.moe/motj0v.mp4" },
  cecan: { title: "Cecan Image Result", data: "https://files.catbox.moe/bwzgb5.jpg" },
  emoji: { title: "Emoji Mix Result", data: { emoji1: "🔥", emoji2: "💀", result: "🔥💀" } },
  game: { title: "Game Stats Result", data: { game: "Mobile Legends", status: "Active" } },
  islamic: { title: "Islamic API Result", data: { surah: "Al-Fatihah", ayat: 1 } },
  news: { title: "News API Result", data: [{ title: "Berita Terbaru 2026", url: "#" }] },
  nsfw: { title: "NSFW Filtered Result", data: "https://files.catbox.moe/bwzgb5.jpg" },
  primbon: { title: "Primbon Jawa Result", data: { weton: "Wage", arti: "Baik" } },
  random: { title: "Random Payload Result", data: "Generated random output successfully." },
  search: { title: "Search Engine Result", data: [{ rank: 1, result: "Data A" }] },
  sound: { title: "Sound Effects Result", data: "https://files.catbox.moe/motj0v.mp4" },
  stalk: { title: "Stalker Result", data: { account: "Found", followers: "12K" } },
  story: { title: "Story Downloader Result", data: "https://files.catbox.moe/motj0v.mp4" },
  tools: { title: "Tools Utilities Result", data: { processed: true, output: "Success" } },
  vokal: { title: "Vocal Changer Result", data: "Audio processed successfully." },
  wallpaper: { title: "Wallpaper HD Result", data: "https://files.catbox.moe/bwzgb5.jpg" },
  webzone: { title: "Webzone Result", data: { status: "Online" } },
  maker: { title: "Image Maker Result", data: "https://files.catbox.moe/bwzgb5.jpg" },
  textpro: { title: "TextPro Effect Result", data: "https://files.catbox.moe/bwzgb5.jpg" },
  photooxy: { title: "PhotoOxy Result", data: "https://files.catbox.moe/bwzgb5.jpg" },
  ephoto: { title: "Ephoto Result", data: "https://files.catbox.moe/bwzgb5.jpg" },
  sticker: { title: "Sticker Maker Result", data: "https://files.catbox.moe/bwzgb5.jpg" },
  download: { title: "Downloader Result", data: "https://files.catbox.moe/motj0v.mp4" }
};

/* ================= Endpoint dinamis (706+ endpoint) — divalidasi via apikey ================= */
app.get('/api/:category/:endpoint', async (req, res) => {
  if (!requireRedis(res)) return;

  const { category, endpoint } = req.params;
  const { apikey } = req.query;

  if (!apikey) {
    return res.status(401).json({
      status: false,
      code: 401,
      creator: 'Rijalsatoru',
      message: `Error: API Key tidak ditemukan! Sertakan ?apikey=API_KEY_ANDA. Belum punya API Key? Registrasi di ${PUBLIC_DOMAIN}/register.html`
    });
  }

  try {
    const usernameKey = await redis.get(`user:apikey:${apikey}`);

    if (!usernameKey) {
      return res.status(403).json({
        status: false,
        code: 403,
        creator: 'Rijalsatoru',
        message: `Error: API Key tidak valid atau belum terdaftar. Registrasi di ${PUBLIC_DOMAIN}/register.html`
      });
    }

    const catKey = category.toLowerCase();
    const responseTemplate = categoryResponses[catKey] || categoryResponses.random;

    return res.json({
      status: true,
      code: 200,
      creator: 'Rijalsatoru',
      domain: 'rijalsatoru-xd.my.id',
      category: catKey,
      endpoint: endpoint,
      result: {
        name: responseTemplate.title,
        target_endpoint: `/${catKey}/${endpoint}`,
        output: responseTemplate.data,
        executed_at: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: false, code: 500, message: 'Terjadi kesalahan server.' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'register.html'));
});

// Di Vercel, aplikasi Express diekspor sebagai handler serverless
// (Vercel yang memanggilnya, jadi TIDAK perlu app.listen()).
// Saat dijalankan lokal (node index.js), tetap jalankan server biasa.
if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(PORT, () => {
    console.log(`Server RijalSatoru-Api aktif di http://localhost:${PORT} (production: ${PUBLIC_DOMAIN})`);
  });
}
