/**
 * Pear Intelligence Plugin Types
 * Subset of types needed for standalone plugin development.
 */

export interface Tool {
  name: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, unknown>
    required?: string[]
  }
}

export interface ToolResult {
  content: { type: string; text: string }[]
  isError: boolean
}

export interface PluginContext {
  pluginName: string
  getSetting<T = string | number | boolean>(key: string): T
  log: {
    info: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
  }
  sendClaudeMessage(msg: string): Promise<void>
  getDb(): unknown
}

export interface PluginToolDefinition {
  definition: Tool
  handler: (args: Record<string, unknown>) => Promise<ToolResult>
}

export interface PluginWebhook {
  path: string
  method: "GET" | "POST" | "PUT" | "DELETE"
  handler: (ctx: { body: unknown; query: Record<string, string>; headers: Record<string, string> }) => Promise<unknown>
}

export interface PluginScheduledTask {
  name: string
  intervalMs: number
  handler: () => Promise<void>
}

export interface PluginRegistrations {
  routes?: (ctx: PluginContext) => unknown
  tools?: PluginToolDefinition[]
  webhooks?: PluginWebhook[]
  scheduled?: PluginScheduledTask[]
}
