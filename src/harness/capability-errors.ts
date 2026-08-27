export class CapabilityConnectionRequiredError extends Error {
  readonly provider: string;
  readonly toolkit: string;

  constructor(provider: string, toolkit: string) {
    super(`${provider} connection required for ${toolkit}`);
    this.name = "CapabilityConnectionRequiredError";
    this.provider = provider;
    this.toolkit = toolkit;
  }
}

export class CapabilityProviderError extends Error {
  readonly provider: string;
  readonly reason: string;

  constructor(provider: string, reason: string) {
    super(`${provider} capability unavailable: ${reason}`);
    this.name = "CapabilityProviderError";
    this.provider = provider;
    this.reason = reason;
  }
}

