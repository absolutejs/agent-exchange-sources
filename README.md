# AbsoluteJS Agent Exchange sources

Interchangeable deterministic source adapters for
[`@absolutejs/agent-exchange`](https://github.com/absolutejs/agent-exchange).

This repository follows the same layout as `voice-adapters` and
`e2ee-providers`: each directory is an independently versioned npm package that
implements one common Agent Exchange source API.

| Directory           | Package                            | Purpose                                                                                                                  |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [`email/`](./email) | `@absolutejs/agent-exchange-email` | Retrieve an exact, profile-bound email verification code through `@absolutejs/email` without exposing it to either model |

Planned adapters such as device approval, vault, or SMS belong here only when
they implement the same trusted `SensitiveValueSource` boundary. Provider API
mechanics remain in their domain packages; this repository owns the narrow
binding into Agent Exchange.

All packages remain `0.x`. Source adapters must fail closed, return mutable bytes
for immediate encryption, emit only non-secret evidence, and never register a
model-facing tool that returns the protected value.
