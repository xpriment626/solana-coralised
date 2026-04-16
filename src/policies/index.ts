export type ActionRisk =
  | "read"
  | "quote"
  | "sign"
  | "submit"
  | "payment"
  | "admin";

export interface PolicyCheckInput {
  actionName: string;
  risk: ActionRisk;
  params: unknown;
}

export interface PolicyDecision {
  approved: boolean;
  reason: string;
}

export async function evaluatePolicy(
  input: PolicyCheckInput
): Promise<PolicyDecision> {
  if (input.risk === "read" || input.risk === "quote") {
    return { approved: true, reason: "Read-only action allowed by scaffold policy." };
  }

  return {
    approved: false,
    reason: "Signing, submission, payment, and admin actions require policy middleware.",
  };
}
