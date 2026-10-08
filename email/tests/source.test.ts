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
  correlation: { mode: "challenge-text" },
  id: "accounts-example-six-digit-v1",
  operations: ["verification.submit"],
  origins: ["https://accounts.example.com"],
  providers: ["gmail"],
  senderAddresses: ["security@example.com"],
  senderAuthentication: {
    allowedHeaderFromDomains: ["example.com"],
    trustedAuthservIds: ["mx.mailbox.example"],
  },
  subjectIncludesAny: ["sign in"],
};

const request = (
  overrides: Partial<AgentExchangeRequest> = {},
): AgentExchangeRequest => ({
  actionId: "act_source-test",
  assurance: {
    approval: "policy",
    credential: "bearer",
    execution: "purpose-bound",
  },
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
  authenticationResults: [
    "mx.mailbox.example; dmarc=pass header.from=example.com",
  ],
  bodyText: "Challenge challenge-1. Your verification code: 482193.",
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
    expect(result.evidence).toMatchObject({
      matchedAt: NOW - 5_000,
      messageId: "gmail-message-1",
      parserId: PROFILE.id,
      provider: "gmail",
    });
    expect(
      (result.evidence as { readonly senderAuthenticated?: unknown })
        .senderAuthenticated,
    ).toBe(true);
    expect(lookupInput).toMatchObject({
      accountEmail: "member@example.net",
      profile: PROFILE,
    });
    expect(lookupInput?.notBefore.getTime()).toBe(NOW - 40_000);
    expect(lookupInput?.notAfter.getTime()).toBe(NOW);
    expect(lookupInput?.requiredBodyText).toEqual(["challenge-1"]);
    expect(JSON.stringify(result.evidence)).not.toContain("482193");
  });

  test("accepts interactive and standing-mandate token-confined broker requests", async () => {
    const source = createEmailVerificationCodeSource({
      lookup: { find: () => Promise.resolve([message()]) },
      now: () => NOW,
      profiles: [PROFILE],
      resolveAccountEmail: () => "member@example.net",
    });
    const result = await source.read(
      request({
        assurance: {
          approval: "webauthn-verifier-bound",
          credential: "token-confined-broker",
          execution: "purpose-bound",
        },
      }),
    );
    expect(new TextDecoder().decode(result.bytes)).toBe("482193");

    const standingMandateResult = await source.read(
      request({
        assurance: {
          approval: "standing-mandate",
          credential: "token-confined-broker",
          execution: "purpose-bound",
        },
        mandateId: "mandate-email-code-1",
        requester: {
          agentId: "requester-agent",
          authority: "https://requester.example",
          delegationId: "delegation-email-code-1",
          subject: "requester-user",
        },
      }),
    );
    expect(new TextDecoder().decode(standingMandateResult.bytes)).toBe(
      "482193",
    );
  });

  test("requires challenge correlation by default and explicit opt-in for temporal-only mode", async () => {
    const challengeSource = createEmailVerificationCodeSource({
      lookup: { find: () => Promise.resolve([message()]) },
      now: () => NOW,
      profiles: [PROFILE],
      resolveAccountEmail: () => "member@example.net",
    });
    await expect(
      challengeSource.read(
        request({
          resource: {
            accountRef: "mailbox-account-1",
            operation: "verification.submit",
            origin: "https://accounts.example.com",
            provider: "gmail",
          },
        }),
      ),
    ).rejects.toEqual(new AgentExchangeError("source_failed"));

    const temporalProfile: EmailAgentExchangeProfile = {
      ...PROFILE,
      correlation: { mode: "temporal-only" },
    };
    const disabled = createEmailVerificationCodeSource({
      lookup: { find: () => Promise.resolve([message()]) },
      now: () => NOW,
      profiles: [temporalProfile],
      resolveAccountEmail: () => "member@example.net",
    });
    await expect(disabled.read(request())).rejects.toEqual(
      new AgentExchangeError("source_failed"),
    );

    const enabled = createEmailVerificationCodeSource({
      allowTemporalOnlyCorrelation: true,
      lookup: { find: () => Promise.resolve([message()]) },
      now: () => NOW,
      profiles: [temporalProfile],
      resolveAccountEmail: () => "member@example.net",
    });
    expect(
      new TextDecoder().decode((await enabled.read(request())).bytes),
    ).toBe("482193");
  });

  test("rejects dishonest assurance, weaker modes, wrong secret kinds, and non-single-use requests before lookup", async () => {
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
      request({
        assurance: {
          approval: "webauthn-verifier-bound",
          credential: "sender-constrained",
          execution: "purpose-bound",
        },
      }),
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
    correlationModes: ["challenge-text", "temporal-only"],
    modelCanObserveSecret: false,
    packageName: "@absolutejs/agent-exchange-email",
    processingModes: ["tool-confined"],
    providers: ["gmail", "microsoft", "imap"],
    role: "source",
    secretKinds: ["email-one-time-code"],
    senderAuthentication: "trusted-authserv-dmarc",
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

test("failure observer receives only a fixed category and cannot leak a thrown error", async () => {
  const failures: string[] = [];
  const source = createEmailVerificationCodeSource({
    lookup: {
      find: async () => {
        throw new Error("private provider response");
      },
    },
    now: () => NOW,
    profiles: [PROFILE],
    resolveAccountEmail: () => "member@example.net",
    onFailure: (failure) => {
      failures.push(failure);
      throw Error("private observer response");
    },
  });
  await expect(source.read(request())).rejects.toThrow(
    "Sensitive value retrieval failed.",
  );
  expect(failures).toEqual(["lookup_failed"]);
});

test("newest selection uses the latest authenticated code across a long lookback", async () => {
  const temporalProfile: EmailAgentExchangeProfile = {
    ...PROFILE,
    correlation: { mode: "temporal-only" },
  };
  const seen: EmailVerificationLookupInput[] = [];
  const messages = [
    message({
      bodyText: "Your verification code: 111111.",
      id: "older",
      occurredAt: new Date(NOW - 30 * 60_000),
    }),
    message({
      bodyText: "Your verification code: 222222.",
      id: "newer",
      occurredAt: new Date(NOW - 8 * 60_000),
    }),
  ];
  const lookup = {
    find: (input: EmailVerificationLookupInput) => {
      seen.push(input);
      return Promise.resolve(messages);
    },
  };
  const newest = createEmailVerificationCodeSource({
    allowTemporalOnlyCorrelation: true,
    lookup,
    maxLookbackMs: 60 * 60_000,
    now: () => NOW,
    profiles: [temporalProfile],
    resolveAccountEmail: () => "member@example.net",
    selection: "newest",
  });
  expect(new TextDecoder().decode((await newest.read(request())).bytes)).toBe(
    "222222",
  );
  expect(seen[0]?.selection).toBe("newest");

  // Unique selection keeps the two-minute cap and rejects several matches.
  expect(() =>
    createEmailVerificationCodeSource({
      allowTemporalOnlyCorrelation: true,
      lookup,
      maxLookbackMs: 60 * 60_000,
      profiles: [temporalProfile],
      resolveAccountEmail: () => "member@example.net",
    }),
  ).toThrow();
  const unique = createEmailVerificationCodeSource({
    allowTemporalOnlyCorrelation: true,
    lookup,
    maxLookbackMs: 2 * 60_000,
    now: () => NOW,
    profiles: [temporalProfile],
    resolveAccountEmail: () => "member@example.net",
  });
  await expect(unique.read(request())).rejects.toEqual(
    new AgentExchangeError("source_failed"),
  );
});

test("a full 24-hour newest lookback still fits the lookup window cap", async () => {
  const seen: EmailVerificationLookupInput[] = [];
  const source = createEmailVerificationCodeSource({
    allowTemporalOnlyCorrelation: true,
    lookup: {
      find: (input: EmailVerificationLookupInput) => {
        seen.push(input);
        return Promise.resolve([message()]);
      },
    },
    maxLookbackMs: 24 * 60 * 60_000,
    now: () => NOW,
    profiles: [{ ...PROFILE, correlation: { mode: "temporal-only" } }],
    resolveAccountEmail: () => "member@example.net",
    selection: "newest",
  });
  expect(new TextDecoder().decode((await source.read(request())).bytes)).toBe(
    "482193",
  );
  const window = seen[0]!.notAfter.getTime() - seen[0]!.notBefore.getTime();
  expect(window).toBe(24 * 60 * 60_000);
});
