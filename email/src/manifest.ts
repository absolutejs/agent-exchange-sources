import { defineManifest } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";

export const manifest = defineManifest<Record<string, never>, never>()({
  contract: 2,
  discovery: {
    audiences: ["agent-hosts", "application-developers"],
    intents: [
      "retrieve an email verification code without exposing it to a model",
      "bind an email mailbox to Agent Exchange",
    ],
    keywords: [
      "agent exchange",
      "email",
      "verification code",
      "model blind",
      "tool confined",
    ],
    protocols: ["Gmail API", "Microsoft Graph", "IMAP4rev2"],
  },
  identity: {
    accent: "#0d9488",
    category: "security",
    description:
      "Deterministic email verification-code source for Agent Exchange. It binds exact Agency requests to strict Gmail, Microsoft Graph, or IMAP retrieval profiles and returns protected bytes only to the Agent Exchange encryption boundary.",
    docsUrl:
      "https://github.com/absolutejs/agent-exchange-sources/tree/main/email",
    name: "@absolutejs/agent-exchange-email",
    tagline: "Use an email code without showing it to either agent model.",
  },
  integration: {
    description:
      "Create a provider lookup with @absolutejs/email, then pass it and exact origin/sender/subject/body-marker profiles to createEmailVerificationCodeSource. Bind the returned source only to @absolutejs/agent-exchange.",
    mode: "code-first",
  },
  settings: Type.Object({}),
  tools: {},
  wiring: [],
});
