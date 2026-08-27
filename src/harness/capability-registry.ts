import { withSpan } from "../core/observability";
import type {
  CapabilityAdapter,
  CapabilityExecutionRequest,
  CapabilityExecutionResult,
  NormalizedCapability,
} from "./contracts";

export class CapabilityRegistry {
  private readonly adapters = new Map<string, CapabilityAdapter>();
  private readonly capabilities = new Map<string, NormalizedCapability>();

  register(adapter: CapabilityAdapter) {
    if (this.adapters.has(adapter.provider)) {
      throw new Error(`Capability adapter already registered: ${adapter.provider}`);
    }
    this.adapters.set(adapter.provider, adapter);
  }

  async discover(): Promise<NormalizedCapability[]> {
    // Capability discovery span at the registry boundary (never inside an
    // adapter). Records only the resolved capability count — no capability
    // descriptions, provider tokens, or discovered payloads.
    return withSpan("harness.capability.discover", {}, async (span) => {
      const discovered = (await Promise.all(
        [...this.adapters.values()].map((adapter) => adapter.discover()),
      )).flat();
      this.capabilities.clear();
      for (const capability of discovered) {
        if (this.capabilities.has(capability.id)) {
          throw new Error(`Duplicate capability id: ${capability.id}`);
        }
        if (!this.adapters.has(capability.provider)) {
          throw new Error(`Unknown capability provider: ${capability.provider}`);
        }
        this.capabilities.set(capability.id, capability);
      }
      span.set({ capabilityCount: this.capabilities.size });
      return [...this.capabilities.values()];
    });
  }

  list() {
    return [...this.capabilities.values()];
  }

  async execute(request: CapabilityExecutionRequest): Promise<CapabilityExecutionResult> {
    const capability = this.capabilities.get(request.capabilityId);
    if (!capability) throw new Error("Capability is not discovered or enabled");
    const adapter = this.adapters.get(capability.provider);
    if (!adapter) throw new Error("Capability provider is unavailable");
    // Capability execution span at the registry boundary. Retries in
    // execute-node call this again per attempt, so each attempt is one span
    // (status ok/error) sharing the correlation id — the retry count is the
    // number of error spans preceding a terminal one. Only the provider and
    // capability id are recorded, never the request input or tool output.
    return withSpan(
      "harness.capability.execute",
      { provider: capability.provider, capabilityId: capability.id },
      async (span) => {
        const result = await adapter.execute(request);
        span.set({ resultStatus: "succeeded" });
        return result;
      },
      { correlationId: request.correlationId },
    );
  }
}
