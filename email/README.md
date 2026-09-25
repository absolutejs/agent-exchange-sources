# `@absolutejs/agent-exchange-email`

> Email one-time codes are bearer credentials. This source accepts either the
> explicit `policy + bearer + purpose-bound` profile or
> `webauthn-verifier-bound + token-confined-broker + purpose-bound`. The latter
> confines provider credentials and OTP processing to a trusted broker but does
> not make the upstream bearer credential phishing-resistant.

The `0.5.x` line also accepts an exact, passkey-enrolled `standing-mandate`
with the same token-confined and purpose-bound requirements. The signed mandate
never broadens the host-owned mailbox profile.

An interchangeable, deterministic email source for
`@absolutejs/agent-exchange`. It uses `@absolutejs/email/verification` to locate
one exact verification message and returns the protected value directly to Agent
Exchange for encryption.

Gmail and Microsoft Graph lookups are browser-safe. IMAP is server-only and is
created from `@absolutejs/email/verification/imap` before being passed here.

```bash
bun add @absolutejs/agent-exchange @absolutejs/agent-exchange-email @absolutejs/email
```

```ts
import { createEmailVerificationCodeSource } from "@absolutejs/agent-exchange-email";
import { createGmailVerificationMessageLookup } from "@absolutejs/email/verification";

const source = createEmailVerificationCodeSource({
  lookup: createGmailVerificationMessageLookup({ accountEmail, client: gmail }),
  profiles: [
    {
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
    },
  ],
  resolveAccountEmail: (request) =>
    mailboxDirectory.get(request.resource.accountRef),
});
```

Pass `source` to `createAgentExchangeSender`. Do not register it as an MCP, A2A,
manifest, or general agent tool. The source deliberately returns no string API;
Agent Exchange encrypts its mutable byte result and clears it after delivery.

## Fail-closed rules

- Only `tool-confined`, single-use, `email-one-time-code` requests are accepted.
- The request's exact provider, HTTPS origin, and operation must select exactly
  one profile.
- `challenge-text` correlation is the default-safe profile mode: the request's
  `challengeId` must occur exactly in the selected message body.
- `temporal-only` profiles require both an explicit profile mode and
  `allowTemporalOnlyCorrelation: true`; use this weaker mode only when an
  upstream email cannot echo a challenge.
- The visible sender must have exactly one aligned DMARC pass from a configured,
  mailbox-trusted RFC 8601 `authserv-id`.
- The mailbox account reference is resolved through a host-owned directory; it
  is never assumed to be an email address.
- The default lookup window begins 30 seconds before the Agency request and ends
  at the earlier of execution time or request expiry. Future clock skew must be
  enabled explicitly.
- Multiple messages, multiple marker-bound codes, untrusted senders, stale mail,
  wrong subjects, and lookup failures all become the same safe `source_failed`
  error.

Email OTPs remain bearer credentials and are not phishing-resistant. Prefer
OAuth, passkeys, service accounts, or provider-native delegated actions whenever
possible.

This release uses Email 0.6.0 for explicit `standalone-after-marker` code layouts
and preserved HTML block boundaries. Existing immediate-marker profiles retain
their behavior. Temporal-only correlation still requires explicit opt-in and does
not prove a cryptographic binding between a provider email and a browser session;
callers must serialize attempts and bind the destination separately.

`selection: "newest"` (with `@absolutejs/email` 0.7) uses the most recent
sender-authenticated match instead of failing when several messages match, and
allows `maxLookbackMs` up to 24 hours. It is meant for `temporal-only` services
whose emails carry no per-request challenge, where the mailbox owner has chosen
"use the latest code". The default `unique` selection keeps the two-minute cap.

`createEmailVerificationCodeSource` accepts an optional `onFailure` observer.
It receives only a fixed category (`no_match`, `ambiguous_match`, `candidate_limit`,
`invalid_profile`, `lookup_failed`, or `source_rejected`). It never receives the
caught exception, code, message body, provider response, or source evidence.
Observer failures are ignored and retrieval continues to fail closed. Hosts may
record these categories for operational diagnosis without exposing secrets.
