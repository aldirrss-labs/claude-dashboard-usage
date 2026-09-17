import "./test-db-setup";
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  InvalidPassphraseError,
  MalformedExportError,
  decryptExport,
  encryptExport,
  type ExportedAccount,
} from "../account-transfer";

const SAMPLE: ExportedAccount[] = [
  {
    label: "Work Fulltime",
    email: "work@example.com",
    organizationUuid: "org-1",
    accountUuid: "acct-1",
    credentialsSnapshot: JSON.stringify({ claudeAiOauth: { accessToken: "at-1", refreshToken: "rt-1" } }),
    oauthAccountSnapshot: JSON.stringify({ emailAddress: "work@example.com" }),
    groupName: "work",
  },
  {
    label: "Personal",
    email: null,
    organizationUuid: "org-2",
    accountUuid: "acct-2",
    credentialsSnapshot: JSON.stringify({ claudeAiOauth: { accessToken: "at-2", refreshToken: "rt-2" } }),
    oauthAccountSnapshot: "{}",
    groupName: null,
  },
];

describe("account export encryption", () => {
  it("round-trips accounts through encrypt/decrypt", () => {
    const encrypted = encryptExport(SAMPLE, "correct horse battery");
    const decrypted = decryptExport(encrypted, "correct horse battery");
    assert.deepStrictEqual(decrypted, SAMPLE);
  });

  it("never leaves tokens readable in the exported envelope", () => {
    const encrypted = encryptExport(SAMPLE, "correct horse battery");
    const serialized = JSON.stringify(encrypted);
    // The whole point of encrypting: no secret, email, or label in the clear.
    assert.ok(!serialized.includes("rt-1"));
    assert.ok(!serialized.includes("at-1"));
    assert.ok(!serialized.includes("work@example.com"));
    assert.ok(!serialized.includes("Work Fulltime"));
    assert.strictEqual(encrypted.accountCount, 2);
  });

  it("rejects the wrong passphrase", () => {
    const encrypted = encryptExport(SAMPLE, "right passphrase");
    assert.throws(() => decryptExport(encrypted, "wrong passphrase"), InvalidPassphraseError);
  });

  it("rejects a tampered ciphertext rather than importing garbage", () => {
    const encrypted = encryptExport(SAMPLE, "right passphrase");
    const raw = Buffer.from(encrypted.ciphertext, "base64");
    raw[0] ^= 0xff;
    const tampered = { ...encrypted, ciphertext: raw.toString("base64") };
    assert.throws(() => decryptExport(tampered, "right passphrase"), InvalidPassphraseError);
  });

  it("rejects a tampered auth tag", () => {
    const encrypted = encryptExport(SAMPLE, "right passphrase");
    const tag = Buffer.from(encrypted.authTag, "base64");
    tag[0] ^= 0xff;
    assert.throws(
      () => decryptExport({ ...encrypted, authTag: tag.toString("base64") }, "right passphrase"),
      InvalidPassphraseError
    );
  });

  it("uses a fresh salt and iv per export, so identical input differs", () => {
    const a = encryptExport(SAMPLE, "same passphrase");
    const b = encryptExport(SAMPLE, "same passphrase");
    assert.notStrictEqual(a.ciphertext, b.ciphertext);
    assert.notStrictEqual(a.kdf.salt, b.kdf.salt);
    assert.notStrictEqual(a.iv, b.iv);
  });

  it("reads KDF parameters from the file so older exports still open", () => {
    const encrypted = encryptExport(SAMPLE, "pass phrase here");
    // Parameters are recorded, not assumed.
    assert.strictEqual(encrypted.kdf.name, "scrypt");
    assert.ok(encrypted.kdf.N >= 2 ** 15);
    assert.deepStrictEqual(decryptExport(encrypted, "pass phrase here"), SAMPLE);
  });

  it("still opens an export written under the old product name", () => {
    // A backup made before the rename must stay restorable; the format string
    // is a compatibility contract, not branding.
    const encrypted = encryptExport(SAMPLE, "pass phrase here");
    const legacy = { ...encrypted, format: "claude-dashboard-accounts" };
    assert.deepStrictEqual(decryptExport(legacy, "pass phrase here"), SAMPLE);
  });

  it("rejects foreign or malformed files with a clear error", () => {
    assert.throws(() => decryptExport({ format: "something-else" }, "x"), MalformedExportError);
    assert.throws(() => decryptExport("not an object", "x"), MalformedExportError);
    assert.throws(() => decryptExport(null, "x"), MalformedExportError);

    const encrypted = encryptExport(SAMPLE, "pass phrase here");
    assert.throws(() => decryptExport({ ...encrypted, version: 999 }, "pass phrase here"), MalformedExportError);
    assert.throws(
      () => decryptExport({ ...encrypted, kdf: { name: "pbkdf2" } }, "pass phrase here"),
      MalformedExportError
    );
  });
});
