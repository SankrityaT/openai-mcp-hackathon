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
    return [...this.capabilities.values()];
  }

  list() {
    return [...this.capabilities.values()];
  }

  async execute(request: CapabilityExecutionRequest): Promise<CapabilityExecutionResult> {
    const capability = this.capabilities.get(request.capabilityId);
    if (!capability) throw new Error("Capability is not discovered or enabled");
    const adapter = this.adapters.get(capability.provider);
    if (!adapter) throw new Error("Capability provider is unavailable");
    return adapter.execute(request);
  }
}
