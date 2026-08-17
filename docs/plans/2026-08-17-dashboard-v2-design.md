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
