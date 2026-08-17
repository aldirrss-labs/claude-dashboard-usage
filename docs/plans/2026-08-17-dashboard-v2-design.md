# Dashboard v2 — Design

Date: 2026-08-17

## Konteks

Lima permintaan dari user terhadap dashboard usage yang sudah berjalan:

1. Tombol "Sync Now" manual di halaman Projects dan Dashboard.
2. Default sort project list diubah ke "last active", plus opsi sort baru.
3. Perbaikan anomali: satu project fisik terpecah jadi banyak baris di Projects list.
4. Tombol back di halaman detail project.
5. Fitur tambahan agar dashboard lebih "advanced".

## 1. Perbaikan duplikat project

**Root cause (dikonfirmasi via query langsung ke `~/.claude-dashboard/usage.db`):** `projects.slug`
(nama folder mentah yang dibuat Claude Code dari cwd, dash-separated) dipakai sebagai dedup key.
Ini pecah jadi banyak baris untuk project yang sama ketika:

- Git worktree membuat folder `<slug>--claude-worktrees-<nama>` — secara fisik direktori berbeda,
  tapi konseptually project yang sama.
- `decodeProjectSlug()` (`lib/paths.ts`) merekonstruksi path dari slug dengan `slug.replace(/-/g, "/")`,
  lossy setiap kali segmen path asli mengandung dash literal (mis. `development-agent`).

Contoh nyata dari DB: `development-agent` punya 5 baris `projects` terpisah (1 asli + 4 worktree),
`premium` tercampur antara 2 project berbeda yang kebetulan share basename folder.

**Pendekatan:** migrasi skema + merge data, key dedup baru berbasis `canonical_path` (bukan `slug`).

### Perubahan skema

```sql
ALTER TABLE projects ADD COLUMN canonical_path TEXT;
CREATE UNIQUE INDEX idx_projects_canonical_path ON projects(canonical_path);
```

`slug` tetap ada (untuk referensi/debug) tapi bukan lagi unique constraint yang dipakai untuk dedup.

### Normalisasi path

Fungsi baru `normalizeCanonicalPath(displayPath): string` di `lib/paths.ts`:

- Strip suffix `--claude-worktrees-.*$` dari `display_path` (bukan dari `slug` — karena
  `display_path` sudah pakai `cwd` asli yang tidak lossy untuk mayoritas baris, hasil dari
  `ensureProject` yang sudah menyimpan `cwd` bila tersedia).
- Baris yang `display_path`-nya berasal dari fallback lossy `decodeProjectSlug()` (ditandai lewat
  flag/kolom `path_source` bila belum ada, atau dideteksi ulang saat migrasi dari histori) **tidak**
  dipaksa ikut merge otomatis — tetap berdiri sendiri sebagai baris terpisah agar tidak salah
  menggabungkan dua project berbeda yang kebetulan mirip.

### Migrasi data (one-time, dijalankan sebelum skema baru dipakai `ensureProject`)

1. **Backup wajib**: copy `usage.db` → `usage.db.bak-<timestamp>` sebelum migrasi jalan sama sekali.
2. Hitung `canonical_path` untuk semua baris `projects` existing.
3. Group by `canonical_path`. Untuk group dengan >1 baris:
   - Pilih baris "primary" = `first_seen_at` paling awal.
   - Re-point `sessions.project_id` dan `usage_events.project_id` dari baris non-primary ke primary.
   - Hapus baris `projects` non-primary.
4. Set `canonical_path` pada baris primary yang tersisa (dan baris tunggal lain yang tidak digroup).
5. Log ringkasan: jumlah project sebelum/sesudah migrasi, daftar merge yang terjadi (untuk audit).

### Perubahan `ensureProject()` (`lib/ingest.ts`)

Ke depan, lookup/insert menggunakan `canonical_path` (dihitung dari `cwd` yang diterima) sebagai key,
bukan `slug` mentah. Worktree baru untuk project yang sudah ada otomatis nyambung ke baris yang sama,
tidak membuat baris baru lagi.

