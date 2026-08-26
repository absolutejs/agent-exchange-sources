import { describe, expect, test } from "bun:test";
import {
  AgentExchangeError,
  type AgentExchangeRequest,
} from "@absolutejs/agent-exchange";
import type {
  EmailVerificationLookupInput,
  NormalizedEmailMessage,
} from "@absolutejs/email";
import {
  createEmailVerificationCodeSource,
  EMAIL_AGENT_EXCHANGE_SOURCE_MANIFEST,
  type EmailAgentExchangeProfile,
} from "../src";
import { manifest } from "../src/manifest";

const NOW = Date.parse("2026-08-26T10:00:00.000Z");
const PROFILE: EmailAgentExchangeProfile = {
  bodyMarkers: ["verification code"],
  id: "accounts-example-six-digit-v1",
  operations: ["verification.submit"],
  origins: ["https://accounts.example.com"],
  providers: ["gmail"],
  senderAddresses: ["security@example.com"],
  subjectIncludesAny: ["sign in"],
};

const request = (
  overrides: Partial<AgentExchangeRequest> = {},
): AgentExchangeRequest => ({
  actionId: "act_source-test",
  createdAt: NOW - 10_000,
  exchangeId: "xchg_source-test",
  expiresAt: NOW + 60_000,
  maximumUses: 1,
  nonce: "nonce_source-test",
  processingMode: "tool-confined",
  purpose: "email.verification.submit",
  recipient: {
    agentId: "recipient-agent",
    authority: "https://recipient.example",
    subject: "recipient-user",
  },
  requester: {
    agentId: "requester-agent",
    authority: "https://requester.example",
    subject: "requester-user",
  },
  resource: {
    accountRef: "mailbox-account-1",
    challengeId: "challenge-1",
    operation: "verification.submit",
    origin: "https://accounts.example.com",
    provider: "gmail",
  },
  risk: "authentication",
  secretKind: "email-one-time-code",
  ...overrides,
});

const message = (
  overrides: Partial<NormalizedEmailMessage> = {},
): NormalizedEmailMessage => ({
  accountEmail: "member@example.net",
  bodyText: "Your verification code is 482193.",
  direction: "inbound",
  from: { address: "security@example.com" },
  id: "gmail-message-1",
  occurredAt: new Date(NOW - 5_000),
  provider: "gmail",
  subject: "Sign in to Example",
  to: [{ address: "member@example.net" }],
  ...overrides,
});

describe("email Agent Exchange source", () => {
  test("binds the exact request and returns bytes with non-secret evidence", async () => {
    let lookupInput: EmailVerificationLookupInput | undefined;
    const source = createEmailVerificationCodeSource({
      lookup: {
        find: (input) => {
          lookupInput = input;
          return Promise.resolve([message()]);
        },
      },
      now: () => NOW,
      profiles: [PROFILE],
      resolveAccountEmail: (input) =>
        input.resource.accountRef === "mailbox-account-1"
          ? "member@example.net"
          : "",
    });

    const result = await source.read(request());
    expect(new TextDecoder().decode(result.bytes)).toBe("482193");
    expect(result.evidence).toEqual({
      matchedAt: NOW - 5_000,
      messageId: "gmail-message-1",
      parserId: PROFILE.id,
      provider: "gmail",
    });
    expect(lookupInput).toMatchObject({
      accountEmail: "member@example.net",
      profile: PROFILE,
    });
    expect(lookupInput?.notBefore.getTime()).toBe(NOW - 40_000);
    expect(lookupInput?.notAfter.getTime()).toBe(NOW + 5_000);
    expect(JSON.stringify(result.evidence)).not.toContain("482193");
  });

  test("rejects weaker modes, wrong secret kinds, and non-single-use requests before lookup", async () => {
    let lookups = 0;
    const source = createEmailVerificationCodeSource({
      lookup: {
        find: () => {
          lookups += 1;
          return Promise.resolve([message()]);
        },
      },
      now: () => NOW,
      profiles: [PROFILE],
      resolveAccountEmail: () => "member@example.net",
    });

    for (const invalid of [
      request({ processingMode: "model-visible" }),
      request({ secretKind: "password" }),
      request({ maximumUses: 2 as never }),
    ]) {
      await expect(source.read(invalid)).rejects.toMatchObject({
        code: "source_failed",
      });
    }
    expect(lookups).toBe(0);
  });

  test("requires one exact origin, provider, and operation profile", async () => {
    const source = createEmailVerificationCodeSource({
      lookup: { find: () => Promise.resolve([message()]) },
      now: () => NOW,
      profiles: [PROFILE, { ...PROFILE, id: "duplicate-profile" }],
      resolveAccountEmail: () => "member@example.net",
    });

    await expect(source.read(request())).rejects.toEqual(
      new AgentExchangeError("source_failed"),
    );
  });

  test("redacts mailbox, parser, and account resolver failures", async () => {
    const failures = [
      createEmailVerificationCodeSource({
        lookup: {
          find: () => {
            throw new Error("mail body contained 482193");
          },
        },
        now: () => NOW,
        profiles: [PROFILE],
        resolveAccountEmail: () => "member@example.net",
      }),
      createEmailVerificationCodeSource({
        lookup: {
          find: () => Promise.resolve([message(), message({ id: "2" })]),
        },
        now: () => NOW,
        profiles: [PROFILE],
        resolveAccountEmail: () => "member@example.net",
      }),
      createEmailVerificationCodeSource({
        lookup: { find: () => Promise.resolve([message()]) },
        now: () => NOW,
        profiles: [PROFILE],
        resolveAccountEmail: () => {
          throw new Error("directory contained 482193");
        },
      }),
    ];

    for (const source of failures) {
      try {
        await source.read(request());
        throw new Error("expected source failure");
      } catch (error) {
        expect(error).toEqual(new AgentExchangeError("source_failed"));
        expect(JSON.stringify(error)).not.toContain("482193");
        expect(String(error)).not.toContain("482193");
      }
    }
  });
});

test("declares only the tool-confined source capability", () => {
  expect(EMAIL_AGENT_EXCHANGE_SOURCE_MANIFEST).toEqual({
    assurance: "experimental",
    modelCanObserveSecret: false,
    packageName: "@absolutejs/agent-exchange-email",
    processingModes: ["tool-confined"],
    providers: ["gmail", "microsoft", "imap"],
    role: "source",
    secretKinds: ["email-one-time-code"],
  });
  expect(Object.keys(manifest.tools ?? {})).toHaveLength(0);
});

test("public source contracts use type aliases instead of interfaces", async () => {
  for (const file of ["index.ts", "source-manifest.ts"]) {
    const source = await Bun.file(
      new URL(`../src/${file}`, import.meta.url),
    ).text();
    expect(source).not.toMatch(/\binterface\s+[A-Za-z_$]/u);
  }
});
