/**
 * Cardea client data-mode seam.
 *
 * Selection is deliberately pure and dependency-free so the canvas, the WebMCP
 * tool surface, and any later realtime or companion client can agree on one
 * truthful description of whether the interface is reading persisted mission
 * state or a representative fixture. Nothing here may assume a product domain.
 */

export type CardeaDataMode = "fixture" | "live";

export const CARDEA_DATA_MODE_ENV_NAME = "NEXT_PUBLIC_CARDEA_DATA_MODE";

export type DataModeReason =
  | "fixture_configured"
  | "live_configured"
  | "live_session_pending"
  | "live_requires_sign_in"
  | "live_unavailable"
  | "invalid_configuration";

export type SessionProbe =
  | { status: "pending" }
  | { status: "authenticated"; userId: string }
  | { status: "anonymous" }
  | { status: "unavailable" };

export type DataModeState = {
  /** The mode the interface is actually operating in right now. */
  mode: CardeaDataMode;
  /** The mode requested by configuration, before session or server checks. */
  requestedMode: CardeaDataMode;
  reason: DataModeReason;
  /** Truthful, user-visible explanation when the active mode is not the requested mode. */
  notice: string | null;
  /** True only when writes reach the Cardea server and are durably recorded. */
  persistenceAvailable: boolean;
};

export type DataModeSetting = {
  requestedMode: CardeaDataMode;
  invalid: boolean;
};

/**
 * Reads the configured data mode. Unknown values never silently enable live
 * mode: they degrade to fixtures and report the misconfiguration.
 */
export function parseDataModeSetting(value: string | undefined | null): DataModeSetting {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "" || normalized === "fixture") {
    return { requestedMode: "fixture", invalid: false };
  }
  if (normalized === "live") {
    return { requestedMode: "live", invalid: false };
  }
  return { requestedMode: "fixture", invalid: true };
}

const FIXTURE_SUFFIX = "Showing representative fixture state; nothing is persisted.";

export function resolveDataMode(input: {
  configuredValue?: string | null;
  session: SessionProbe;
}): DataModeState {
  const setting = parseDataModeSetting(input.configuredValue);

  if (setting.invalid) {
    return {
      mode: "fixture",
      requestedMode: "fixture",
      reason: "invalid_configuration",
      notice: `${CARDEA_DATA_MODE_ENV_NAME} is set to an unrecognised value. ${FIXTURE_SUFFIX}`,
      persistenceAvailable: false,
    };
  }

  if (setting.requestedMode === "fixture") {
    return {
      mode: "fixture",
      requestedMode: "fixture",
      reason: "fixture_configured",
      notice: null,
      persistenceAvailable: false,
    };
  }

  switch (input.session.status) {
    case "authenticated":
      return {
        mode: "live",
        requestedMode: "live",
        reason: "live_configured",
        notice: null,
        persistenceAvailable: true,
      };
    case "pending":
      return {
        mode: "fixture",
        requestedMode: "live",
        reason: "live_session_pending",
        notice: `Checking your Cardea session. ${FIXTURE_SUFFIX}`,
        persistenceAvailable: false,
      };
    case "anonymous":
      return {
        mode: "fixture",
        requestedMode: "live",
        reason: "live_requires_sign_in",
        notice: `Live mode needs a signed-in Cardea session. ${FIXTURE_SUFFIX}`,
        persistenceAvailable: false,
      };
    case "unavailable":
    default:
      return {
        mode: "fixture",
        requestedMode: "live",
        reason: "live_unavailable",
        notice: `Live mode is configured but the Cardea server did not answer. ${FIXTURE_SUFFIX}`,
        persistenceAvailable: false,
      };
  }
}

/** Short label for compact UI surfaces and tool output. */
export function describeDataMode(state: DataModeState): string {
  return state.mode === "live" ? "Live · persisted" : "Fixture · not persisted";
}
