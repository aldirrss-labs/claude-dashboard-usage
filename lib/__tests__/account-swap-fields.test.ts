import { describe, it } from "node:test";
import assert from "node:assert";
import { SHARED_CREDENTIAL_KEYS, splitCredentialFields, composeCredentials } from "../account-swap-fields";

describe("splitCredentialFields", () => {
  it("puts claudeAiOauth, organizationUuid, and trustedDeviceToken into accountScoped", () => {
    const credentials = {
      claudeAiOauth: { accessToken: "at-1", refreshToken: "rt-1" },
      organizationUuid: "org-1",
      trustedDeviceToken: "device-1",
      mcpOAuth: { figma: { accessToken: "figma-token" } },
    };
    const { accountScoped, shared } = splitCredentialFields(credentials);
    assert.deepStrictEqual(accountScoped, {
      claudeAiOauth: { accessToken: "at-1", refreshToken: "rt-1" },
      organizationUuid: "org-1",
      trustedDeviceToken: "device-1",
    });
    assert.deepStrictEqual(shared, { mcpOAuth: { figma: { accessToken: "figma-token" } } });
  });

  it("puts every SHARED_CREDENTIAL_KEYS member present in the input into shared", () => {
    const credentials = {
      claudeAiOauth: { accessToken: "at-1" },
      organizationUuid: "org-1",
      mcpOAuth: { a: 1 },
      mcpOAuthClientConfig: { b: 2 },
      mcpXaaIdp: { c: 3 },
      mcpXaaIdpConfig: { d: 4 },
      pluginSecrets: { e: 5 },
    };
    const { shared } = splitCredentialFields(credentials);
    for (const key of SHARED_CREDENTIAL_KEYS) {
      assert.ok(key in shared, `expected shared to contain ${key}`);
    }
    assert.strictEqual(Object.keys(shared).length, SHARED_CREDENTIAL_KEYS.length);
  });

  it("returns an empty shared object (not an error) when no shared keys are present", () => {
    const credentials = { claudeAiOauth: { accessToken: "at-1" }, organizationUuid: "org-1" };
    const { shared } = splitCredentialFields(credentials);
    assert.deepStrictEqual(shared, {});
  });
});

describe("composeCredentials", () => {
  it("contains the target's accountScoped fields and the live session's shared fields verbatim", () => {
    const targetAccountScoped = {
      claudeAiOauth: { accessToken: "target-at" },
      organizationUuid: "org-target",
    };
    const liveShared = { mcpOAuth: { figma: { accessToken: "live-figma-token" } } };

    const result = composeCredentials(targetAccountScoped, liveShared);

    assert.deepStrictEqual(result, {
      claudeAiOauth: { accessToken: "target-at" },
      organizationUuid: "org-target",
      mcpOAuth: { figma: { accessToken: "live-figma-token" } },
    });
  });

  it("never carries over a shared key absent from liveShared", () => {
    // liveShared has no mcpOAuth (machine no longer holds it) — composing must not
    // resurrect any stale mcpOAuth that might otherwise leak in from elsewhere.
    const targetAccountScoped = { claudeAiOauth: { accessToken: "target-at" }, organizationUuid: "org-target" };
    const liveShared = {};

    const result = composeCredentials(targetAccountScoped, liveShared);

    assert.ok(!("mcpOAuth" in result));
    assert.deepStrictEqual(result, targetAccountScoped);
  });
});
