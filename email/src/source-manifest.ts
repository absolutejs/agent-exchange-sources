export type AgentExchangeSourceManifest = {
  readonly assurance: "experimental";
  readonly correlationModes: readonly ["challenge-text", "temporal-only"];
  readonly modelCanObserveSecret: false;
  readonly packageName: `@absolutejs/agent-exchange-${string}`;
  readonly processingModes: readonly ["tool-confined"];
  readonly providers: readonly string[];
  readonly role: "source";
  readonly secretKinds: readonly string[];
  readonly senderAuthentication: "trusted-authserv-dmarc";
};

export const EMAIL_AGENT_EXCHANGE_SOURCE_MANIFEST = Object.freeze({
  assurance: "experimental",
  correlationModes: ["challenge-text", "temporal-only"],
  modelCanObserveSecret: false,
  packageName: "@absolutejs/agent-exchange-email",
  processingModes: ["tool-confined"],
  providers: ["gmail", "microsoft", "imap"],
  role: "source",
  secretKinds: ["email-one-time-code"],
  senderAuthentication: "trusted-authserv-dmarc",
} as const satisfies AgentExchangeSourceManifest);