## 2. Sync Now button

- `POST /api/ingest/sync` — memanggil `runIngestCycle()` (fungsi sama yang dipakai scheduler),
  mengembalikan `{ filesScanned, eventsInserted, syncedAt }`.
- `GET /api/ingest/status` — mengembalikan `{ lastSyncedAt }` dari `MAX(updated_at)` di `ingest_state`,
  dipakai untuk menampilkan status tanpa trigger sync.
- Komponen `SyncButton.tsx` dipakai bersama di Dashboard dan Projects page: tombol dengan state
  loading → sukses ("Tersinkron X detik lalu"). Setelah sukses, halaman refetch data yang relevan.

## 3. Sort default & opsi baru (Projects page)

- Default `SortKey` diubah dari `"totalTokens"` ke `"lastActiveAt"`.
- Tambah opsi sort: nama project (alfabetis), jumlah session.
- Tambah toggle ascending/descending (klik ulang opsi yang sama membalik arah), dengan indikator
  panah di dropdown/header.

## 4. Back button di halaman detail project

`<Link href="/projects">← Kembali ke Projects</Link>` di atas judul `app/projects/[slug]/page.tsx`.
Bukan `router.back()`, supaya tidak nyasar keluar aplikasi jika user landing langsung via URL.

## 5. Fitur advanced

### A. Analisis biaya & efisiensi

- Card "Cache savings" di Dashboard: estimasi $ yang dihemat dari cache read dibanding jika token
  itu dihitung sebagai input biasa, dihitung dari `model_pricing`.
- Proyeksi biaya bulanan: rata-rata biaya harian di range terpilih × 30, ditampilkan sebagai teks
  kecil di bawah card "Estimated cost".

### B. Perbandingan & trend project

- Tabel "Top Projects" di Dashboard (5 teratas by cost) dengan sparkline mini token/hari per baris —
  fitur yang memang sudah direncanakan di desain awal tapi belum dibangun.
- Kolom week-over-week % di tabel Projects, dibanding minggu sebelumnya.

### C. Detail session lebih dalam

- Mini bar chart token per session di atas tabel sessions (halaman detail project).
- Kolom "Model" per session di tabel sessions (join ke `usage_events.model`, ambil model dominan
  per session).

### D. Alerting & monitoring

- Input threshold biaya harian di Settings, disimpan ke tabel `budget_limits` (sudah ada di skema,
  belum dipakai).
- Badge peringatan visual di Dashboard jika biaya hari ini melebihi threshold. Tidak ada notifikasi
  push/email — di luar scope, butuh infra terpisah.

## Urutan implementasi

1. Migrasi duplikat project (paling berisiko, sentuh data production — dikerjakan & diverifikasi
   duluan sebelum fitur lain dibangun di atasnya).
2. Sync Now button + status.
3. Sort default + opsi baru + back button (perubahan kecil, cepat).
4. Fitur advanced A–D.

---

# Dashboard v3 — follow-up (same date)

Follow-up request setelah v2 di-deploy:

1. Klarifikasi: "WoW" = Week-over-Week (kolom % perubahan biaya vs minggu lalu). Membingungkan →
   diperjelas jadi bagian dari poin 2.
2. Ubah semua teks UI (Bahasa Indonesia yang ditambahkan di v2) ke Bahasa Inggris.
3. Laporan email harian via SMTP Gmail.
4. Ganti tema visual meniru referensi Framer "Insightix" (sidebar terang + aksen biru, card metrics
   besar, chart gradient halus).
5. Tambah link "View Claude Pricing" di halaman Settings.
6. (Ditambahkan pertengahan sesi) Ganti chart dari Recharts polos ke Tremor (`@tremor/react`) untuk
   visual yang lebih modern, selaras dengan gaya Insightix.

## 6. Bahasa Inggris + link pricing

