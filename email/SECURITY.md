# Security policy

Report suspected vulnerabilities privately through GitHub Security Advisories on
`absolutejs/agent-exchange-sources`. Do not include live verification codes,
mailbox credentials, message bodies, access tokens, or private keys in reports.

This `0.x` package is security-sensitive and unaudited. It narrows and validates
mailbox results but cannot make email codes phishing-resistant. Prefer delegated
OAuth, passkeys, or provider-native actions when available.
