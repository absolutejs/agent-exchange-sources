import { expect, test } from "bun:test";
import {
  createAgentExchangeReceiver,
  createAgentExchangeSender,
  createMemoryAgentExchangeReplayStore,
  createMemoryAgentExchangeStore,
  type SensitiveValue,
} from "@absolutejs/agent-exchange";
import {
  createAgency,
  createMemoryAgencyStore,
  type PolicyDecisionPoint,
} from "@absolutejs/agency";
import {
  createWebCryptoEnvelopeProvider,
  generateWebCryptoRecipientKeyPair,
} from "@absolutejs/e2ee-webcrypto";
import { createEmailVerificationCodeSource } from "../src";

test("email source completes a real Agency and E2EE exchange without receipt leakage", async () => {
  const policy: PolicyDecisionPoint = {
    evaluate: ({ approval, now }) =>
      approval === undefined
        ? {
            decisionId: crypto.randomUUID(),
            evaluatedAt: now,
            kind: "deny",
            prerequisites: [],
            reason: "approval required",
            requestable: true,
          }
        : {
            decisionId: crypto.randomUUID(),
            evaluatedAt: now,
            kind: "allow",
          },
  };
  const agency = createAgency({ policy, store: createMemoryAgencyStore() });
  const keys = await generateWebCryptoRecipientKeyPair();
  const e2ee = createWebCryptoEnvelopeProvider({
    resolveRecipientPrivateKey: async (handle) =>
      handle === "recipient-key" ? keys.keyMaterial : undefined,
  });
  const submitted: string[] = [];
  const receiver = createAgentExchangeReceiver({
    consent: {
      assertAllows: (request) => ({
        consentId: "paired-users",
        expiresAt: request.expiresAt,
      }),
    },
    e2ee,
    replay: createMemoryAgentExchangeReplayStore(),
    sink: {
      submit: ({ plaintext }) => {
        submitted.push(new TextDecoder().decode(plaintext));
        return { reference: "verification-form", status: "submitted" };
      },
    },
  });
  const emailSource = createEmailVerificationCodeSource({
    lookup: {
      find: (input) =>
        Promise.resolve([
          {
            accountEmail: input.accountEmail,
            bodyText: "Your verification code is 482193.",
            direction: "inbound",
            from: { address: "security@example.com" },
            id: "gmail-message-1",
            occurredAt: new Date(),
            provider: "gmail",
            subject: "Sign in to Example",
            to: [{ address: input.accountEmail }],
          },
        ]),
    },
    profiles: [
      {
        bodyMarkers: ["verification code"],
        id: "accounts-example-six-digit-v1",
        operations: ["verification.submit"],
        origins: ["https://accounts.example.com"],
        providers: ["gmail"],
        senderAddresses: ["security@example.com"],
        subjectIncludesAny: ["sign in"],
      },
    ],
    resolveAccountEmail: () => "member@example.net",
  });
  let sourceBytes: Uint8Array | undefined;
  const sender = createAgentExchangeSender({
    agency,
    e2ee,
    keyDirectory: {
      resolve: () => ({ keyId: "recipient-key", publicKey: keys.publicKey }),
    },
    source: {
      read: async (request): Promise<SensitiveValue> => {
        const value = await emailSource.read(request);
        sourceBytes = value.bytes;
        return value;
      },
    },
    store: createMemoryAgentExchangeStore(),
    transport: { deliver: (delivery) => receiver.receive(delivery) },
  });
  const requested = await sender.request({
    expiresAt: Date.now() + 60_000,
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
  });
  await agency.approve({
    actionId: requested.exchange.actionId,
    approvedBy: "requester-user",
    approvedUntil: requested.exchange.expiresAt,
  });
  const lease = await sender.issueLease(requested.exchange.exchangeId);
  const completed = await sender.execute({
    exchangeId: requested.exchange.exchangeId,
    leaseId: lease.leaseId,
  });

  expect(submitted).toEqual(["482193"]);
  expect(sourceBytes).toEqual(new Uint8Array(6));
  expect(completed.receipt).toMatchObject({
    modelObservedSecret: false,
    processingMode: "tool-confined",
    status: "submitted",
  });
  expect(JSON.stringify(completed)).not.toContain("482193");
  expect(JSON.stringify(await agency.inspect())).not.toContain("482193");
});
