# Account Swap — Design

Date: 2026-09-17

## Konteks

User memegang 4 akun Claude (3 dari tim tempat kerja, 1 pribadi), dan selama ini pindah akun
dilakukan manual (logout/login ulang lewat CLI). User sempat coba tool eksternal
[claude-swap](https://github.com/realiti4/claude-swap) tapi tidak mau mempercayakan kredensial
sesinya ke tool pihak ketiga yang tidak dia tulis sendiri — sehingga diminta versi sendiri,
terintegrasi ke dashboard usage yang sudah ada.

**Riset mekanisme** (dari source code `claude-swap`, bukan cuma README-nya) menemukan beberapa hal
yang membentuk desain ini:

1. Kredensial aktif Claude Code di Linux ada di satu file plaintext:
   `~/.claude/.credentials.json`, isi utamanya `claudeAiOauth` (accessToken, refreshToken,
   expiresAt, refreshTokenExpiresAt, scopes, subscriptionType, rateLimitTier) + `organizationUuid`.
2. File yang sama juga berisi key **shared di level mesin**, bukan per-akun:
   `mcpOAuth`, `mcpOAuthClientConfig`, `mcpXaaIdp`, `mcpXaaIdpConfig`, `pluginSecrets` — token login
   MCP server (Figma, GitHub, Neon, Vercel, dst). Kalau kredensial akun lama ditimpa mentah-mentah
   ke file ini, login MCP server ikut ter-rollback ke snapshot lama. Key-key ini harus selalu
   diambil dari file **live saat ini**, bukan dari snapshot akun yang diaktifkan.
3. `~/.claude.json` punya field `oauthAccount` (email, org, uuid, billing, dst) yang memang harus
   ikut ditukar bersamaan supaya identitas yang ditampilkan CLI konsisten dengan token yang aktif —
   tapi sisa file itu (100KB+: `projects`, `mcpServers`, cache, settings) tidak boleh disentuh.
4. Claude Code memakai lock kooperatif berbasis direktori (`mkdir` sebagai mutex) saat me-refresh
   token: `~/.claude/.oauth_refresh.lock` (basi setelah 60 detik) lalu `~/.claude.lock` (legacy,
   sama 60 detik), dan `~/.claude.json.lock` (basi setelah 10 detik) saat menulis config. Proses
   swap kita ikut mengambil lock yang sama, urutan sama, supaya tidak race dengan proses Claude Code
   yang sedang jalan (termasuk sesi CLI yang sedang aktif di terminal lain).

## Scope

**Goals:**
- Simpan kredensial untuk beberapa akun Claude di SQLite (`usage.db` yang sudah ada).
- Halaman baru di dashboard untuk melihat semua akun tersimpan dan pindah akun aktif dengan
  satu klik.
- Swap yang aman: tidak merusak login MCP server, tidak race dengan proses Claude Code lain,
  atomic write, tidak kehilangan token akun yang ditinggalkan.

**Non-goals** (fitur `claude-swap` yang sengaja tidak dibangun — bisa ditambah belakangan kalau
memang dibutuhkan):
- macOS Keychain (target: Linux saja).
- Auto-switch berdasarkan sisa kuota/rate limit.
- "Session mode" — menjalankan beberapa akun paralel di terminal berbeda secara bersamaan.
- Auto-map direktori project → akun tertentu.
- TUI, menu bar, export/import file, tambah akun dari raw API key/setup-token.
- Verifikasi kepemilikan kredensial via panggilan API profile (dipakai `claude-swap` untuk deteksi
  tamper — berlebihan untuk satu mesin, satu user).
- Dukungan `CLAUDE_CONFIG_DIR` custom (asumsi: profil default `~/.claude`).

## Data model

Tabel baru di `usage.db` (skema ditambahkan ke `SCHEMA` di `lib/db.ts`, mengikuti pola tabel
existing seperti `email_settings`):

```sql
CREATE TABLE IF NOT EXISTS claude_accounts (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  email TEXT,
  organization_uuid TEXT NOT NULL,
  account_uuid TEXT NOT NULL,
  credentials_snapshot TEXT NOT NULL,   -- JSON: {claudeAiOauth, trustedDeviceToken?, organizationUuid}
  oauth_account_snapshot TEXT NOT NULL, -- JSON: seluruh objek oauthAccount live saat disimpan
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_claude_accounts_identity
  ON claude_accounts(organization_uuid, account_uuid);
```

`credentials_snapshot` **hanya** berisi field akun-spesifik. Key shared (`mcpOAuth` dkk) tidak
pernah masuk snapshot — selalu diambil dari file live saat aktivasi (lihat algoritma swap).

Menyimpan ulang akun yang `organization_uuid`+`account_uuid`-nya sudah ada → update in-place
(`ON CONFLICT DO UPDATE`), bukan duplikat.

## Modul inti: `lib/account-swap.ts`

Kumpulan fungsi murni + I/O yang dipisah dari route handler supaya bisa ditest tanpa Next.js:

```ts
// Baca kredensial & oauthAccount live saat ini
function readLiveClaudeState(): { credentials: object; oauthAccount: object | null }

// Pisahkan field akun-spesifik vs shared dari objek credentials.json
function splitCredentialFields(credentials: object): {
  accountScoped: object;   // claudeAiOauth, trustedDeviceToken, organizationUuid
  shared: object;          // mcpOAuth, mcpOAuthClientConfig, mcpXaaIdp, mcpXaaIdpConfig, pluginSecrets
}

// Gabungkan accountScoped milik target + shared milik live saat ini
function composeCredentials(targetAccountScoped: object, liveShared: object): object

// Lock kooperatif ala Claude Code (mkdir sbg mutex, staleness check, auto-release via try/finally)
async function withClaudeCredentialsLock<T>(fn: () => Promise<T>): Promise<T>
async function withClaudeConfigLock<T>(fn: () => Promise<T>): Promise<T>

// Tulis atomic: temp file di direktori yang sama -> rename -> chmod 600
function atomicWriteJson(path: string, data: object): void

// Orkestrasi satu switch penuh (lihat algoritma di bawah)
async function switchToAccount(accountId: number): Promise<void>
```

### Algoritma `switchToAccount`

1. `withClaudeCredentialsLock` + `withClaudeConfigLock` (nested, urutan sama seperti Claude Code:
   `.oauth_refresh.lock` → `.claude.lock` → `.claude.json.lock`).
2. `readLiveClaudeState()` — baca `.credentials.json` + `.claude.json`'s `oauthAccount` saat ini.
3. Cari row `claude_accounts` yang `organization_uuid`+`account_uuid`-nya cocok dengan live state.
   - **Cocok** → update `credentials_snapshot`/`oauth_account_snapshot` row itu dengan versi live
     (capture-before-switch, supaya token yang sudah di-refresh Claude Code sejak terakhir
     disimpan tidak hilang).
   - **Tidak cocok** → lempar error jenis `UnsavedActiveSessionError` — endpoint switch menolak
     dengan pesan: "Sesi aktif saat ini belum tersimpan sebagai akun. Simpan dulu lewat 'Save
     current session', atau Anda akan kehilangan akses ke sesi ini."
4. `composeCredentials(target.accountScoped, live.shared)` → tulis atomic ke
   `~/.claude/.credentials.json`.
5. Baca `~/.claude.json` saat ini, ganti **hanya** field `.oauthAccount` dengan
   `target.oauth_account_snapshot`, tulis atomic kembali (key lain di file itu tidak disentuh).
6. Jika langkah 4 atau 5 gagal: best-effort tulis balik state asli dari langkah 2, lalu lempar
   error asli.
7. Lock dilepas (finally block, urutan pelepasan terbalik dari akuisisi).

### `addAccountFromCurrentSession(label: string)`

1. `readLiveClaudeState()`.
2. Jika `oauthAccount` live kosong/null → tolak ("belum login di Claude Code, jalankan `/login`
   dulu").
3. `splitCredentialFields()` → simpan `accountScoped` + `oauthAccount` sebagai row baru/update
   (`ON CONFLICT` by identity).

## API routes (`app/api/accounts/`)

| Route | Method | Fungsi |
|---|---|---|
| `/api/accounts` | GET | List akun tersimpan. Setiap row dilengkapi `active: boolean` — dihitung saat request dengan membandingkan `organization_uuid`+`account_uuid` row ke `oauthAccount` live, bukan flag yang disimpan (mencegah drift). |
| `/api/accounts` | POST | Body `{ label }` → `addAccountFromCurrentSession(label)`. |
| `/api/accounts/[id]/switch` | POST | → `switchToAccount(id)`. 409 kalau `UnsavedActiveSessionError`. |
| `/api/accounts/[id]` | PATCH | Body `{ label }` → rename. |
| `/api/accounts/[id]` | DELETE | Hapus row (tidak menyentuh file live sama sekali). |

## UI

- Halaman baru `app/accounts/page.tsx`, item nav ke-4 di `Sidebar.tsx` (ikon baru, mis. dua panah
  saling silang untuk "swap").
- Tabel akun: Label | Email | Organization | Status | Terakhir disimpan | Aksi.
  - Status: "Active now" (hijau) jika `active === true`; badge kuning "⚠ refresh token expired"
    jika `oauth_account_snapshot`/token di dalam `credentials_snapshot` sudah lewat
    `refreshTokenExpiresAt` — **tidak memblokir** switch, cuma warning (persis seperti
    `claude-swap`: kalau memang expired, Claude Code akan minta `/login` ulang untuk akun itu).
  - Aksi: "Switch" (disabled kalau sudah active), "Rename" (inline edit label), "Remove".
- Tombol "+ Save current session" di atas tabel → form kecil (inline, bukan modal terpisah,
  konsisten dengan pola form Settings yang sudah ada) untuk input label, prefill dari
  `oauthAccount.emailAddress` live kalau terbaca.
- Reuse pola styling existing (`SummaryCard`, table style `ProjectTable.tsx`) — tidak bikin sistem
  desain baru.

## Catatan keamanan

- Fitur ini aman untuk dibangun karena dashboard sudah local-only (`HOSTNAME=127.0.0.1`, systemd
  user service) dan single-user. **Jangan** pernah expose ke jaringan setelah fitur ini ada —
  siapa pun yang bisa akses dashboard bisa membaca token OAuth semua akun tersimpan.
- Kredensial disimpan plaintext di `usage.db` (konsisten dengan `.credentials.json` asli dan
  `email_settings` yang sudah plaintext hari ini) — tidak ada enkripsi/passphrase tambahan,
  sesuai keputusan user.
- Switch menulis file yang mungkin sedang dibaca sesi Claude Code lain (termasuk sesi CLI yang
  sedang berjalan di terminal lain). Lock mengurangi race saat penulisan, tapi sesi yang sedang
  aktif tetap bisa "kaget" kalau identitasnya berubah di tengah kerja — hindari switch di saat ada
  sesi coding panjang yang sedang berjalan di akun yang mau ditinggalkan.

## Testing

- Unit test `splitCredentialFields` / `composeCredentials` — fungsi murni, fixture JSON tanpa
  sentuh file asli.
- Unit test lock helper (`withClaudeCredentialsLock` dkk): acquire, deteksi stale >60s/>10s dan
  ambil alih, release — dijalankan di direktori temp, bukan `~/.claude`.
- Integration test `switchToAccount`/`addAccountFromCurrentSession` dengan path Claude di-override
  lewat env var (mis. `CLAUDE_CONFIG_DIR_OVERRIDE` khusus test, atau parameter injeksi path) yang
  mengarah ke fixture di direktori temp — memverifikasi: (a) key shared tidak ikut tertimpa,
  (b) hanya `oauthAccount` yang berubah di `.claude.json`, key lain identik sebelum/sesudah,
  (c) capture-before-switch benar-benar menyimpan state live terbaru sebelum overwrite,
  (d) switch ke akun yang live-nya tidak cocok dengan row manapun → `UnsavedActiveSessionError`.

## Urutan implementasi

1. `lib/account-swap.ts` — fungsi murni (`splitCredentialFields`, `composeCredentials`) + unit test,
   tanpa I/O dulu.
2. Lock helper + atomic write, dites di direktori temp.
3. Skema `claude_accounts` di `lib/db.ts` + query helpers (pola `lib/queries.ts`).
4. `switchToAccount` + `addAccountFromCurrentSession`, integration test dengan path di-override.
5. API routes.
6. Halaman `/accounts` + nav item — dites manual di browser terhadap akun sungguhan (hati-hati:
   pakai akun yang bukan sedang dipakai untuk sesi kerja aktif saat testing manual).