Semua string UI yang ditambahkan di v2 (SyncButton status, budget badge, label "Budget harian",
kolom WoW, dsb.) diterjemahkan ke Inggris. Kolom WoW diberi header penuh "Week-over-week" dengan
`title` tooltip menjelaskan artinya. Settings page dapat link
`<a href="https://www.anthropic.com/pricing" target="_blank">View Claude Pricing ↗</a>` — URL sama
yang sudah dipakai `/api/pricing/sync` untuk scraping.

## 7. Laporan email harian (SMTP Gmail)

**Skema baru:**

```sql
CREATE TABLE email_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  smtp_user TEXT,
  smtp_app_password TEXT,
  recipient_email TEXT,
  enabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE email_log (
  report_date TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL,
  status TEXT NOT NULL
);
```

Kredensial SMTP (Gmail App Password) disimpan plain text di `usage.db` lokal — trade-off yang
disetujui user demi kemudahan edit dari UI Settings (aplikasi single-user, DB tidak exposed publik).

**Trigger:** di dalam siklus ingest yang sudah berjalan tiap 5 menit (`lib/ingest-scheduler.ts`).
Tiap siklus: jika waktu sekarang sudah lewat tengah malam DAN `email_log` belum punya baris untuk
tanggal kemarin DAN `email_settings.enabled = 1`, generate + kirim laporan untuk kemarin, lalu catat
ke `email_log`. Toleransi delay hingga 5 menit dari tengah malam persis — dapat diterima, tidak perlu
cron OS terpisah.

**Isi laporan (HTML email, hanya data hari yang baru lewat, apa pun kondisi threshold-nya):**
- Total token & biaya hari itu.
- Breakdown per project yang aktif hari itu.
- Breakdown per model.
- Cache efficiency % dan cache savings $ hari itu.
- Perbandingan % vs hari sebelumnya (token & biaya).

**Library:** `nodemailer`, transport Gmail SMTP dengan App Password.

**UI Settings:** form baru "Email Reports" — SMTP user, App Password (input type password), recipient
email, toggle enable/disable, tombol "Send Test Email" (kirim laporan untuk hari ini secara langsung,
tanpa menunggu tengah malam, untuk verifikasi konfigurasi).

Badge peringatan budget di Dashboard (v2, bagian 5.D) **tetap dipertahankan**, terpisah dari email —
email adalah ringkasan rutin, badge adalah indikator real-time saat browsing dashboard.

## 8. Tema visual — gaya Insightix

Referensi: Framer marketplace template "Insightix" (sidebar putih, aksen biru terang `#3b82f6`-ish,
card metrics besar dengan angka bold + trend indicator kecil, area chart gradient biru lembut).

- Sidebar: dari gelap (command-center theme, v1) → putih/terang dengan border tipis kanan, ikon
  abu-abu, item aktif = background biru muda + teks & ikon biru.
- Card metrics: diperbesar, angka lebih bold, ditambah baris trend kecil (↑/↓ vs periode
  sebelumnya) di bawah tiap angka — pola yang sama dengan `WeekOverWeekBadge` yang sudah ada,
  digeneralisasi jadi komponen `TrendIndicator` dipakai ulang di `SummaryCard`.
- Tidak ada dark mode — satu tema terang saja, sesuai keputusan user.
- Warna aksen biru diselaraskan dengan `COLOR_INPUT` (`#2a78d6`) yang sudah dipakai di chart, supaya
  konsisten dengan palet kategori data yang sudah divalidasi (dataviz skill).

## 9. Migrasi chart ke Tremor

Ganti `UsageTimeSeriesChart`, `ModelBreakdownChart`, `TopProjectsTable` (sparkline), dan
`SessionTokensChart` dari Recharts mentah ke komponen `@tremor/react` (`AreaChart`, `BarChart`,
`SparkAreaChart`) — library yang dibangun khusus untuk dashboard analytics, stylingnya selaras
dengan referensi Insightix (gradient halus, animasi transisi, tooltip lebih polished). Tremor
sendiri dibangun di atas Recharts, jadi migrasi ini adalah penggantian lapisan styling/API, bukan
penulisan ulang total dari nol.
