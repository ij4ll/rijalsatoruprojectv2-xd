# Panduan Deploy RijalSatoru-Api ke Vercel + Domain IDwebhost

## 0. Soal kode verifikasi (OTP) WhatsApp/Email

Sudah dicek: tidak ada layanan **gratis dan aman** untuk mengirim OTP lewat WhatsApp untuk skala publik seperti ini.
- WhatsApp Business API resmi (via Meta/partner seperti Qontak) **berbayar** dan butuh verifikasi bisnis.
- Gateway "gratis" yang beredar (Fonnte trial, Flowkirim, dsb.) memakai nomor WA pribadi yang di-scan QR code (otomatisasi tidak resmi) — berisiko nomor **diblokir Meta**, dan butuh koneksi terus-menyambung (bot harus selalu online), yang **tidak bisa jalan di Vercel** karena Vercel itu serverless (function mati setelah selesai memproses, tidak bisa menjaga sesi WA tetap login).

Karena itu, sesuai arahanmu, verifikasi kode **tidak ditambahkan**. Sebagai gantinya, saat registrasi sistem hanya menerima email dari domain yang didukung (default: gmail.com, yahoo.com, yahoo.co.id, outlook.com, hotmail.com, icloud.com, proton.me, protonmail.com). Bisa diubah lewat Environment Variable `SUPPORTED_EMAIL_DOMAINS` (pisahkan dengan koma) tanpa perlu ubah kode.

## 1. Kenapa perlu database (Upstash Redis)?

Kode versi lama menyimpan data user ke file `data/users.json`. Ini **tidak akan bekerja di Vercel** karena Vercel serverless: setiap request bisa dijalankan di instance baru dan filesystem-nya di-reset, jadi data akun akan hilang.

Solusinya: data akun sekarang disimpan di **Upstash Redis** — gratis (tanpa kartu kredit), berbasis REST API (cocok untuk serverless), dan permanen.

### Cara buat Upstash Redis gratis
1. Buka https://upstash.com → daftar/login (bisa pakai akun GitHub/Google).
2. Klik **Create Database** → pilih tipe **Redis**.
3. Isi nama database (bebas), pilih region terdekat (misal Singapore).
4. Setelah dibuat, buka tab **REST API** pada database tersebut.
5. Catat dua nilai ini:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

Kedua nilai ini yang akan dimasukkan ke Environment Variables di Vercel (langkah 3).

## 2. Upload project ke GitHub

1. Buat repository baru di GitHub (public atau private, bebas).
2. Upload semua file project ini (index.js, index.html, login.html, register.html, common.js, package.json, vercel.json) ke repo tersebut.

## 3. Deploy ke Vercel

1. Buka https://vercel.com → daftar/login (bisa pakai akun GitHub).
2. Klik **Add New → Project**, lalu pilih repository GitHub yang barusan dibuat.
3. Pada bagian **Environment Variables**, tambahkan:
   - `UPSTASH_REDIS_REST_URL` = (nilai dari Upstash)
   - `UPSTASH_REDIS_REST_TOKEN` = (nilai dari Upstash)
   - (opsional) `SUPPORTED_EMAIL_DOMAINS` = `gmail.com,yahoo.com,outlook.com` (contoh, isi sesuai kebutuhan)
4. Klik **Deploy**, tunggu sampai selesai.
5. Setelah selesai, Vercel akan memberi domain sementara seperti `nama-project.vercel.app` — coba buka, pastikan halaman utama, register, dan login berjalan normal.

## 4. Sambungkan domain rijalsatoru-xd.my.id (dibeli di IDwebhost)

### Di dashboard Vercel
1. Masuk ke project → tab **Settings → Domains**.
2. Ketik `rijalsatoru-xd.my.id` lalu klik **Add**.
3. Vercel akan menampilkan record DNS yang perlu ditambahkan, biasanya seperti ini (nilai persisnya dilihat langsung di layar Vercel, karena bisa berbeda per akun):
   - Tipe `A`, Host `@`, Value `76.76.21.21`
   - Tipe `CNAME`, Host `www`, Value `cname.vercel-dns.com`

### Di panel IDwebhost
1. Login ke member area IDwebhost → menu **Domain** → pilih domain `rijalsatoru-xd.my.id`.
2. Masuk ke pengaturan **DNS Management / Kelola DNS** (bukan nameserver, kecuali kamu ingin Vercel yang urus semua DNS).
3. Tambahkan/ubah record sesuai yang diberikan Vercel:
   - Record `A` untuk `@` → arahkan ke IP yang diberikan Vercel.
   - Record `CNAME` untuk `www` → arahkan ke `cname.vercel-dns.com`.
4. Simpan perubahan.

### Tunggu propagasi
- Biasanya 5–60 menit, kadang bisa sampai 24 jam.
- Cek status di Vercel → Settings → Domains, sampai statusnya berubah jadi **Valid Configuration** (centang hijau).

Setelah domain aktif, semua link di project ini sudah otomatis mengarah ke `https://rijalsatoru-xd.my.id` (sudah di-hardcode di `common.js` dan `index.js`), jadi tidak perlu ubah kode lagi.

## 5. Uji coba setelah live

1. Buka `https://rijalsatoru-xd.my.id/register.html` → daftar akun baru dengan email dari domain yang didukung.
2. Salin API Key yang diberikan.
3. Coba salah satu endpoint, contoh:
   `https://rijalsatoru-xd.my.id/api/anime/naruto?apikey=API_KEY_KAMU`
4. Kalau muncul JSON `status: true`, berarti semuanya sudah berjalan.
