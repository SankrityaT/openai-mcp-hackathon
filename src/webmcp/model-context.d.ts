/**
 * Ambient declarations for Chrome's WebMCP imperative API (`document.modelContext`).
 *
 * Verified against https://developer.chrome.com/docs/ai/webmcp/imperative-api:
 * - `registerTool(tool, { exposedTo })` where `exposedTo` is an array of exact origins.
 * - `getTools({ fromOrigins })` returns registered tool handles carrying
 *   `name`, `title`, `description`, `inputSchema`, `annotations`, `origin`, and `window`.
 *   Without `fromOrigins` it returns only same-origin tools.
 * - `executeTool(tool, input, { signal })` takes the input as a JSON **string** and resolves to
 *   the result string, or `null` when the tool's frame navigates.
 *
 * `navigator.modelContext` is the deprecated shape and is deliberately not declared.
 */

type CardeaWebMCPTool = {
  name: string;
  description: string;
  inputSchema: object;
  title?: string;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute(input: unknown, options?: { signal?: AbortSignal }): Promise<string | null> | string | null;
};

/** A handle returned by `getTools()`. Cross-origin handles carry the registering origin. */
type CardeaRegisteredWebMCPTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: object;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
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
    input: string,
    options?: { signal?: AbortSignal },
  ): Promise<string | null>;
}

interface Document {
  modelContext?: CardeaModelContext;
}
