export type AgentExchangeSourceManifest = {
  readonly assurance: "experimental";
  readonly modelCanObserveSecret: false;
  readonly packageName: `@absolutejs/agent-exchange-${string}`;
  readonly processingModes: readonly ["tool-confined"];
  readonly providers: readonly string[];
  readonly role: "source";
  readonly secretKinds: readonly string[];
};

export const EMAIL_AGENT_EXCHANGE_SOURCE_MANIFEST = Object.freeze({
  assurance: "experimental",
  modelCanObserveSecret: false,
  packageName: "@absolutejs/agent-exchange-email",
  processingModes: ["tool-confined"],
  providers: ["gmail", "microsoft", "imap"],
  role: "source",
  secretKinds: ["email-one-time-code"],
} as const satisfies AgentExchangeSourceManifest);
