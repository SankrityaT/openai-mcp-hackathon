import "server-only";

import type { JsonValue, MissionEvent, MissionSnapshot } from "../contracts/types";

export type DatabaseCallResult<T> =
  | { data: T; error: null }
  | { data: null; error: { code?: string; message: string; details?: string } };

/**
 * Narrow server-only port implemented later by the authorized Supabase SSR client.
 * No provider SDK or service-role credential crosses this boundary.
 */
export interface ServerDatabasePort {
  getMissionSnapshot(input: {
    tenantId: string;
    missionId: string;
    actorUserId: string;
  }): Promise<DatabaseCallResult<MissionSnapshot>>;
  listMissionEvents(input: {
    tenantId: string;
    missionId: string;
    actorUserId: string;
    afterSequence: number;
  }): Promise<DatabaseCallResult<MissionEvent[]>>;
  rpc<TResult>(
    functionName:
      | "ensure_user_tenant"
      | "create_mission"
      | "append_mission_event"
      | "request_mission_approval"
      | "resolve_mission_approval"
      | "create_mission_checkpoint"
      | "revert_mission_to_checkpoint"
      | "reserve_idempotency"
      | "complete_idempotency"
      | "consume_usage"
      | "reserve_guest_mission"
      | "reserve_judge_run"
      | "record_security_event",
    args: Record<string, JsonValue | undefined>,
  ): Promise<DatabaseCallResult<TResult>>;
}

export class RedactedDatabaseError extends Error {
  readonly code: string;

  constructor(code = "database_error") {
    super("The requested database operation could not be completed.");
    this.name = "RedactedDatabaseError";
    this.code = code;
  }
}

export function unwrapDatabaseResult<T>(result: DatabaseCallResult<T>): T {
  if (result.error) {
    throw new RedactedDatabaseError(result.error.code);
  }
  return result.data;
}
