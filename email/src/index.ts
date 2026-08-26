import {
  AgentExchangeError,
  type AgentExchangeRequest,
  type SensitiveValueSource,
} from "@absolutejs/agent-exchange";
import {
  retrieveEmailVerificationCode,
  type EmailVerificationMessageLookup,
  type EmailVerificationProfile,
} from "@absolutejs/email/verification";

const DEFAULT_CLOCK_SKEW_MS = 0;
const DEFAULT_LOOKBACK_MS = 30_000;
const MAX_CLOCK_SKEW_MS = 30_000;
const MAX_LOOKBACK_MS = 2 * 60_000;
const MAX_CHALLENGE_LENGTH = 256;

export type EmailAgentExchangeCorrelation =
  { readonly mode: "challenge-text" } | { readonly mode: "temporal-only" };

export type EmailAgentExchangeProfile = EmailVerificationProfile & {
  readonly correlation: EmailAgentExchangeCorrelation;
  readonly operations: readonly string[];
};

export type EmailAgentExchangeSourceOptions = {
  readonly allowTemporalOnlyCorrelation?: boolean;
  readonly clockSkewMs?: number;
  readonly lookup: EmailVerificationMessageLookup;
  readonly maxBodyBytes?: number;
  readonly maxCandidates?: number;
  readonly maxLookbackMs?: number;
  readonly now?: () => number;
  readonly profiles: readonly EmailAgentExchangeProfile[];
  readonly resolveAccountEmail: (
    request: AgentExchangeRequest,
  ) => Promise<string> | string;
};

const validBoundedInteger = (value: number, maximum: number) =>
  Number.isSafeInteger(value) && value >= 0 && value <= maximum;

const challengeText = (
  profile: EmailAgentExchangeProfile,
  request: AgentExchangeRequest,
  allowTemporalOnlyCorrelation: boolean,
) => {
  if (profile.correlation.mode === "temporal-only") {
    if (!allowTemporalOnlyCorrelation) {
      throw new AgentExchangeError("source_failed");
    }
    return [];
  }
  if (profile.correlation.mode !== "challenge-text") {
    throw new AgentExchangeError("source_failed");
  }
  const challenge = request.resource.challengeId;
  if (
    typeof challenge !== "string" ||
    challenge.length === 0 ||
    challenge.length > MAX_CHALLENGE_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(challenge)
  ) {
    throw new AgentExchangeError("source_failed");
  }
  return [challenge];
};

const selectProfile = (
  profiles: readonly EmailAgentExchangeProfile[],
  request: AgentExchangeRequest,
) => {
  const matches = profiles.filter(
    (profile) =>
      profile.origins.includes(request.resource.origin) &&
      profile.providers.includes(request.resource.provider) &&
      profile.operations.includes(request.resource.operation),
  );
  if (matches.length !== 1) throw new AgentExchangeError("source_failed");
  return matches[0]!;
};

const supportedAssurance = (request: AgentExchangeRequest): boolean =>
  (request.assurance.approval === "policy" &&
    request.assurance.credential === "bearer" &&
    request.assurance.execution === "purpose-bound") ||
  (request.assurance.approval === "webauthn-verifier-bound" &&
    request.assurance.credential === "token-confined-broker" &&
    request.assurance.execution === "purpose-bound") ||
  (request.assurance.approval === "standing-mandate" &&
    request.assurance.credential === "token-confined-broker" &&
    request.assurance.execution === "purpose-bound");

export const createEmailVerificationCodeSource = (
  options: EmailAgentExchangeSourceOptions,
): SensitiveValueSource => {
  const clockSkewMs = options.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;
  const maxLookbackMs = options.maxLookbackMs ?? DEFAULT_LOOKBACK_MS;
  if (
    !validBoundedInteger(clockSkewMs, MAX_CLOCK_SKEW_MS) ||
    !validBoundedInteger(maxLookbackMs, MAX_LOOKBACK_MS) ||
    !Array.isArray(options.profiles) ||
    options.profiles.length === 0
  ) {
    throw new AgentExchangeError("source_failed");
  }
  const now = options.now ?? Date.now;

  return Object.freeze({
    read: async (request) => {
      if (
        !supportedAssurance(request) ||
        request.processingMode !== "tool-confined" ||
        request.secretKind !== "email-one-time-code" ||
        request.maximumUses !== 1
      ) {
        throw new AgentExchangeError("source_failed");
      }

      try {
        const profile = selectProfile(options.profiles, request);
        const requiredBodyText = challengeText(
          profile,
          request,
          options.allowTemporalOnlyCorrelation === true,
        );
        const accountEmail = (
          await options.resolveAccountEmail(request)
        ).trim();
        if (accountEmail.length === 0) {
          throw new AgentExchangeError("source_failed");
        }
        const currentTime = now();
        if (
          !Number.isSafeInteger(currentTime) ||
          !Number.isSafeInteger(request.createdAt) ||
          !Number.isSafeInteger(request.expiresAt) ||
          request.expiresAt < request.createdAt
        ) {
          throw new AgentExchangeError("source_failed");
        }
        const notAfter = Math.min(request.expiresAt, currentTime + clockSkewMs);
        if (notAfter < request.createdAt - maxLookbackMs) {
          throw new AgentExchangeError("source_failed");
        }

        return await retrieveEmailVerificationCode(options.lookup, {
          accountEmail,
          expectedOrigin: request.resource.origin,
          ...(options.maxBodyBytes === undefined
            ? {}
            : { maxBodyBytes: options.maxBodyBytes }),
          ...(options.maxCandidates === undefined
            ? {}
            : { maxCandidates: options.maxCandidates }),
          notAfter: new Date(notAfter),
          notBefore: new Date(request.createdAt - maxLookbackMs),
          profile,
          requiredBodyText,
        });
      } catch {
        throw new AgentExchangeError("source_failed");
      }
    },
  });
};

export type {
  EmailVerificationMessageLookup,
  EmailVerificationProfile,
} from "@absolutejs/email/verification";
export { EMAIL_AGENT_EXCHANGE_SOURCE_MANIFEST } from "./source-manifest";
export type { AgentExchangeSourceManifest } from "./source-manifest";
