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
 * Two shapes exist in the wild and Cardea binds to whichever is present.
 * Chrome's shipped preview puts the entry point on `document` and passes
 * `{ signal }` as `execute`'s second argument. The W3C draft
 * (webmachinelearning.github.io/webmcp) puts it on `navigator` and passes an
 * agent handle there instead, carrying `requestUserInteraction` for
 * human-in-the-loop confirmation. The hackathon's own accepted environments
 * are the ChatGPT in-app browser and Chrome 149+, and nothing guarantees both
 * settled on the same shape, so binding to only one risks registering nothing
 * at all in the environment a judge actually uses.
 */

/**
 * The second argument `execute` receives. Chrome supplies `{ signal }`; the
 * W3C draft supplies an agent handle whose `requestUserInteraction(callback)`
 * pauses the tool call and resolves to whatever the callback returns, which is
 * the only mechanism either shape offers for enforcing a human decision rather
 * than merely instructing one. Optional throughout: a caller that supplies
 * neither is the common case today.
 */
type CardeaToolExecuteOptions = {
  signal?: AbortSignal;
  requestUserInteraction?<T>(callback: () => Promise<T> | T): Promise<T>;
};

type CardeaWebMCPTool = {
  name: string;
  description: string;
  inputSchema: object;
  title?: string;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute(input: unknown, options?: CardeaToolExecuteOptions): Promise<string | null> | string | null;
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

interface Navigator {
  modelContext?: CardeaModelContext;
}
