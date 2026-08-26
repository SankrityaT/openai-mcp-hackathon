import type { JsonValue } from "../contracts/types";
import type { PolicyDecision, PolicyInput } from "../policy/engine";
import { evaluatePolicy, redactPolicyInput } from "../policy/engine";
import type {
  AppendMissionEventCommand,
  MissionRepository,
  RequestApprovalCommand,
} from "./mission-repository";

export type PolicyGateResult =
  | { decision: PolicyDecision; approvalId?: never }
  | { decision: PolicyDecision; approvalId: string };

export class MissionCoreService {
  constructor(private readonly repository: MissionRepository) {}

  async evaluateAndRecordPolicy(input: {
    tenantId: string;
    missionId: string;
    nodeId?: string;
    expectedSequence: number;
    policy: PolicyInput;
    correlationId: string;
    actorId: string;
    approval?: Omit<
      RequestApprovalCommand,
      "missionId" | "nodeId" | "expectedSequence" | "actor" | "correlationId"
    >;
  }): Promise<PolicyGateResult> {
    const policyDecision = evaluatePolicy(input.policy);

    if (policyDecision.effect === "deny") {
      const command: AppendMissionEventCommand = {
        missionId: input.missionId,
        nodeId: input.nodeId,
        expectedSequence: input.expectedSequence,
        type: "policy.denied",
        actor: { kind: "system", id: "policy-engine" },
        correlationId: input.correlationId,
        idempotencyKey: `policy:${input.policy.action.fingerprint}:${input.policy.mandate.version}`,
        trust: "derived",
        payload: {
          decision: policyDecision as unknown as JsonValue,
          input: redactPolicyInput(input.policy),
        },
      };
      await this.repository.appendEvent(command);
      return { decision: policyDecision };
    }

    if (policyDecision.effect === "require_approval") {
      if (!input.approval) {
        throw new Error("Approval metadata is required when policy requests approval");
      }
      const approval = await this.repository.requestApproval({
        ...input.approval,
        missionId: input.missionId,
        nodeId: input.nodeId,
        expectedSequence: input.expectedSequence,
        actor: { kind: "system", id: input.actorId },
        correlationId: input.correlationId,
      });
      return { decision: policyDecision, approvalId: approval.id };
    }

    return { decision: policyDecision };
  }
}
