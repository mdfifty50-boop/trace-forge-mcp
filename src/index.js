#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  startTrace,
  endTrace,
  createSpan,
  logToolCall,
  logDecision,
  getTrace,
  searchTraces,
  getRecentTraces,
  getStats,
} from './store.js';

const server = new McpServer({
  name: 'trace-forge-mcp',
  version: '0.1.0',
  description: 'Write-path observability MCP — structured traces, spans, tool calls, and decision logs for EU AI Act traceability',
});

// ═══════════════════════════════════════════
// TOOL: trace_start
// ═══════════════════════════════════════════

server.tool(
  'trace_start',
  'Begin a new trace for an agent task. Returns a trace_id used to attach spans, tool calls, and decisions.',
  {
    agent_id: z.string().describe('Unique identifier for the agent starting the trace'),
    task_description: z.string().describe('Human-readable description of what the agent is doing'),
    metadata: z.record(z.any()).optional().describe('Optional metadata (model, department, priority, etc.)'),
  },
  async ({ agent_id, task_description, metadata }) => {
    const result = startTrace(agent_id, task_description, metadata || {});
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════
// TOOL: trace_span
// ═══════════════════════════════════════════

server.tool(
  'trace_span',
  'Create a span within a trace. Spans represent logical units of work and can be nested via parent_span_id.',
  {
    trace_id: z.string().describe('Trace to attach this span to'),
    span_name: z.string().describe('Name of this span (e.g. "research", "code_generation", "validation")'),
    parent_span_id: z.string().optional().describe('Parent span ID for nesting (creates a tree)'),
    metadata: z.record(z.any()).optional().describe('Optional span metadata'),
  },
  async ({ trace_id, span_name, parent_span_id, metadata }) => {
    const result = createSpan(trace_id, span_name, parent_span_id || null, metadata || {});
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════
// TOOL: trace_tool_call
// ═══════════════════════════════════════════

server.tool(
  'trace_tool_call',
  'Log a tool call within a trace. Records tool name, arguments, result, duration, and token usage. Auto-calculates cost estimate.',
  {
    trace_id: z.string().describe('Trace this tool call belongs to'),
    span_id: z.string().optional().describe('Span this tool call belongs to (optional)'),
    tool_name: z.string().describe('Name of the tool that was called'),
    args: z.record(z.any()).describe('Arguments passed to the tool'),
    result_preview: z.string().max(500).describe('Brief preview of the result (max 500 chars)'),
    tokens_used: z.number().int().optional().describe('Token count for this call (optional, enables cost estimation)'),
    duration_ms: z.number().describe('How long the tool call took in milliseconds'),
    status: z.enum(['success', 'error', 'timeout']).describe('Outcome of the tool call'),
  },
  async ({ trace_id, span_id, tool_name, args, result_preview, tokens_used, duration_ms, status }) => {
    const result = logToolCall(trace_id, span_id || null, tool_name, args, result_preview, tokens_used || null, duration_ms, status);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════
// TOOL: trace_decision
// ═══════════════════════════════════════════

server.tool(
  'trace_decision',
  'Log an agent decision point — what it considered, what it chose, and why. Critical for EU AI Act explainability.',
  {
    trace_id: z.string().describe('Trace this decision belongs to'),
    reasoning: z.string().describe('Why the agent made this decision'),
    alternatives_considered: z.array(z.string()).describe('Other options the agent evaluated'),
    chosen_action: z.string().describe('What the agent decided to do'),
    confidence: z.number().min(0).max(1).describe('Agent confidence in this decision (0.0 to 1.0)'),
  },
  async ({ trace_id, reasoning, alternatives_considered, chosen_action, confidence }) => {
    const result = logDecision(trace_id, reasoning, alternatives_considered, chosen_action, confidence);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════
// TOOL: trace_end
// ═══════════════════════════════════════════

server.tool(
  'trace_end',
  'Complete a trace. Auto-calculates total duration, event counts, and span counts.',
  {
    trace_id: z.string().describe('Trace to complete'),
    outcome: z.enum(['success', 'failure', 'partial', 'timeout']).describe('Final outcome of the traced task'),
    summary: z.string().optional().describe('Optional summary of what happened'),
  },
  async ({ trace_id, outcome, summary }) => {
    const result = endTrace(trace_id, outcome, summary || null);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════
// TOOL: get_trace
// ═══════════════════════════════════════════

server.tool(
  'get_trace',
  'Retrieve a complete trace tree with all spans, events, tool calls, and decisions.',
  {
    trace_id: z.string().describe('Trace ID to retrieve'),
  },
  async ({ trace_id }) => {
    const result = getTrace(trace_id);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════
// TOOL: search_traces
// ═══════════════════════════════════════════

server.tool(
  'search_traces',
  'Find traces by agent ID and/or status. Returns matching traces sorted by recency with summary stats.',
  {
    agent_id: z.string().optional().describe('Filter by agent ID'),
    status: z.string().optional().describe('Filter by status (active, success, failure, partial, timeout)'),
    limit: z.number().int().min(1).max(100).default(20).describe('Max results to return (default 20)'),
  },
  async ({ agent_id, status, limit }) => {
    const results = searchTraces(agent_id || null, status || null, limit);
    return {
      content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
    };
  }
);

// ═══════════════════════════════════════════
// RESOURCES
// ═══════════════════════════════════════════

server.resource(
  'recent-traces',
  'traces://recent',
  async () => ({
    contents: [{
      uri: 'traces://recent',
      mimeType: 'application/json',
      text: JSON.stringify(getRecentTraces(), null, 2),
    }],
  })
);

server.resource(
  'trace-stats',
  'traces://stats',
  async () => ({
    contents: [{
      uri: 'traces://stats',
      mimeType: 'application/json',
      text: JSON.stringify(getStats(), null, 2),
    }],
  })
);

// ═══════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Trace Forge MCP Server running on stdio');
}

main().catch(console.error);
