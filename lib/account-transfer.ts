import crypto from "node:crypto";
import {
  findAccountByIdentity,
  listAccounts,
  setAccountGroup,
  upsertAccountFromLive,
} from "./account-queries";

// An export carries live OAuth tokens for every saved account, so it is always
// encrypted — there is no plaintext export path. scrypt derives the key from a
// passphrase; AES-256-GCM gives confidentiality plus tamper detection, so a
// truncated or edited file fails to open rather than importing garbage.
export const EXPORT_FORMAT = "claude-rooms-accounts";
/**
 * The identifier written before the rename. New exports carry the new name, but
 * files already on disk carry this one — rejecting them would make a backup
 * unrestorable, which is the one thing a backup must never be.
 */
export const LEGACY_EXPORT_FORMATS = ["claude-dashboard-accounts"] as const;
export const EXPORT_VERSION = 1;

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
// Cost parameters: ~100ms on a laptop, and high enough that a weak passphrase
// is not trivially brute-forced offline if the file leaks.
const SCRYPT_COST = 2 ** 15;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
// scrypt needs roughly 128 * N * r bytes; Node's default 32MB cap is too low
// for N=32768, r=8 (~32MB) and throws without this headroom.
const SCRYPT_MAXMEM = 128 * SCRYPT_COST * SCRYPT_BLOCK_SIZE * 2;

export class InvalidPassphraseError extends Error {}
export class MalformedExportError extends Error {}

export interface ExportedAccount {
  label: string;
  email: string | null;
  organizationUuid: string;
  accountUuid: string;
  credentialsSnapshot: string;
  oauthAccountSnapshot: string;
  groupName: string | null;
}

export interface EncryptedExport {
  format: typeof EXPORT_FORMAT;
  version: number;
  kdf: { name: "scrypt"; N: number; r: number; p: number; salt: string };
  cipher: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
  exportedAt: string;
  accountCount: number;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
    maxmem: SCRYPT_MAXMEM,
  });
}

export function collectAccountsForExport(): ExportedAccount[] {
  return listAccounts().map((row) => ({
    label: row.label,
    email: row.email,
    organizationUuid: row.organizationUuid,
    accountUuid: row.accountUuid,
    credentialsSnapshot: row.credentialsSnapshot,
    oauthAccountSnapshot: row.oauthAccountSnapshot,
    groupName: row.groupName,
  }));
}

export function encryptExport(accounts: ExportedAccount[], passphrase: string): EncryptedExport {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(passphrase, salt);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ accounts }), "utf8"),
    cipher.final(),
  ]);

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    kdf: {
      name: "scrypt",
      N: SCRYPT_COST,
      r: SCRYPT_BLOCK_SIZE,
      p: SCRYPT_PARALLELISM,
      salt: salt.toString("base64"),
    },
    cipher: "aes-256-gcm",
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    exportedAt: new Date().toISOString(),
    accountCount: accounts.length,
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new MalformedExportError(`Export is missing "${field}".`);
  }
  return value;
}

export function decryptExport(payload: unknown, passphrase: string): ExportedAccount[] {
  if (!payload || typeof payload !== "object") {
    throw new MalformedExportError("Export file is not a JSON object.");
  }
  const obj = payload as Record<string, unknown>;

  const accepted: readonly string[] = [EXPORT_FORMAT, ...LEGACY_EXPORT_FORMATS];
  if (typeof obj.format !== "string" || !accepted.includes(obj.format)) {
    throw new MalformedExportError("Not a Claude Rooms account export.");
  }
  if (obj.version !== EXPORT_VERSION) {
    throw new MalformedExportError(`Unsupported export version ${String(obj.version)}.`);
  }

  const kdf = obj.kdf as Record<string, unknown> | undefined;
  if (!kdf || kdf.name !== "scrypt") {
    throw new MalformedExportError("Unsupported key derivation.");
  }

  // Read the KDF parameters from the file rather than assuming the current
  // constants, so exports still open after the cost parameters are raised.
  const salt = Buffer.from(requireString(kdf.salt, "kdf.salt"), "base64");
  const key = crypto.scryptSync(passphrase, salt, KEY_LENGTH, {
    N: typeof kdf.N === "number" ? kdf.N : SCRYPT_COST,
    r: typeof kdf.r === "number" ? kdf.r : SCRYPT_BLOCK_SIZE,
    p: typeof kdf.p === "number" ? kdf.p : SCRYPT_PARALLELISM,
    maxmem: SCRYPT_MAXMEM,
  });

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(requireString(obj.iv, "iv"), "base64")
  );
  decipher.setAuthTag(Buffer.from(requireString(obj.authTag, "authTag"), "base64"));

  let plaintext: string;
  try {
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(requireString(obj.ciphertext, "ciphertext"), "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // GCM auth failure: wrong passphrase, or the file was altered. The two are
    // indistinguishable by design, so report the likely cause.
    throw new InvalidPassphraseError("Wrong passphrase, or the export file is corrupt.");
  }

  const parsed = JSON.parse(plaintext) as { accounts?: unknown };
  if (!Array.isArray(parsed.accounts)) {
    throw new MalformedExportError("Export contains no accounts array.");
  }

  return parsed.accounts.map((entry, index) => {
    const a = entry as Record<string, unknown>;
    return {
      label: requireString(a.label, `accounts[${index}].label`),
      email: typeof a.email === "string" ? a.email : null,
      organizationUuid: requireString(a.organizationUuid, `accounts[${index}].organizationUuid`),
      accountUuid: requireString(a.accountUuid, `accounts[${index}].accountUuid`),
      credentialsSnapshot: requireString(a.credentialsSnapshot, `accounts[${index}].credentialsSnapshot`),
      oauthAccountSnapshot: requireString(a.oauthAccountSnapshot, `accounts[${index}].oauthAccountSnapshot`),
      groupName: typeof a.groupName === "string" ? a.groupName : null,
    };
  });
}

export interface ImportResult {
  added: string[];
  updated: string[];
  skipped: string[];
}

/**
 * Import accounts from a decrypted export.
 *
 * Identity is the (organizationUuid, accountUuid) pair, matching the table's
 * unique index. By default an existing account is left alone — its stored
 * token may be a *newer* generation than the one in the export, and
 * overwriting it with an older refresh token would break the next refresh.
 * `overwrite` is available for the deliberate restore-this-backup case.
 */
export function importAccounts(
  accounts: ExportedAccount[],
  options: { overwrite?: boolean } = {}
): ImportResult {
  const result: ImportResult = { added: [], updated: [], skipped: [] };

  for (const account of accounts) {
    const existing = findAccountByIdentity(account.organizationUuid, account.accountUuid);

    if (existing && !options.overwrite) {
      result.skipped.push(account.label);
      continue;
    }

    const saved = upsertAccountFromLive({
      label: account.label,
      email: account.email,
      organizationUuid: account.organizationUuid,
      accountUuid: account.accountUuid,
      credentialsSnapshot: account.credentialsSnapshot,
      oauthAccountSnapshot: account.oauthAccountSnapshot,
    });
    // Group is written separately: upsertAccountFromLive deliberately leaves it
    // alone so that re-saving a live session never clears its grouping.
    if (account.groupName !== null) {
      setAccountGroup(saved.id, account.groupName);
    }

    (existing ? result.updated : result.added).push(account.label);
  }

  return result;
}
