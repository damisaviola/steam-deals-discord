# Steam Deals Discord Notification

Aplikasi otomatisasi untuk mengambil data diskon game Steam Store regional Indonesia (IDR) dan mengirimkannya ke channel Discord melalui Webhook. Didesain untuk berjalan secara serverless menggunakan GitHub Actions tanpa memerlukan server atau VPS.

---

## Arsitektur Sistem

Aplikasi dieksekusi secara periodik menggunakan GitHub Actions cron.

```
Steam Store API (IDR) 
       │
       ▼
[ Fetch & Aggregasi ] ─── specials, top_sellers, featured
       │
       ▼
[ Filter & Sorting ]  ─── persentase diskon, batas harga, kuota
       │
       ▼
[ Deduplikasi Cache ] ─── cek src/storage/deals.json
       │
       ├── Deal lama (harga sama) ──> Skip
       └── Deal baru / beda harga ──> Discord Webhook (Embed)
                                             │
                                             ▼
                                     Update deals.json
                                             │
                                             ▼
                                     Git Commit & Push [skip ci]
```

### Karakteristik Teknis
- **Sumber Data**: Endpoint resmi Steam Store API (`featuredcategories` & `featured`) dengan parameter `cc=ID&l=indonesian`.
- **Parsing Mata Uang**: Menangani subunit harga Steam IDR (skala 100) menjadi nominal Rupiah bulat (`RpXXX.XXX`).
- **Deduplikasi**: Berbasis hash/key Steam App ID di flat JSON file (`deals.json`). Mencegah notifikasi berulang kecuali terjadi perubahan harga atau persentase diskon.
- **Resiliensi Jaringan**: Menangani Discord HTTP 429 (rate limit) secara dinamis menggunakan header `retry_after`, serta retry dengan *exponential backoff* pada HTTP 5xx.
- **Keamanan**: Masking otomatis URL webhook pada log output untuk mencegah kebocoran kredensial di console CI/CD.

---

## Konfigurasi

Konfigurasi diatur melalui environment variables (`.env` untuk lokal, Secrets/Variables untuk GitHub Actions).

| Variabel | Tipe | Default | Keterangan |
| :--- | :---: | :---: | :--- |
| `DISCORD_WEBHOOK_URL` | String | *(Wajib)* | URL Webhook channel Discord tujuan |
| `MIN_DISCOUNT` | Number | `0` | Minimal persentase diskon (`0` untuk semua diskon) |
| `MAX_PRICE` | Number | `0` | Batas harga maksimal setelah diskon dalam IDR (`0` untuk tanpa batas) |
| `MAX_GAMES` | Number | `0` | Maksimal game dikirim per eksekusi (`0` untuk kirim semua) |
| `INCLUDE_FREE_GAMES`| Boolean | `false` | Sertakan promo 100% / game gratis |
| `DISCORD_USERNAME` | String | `Steam Deals Alert` | Nama tampilan bot Discord |
| `DISCORD_AVATAR_URL`| String | *Steam Logo* | URL gambar profil webhook |
| `DISCORD_EMBED_COLOR`| String/Hex | `#1B2838` | Warna embed Discord (default navy Steam) |
| `STEAM_COUNTRY_CODE`| String | `ID` | Regional store Steam |
| `STEAM_LANGUAGE` | String | `indonesian` | Bahasa respon Steam Store |
| `REQUEST_TIMEOUT_MS`| Number | `10000` | Timeout HTTP request (ms) |

---

## Penggunaan Lokal

### Prasyarat
- Node.js >= 20 (Direkomendasikan Node.js 24 LTS)
- npm >= 10

### Instalasi
```bash
git clone https://github.com/damisaviola/steam-deals-discord.git
cd steam-deals-discord
npm install
```

### Konfigurasi `.env`
Salin template konfigurasi:
```bash
cp .env.example .env
```
Isi `DISCORD_WEBHOOK_URL` pada `.env` dengan webhook channel Discord Anda.

### Menjalankan

Mode Simulasi (Dry Run):
```bash
npm start -- --dry-run
```
*(Mengambil data dari Steam dan menampilkan hasil filter di terminal tanpa mengirim pesan ke Discord).*

Mode Live:
```bash
npm start
```

---

## Deployment GitHub Actions

Aplikasi dapat berjalan mandiri di GitHub Actions setiap 3 jam secara gratis.

### 1. Setup GitHub Secrets
1. Buka repository di GitHub > **Settings** > **Secrets and variables** > **Actions**.
2. Tambahkan **Repository Secret**:
   - Name: `DISCORD_WEBHOOK_URL`
   - Value: `<URL_WEBHOOK_DISCORD_ANDA>`

### 2. Atur Workflow Permissions
Agar GitHub Actions dapat menyimpan riwayat notifikasi ke `src/storage/deals.json`:
1. Buka **Settings** > **Actions** > **General**.
2. Di bagian **Workflow permissions**, pilih **Read and write permissions**.
3. Klik **Save**.

### 3. Eksekusi Manual
Workflow terjadwal otomatis setiap 3 jam (`0 */3 * * *`). Untuk memicu secara manual:
1. Masuk ke tab **Actions** di GitHub repository.
2. Pilih workflow **Steam Deals Discord Notification**.
3. Klik **Run workflow**.

---

## Struktur Direktori

```
steam-deals-discord/
├── .github/workflows/
│   └── steam-deals.yml       # Definisi cron & manual workflow
├── src/
│   ├── config/               # Schema validation & environment loader
│   ├── services/
│   │   ├── steam.service.js   # Steam API client & normalizer
│   │   ├── discord.service.js # Discord Webhook client & embed generator
│   │   └── storage.service.js # Atomic write & deduplication logic
│   ├── utils/
│   │   ├── filters.js         # Business logic filtering & sorting
│   │   ├── formatter.js       # IDR currency & number formatting
│   │   └── logger.js          # Structured logging & secret masking
│   ├── storage/
│   │   └── deals.json         # History database
│   └── index.js               # CLI orchestrator
├── tests/                     # Vitest automated test suite
├── .env.example
├── package.json
└── README.md
```

---

## Pengujian

Pengujian unit menggunakan Vitest mencakup verifikasi API normalizer, filter criteria, format Rupiah, rate limit handling, dan recovery storage rusak.

Menjalankan pengujian:
```bash
npm test
```

Menjalankan pengujian dengan coverage:
```bash
npm run test:coverage
```

---

## Lisensi

[MIT](LICENSE)
