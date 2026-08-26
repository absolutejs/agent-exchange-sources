# `@absolutejs/agent-exchange-email`

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
      id: "accounts-example-six-digit-v1",
      operations: ["verification.submit"],
      origins: ["https://accounts.example.com"],
      providers: ["gmail"],
      senderAddresses: ["security@example.com"],
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
- The mailbox account reference is resolved through a host-owned directory; it
  is never assumed to be an email address.
- The default lookup window begins 30 seconds before the Agency request and ends
  at the earlier of execution time plus five seconds or request expiry.
- Multiple messages, multiple marker-bound codes, untrusted senders, stale mail,
  wrong subjects, and lookup failures all become the same safe `source_failed`
  error.

Email OTPs remain bearer credentials and are not phishing-resistant. Prefer
OAuth, passkeys, service accounts, or provider-native delegated actions whenever
possible.
