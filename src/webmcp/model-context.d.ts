type CardeaWebMCPTool = {
  name: string;
  description: string;
  inputSchema: object;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute(input: unknown, options?: { signal?: AbortSignal }): Promise<string | null> | string | null;
};

type CardeaRegisteredWebMCPTool = CardeaWebMCPTool & {
  origin: string;
  window: Window;
};

interface CardeaModelContext extends EventTarget {
  registerTool(
    tool: CardeaWebMCPTool,
    options?: { exposedTo?: string[]; signal?: AbortSignal },
  ): Promise<void>;
  getTools(options?: { fromOrigins?: string[] }): Promise<CardeaRegisteredWebMCPTool[]>;
  executeTool(
    tool: CardeaRegisteredWebMCPTool,
    input: object | string,
    options?: { signal?: AbortSignal },
  ): Promise<string | null>;
}

interface Document {
  modelContext?: CardeaModelContext;
}
