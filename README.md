# trace-forge-mcp

MCP server for writing structured traces, spans, and decisions. The only write-path observability MCP — all 9 existing observability MCPs are read-only.

Built for EU AI Act traceability compliance (Article 14, due August 2026).

## Install

```bash
npx trace-forge-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "trace-forge": {
      "command": "npx",
      "args": ["trace-forge-mcp"]
    }
  }
}
```

### From source

```bash
git clone https://github.com/mdfifty50-boop/trace-forge-mcp.git
cd trace-forge-mcp
npm install
node src/index.js
```

## Tools

### trace_start

Begin a new trace for an agent task.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `agent_id` | string | yes | Unique agent identifier |
| `task_description` | string | yes | What the agent is doing |
| `metadata` | object | no | Optional metadata (model, department, priority) |

Returns: `{ trace_id, started_at }`

### trace_span

Create a span within a trace. Spans can be nested via `parent_span_id`.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `trace_id` | string | yes | Trace to attach to |
| `span_name` | string | yes | Span name (e.g. "research", "validation") |
| `parent_span_id` | string | no | Parent span for nesting |
| `metadata` | object | no | Optional span metadata |

Returns: `{ span_id, trace_id }`

### trace_tool_call

Log a tool call within a trace. Auto-calculates cost estimate from token count.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `trace_id` | string | yes | Trace this belongs to |
| `span_id` | string | no | Span this belongs to |
| `tool_name` | string | yes | Tool that was called |
| `args` | object | yes | Arguments passed |
| `result_preview` | string | yes | Result preview (max 500 chars) |
| `tokens_used` | number | no | Token count (enables cost estimation) |
| `duration_ms` | number | yes | Call duration in milliseconds |
| `status` | string | yes | `"success"`, `"error"`, or `"timeout"` |

Returns: `{ event_id, logged: true }`

### trace_decision

Log an agent decision point with reasoning and alternatives considered.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `trace_id` | string | yes | Trace this belongs to |
| `reasoning` | string | yes | Why the agent made this decision |
| `alternatives_considered` | string[] | yes | Other options evaluated |
| `chosen_action` | string | yes | What was decided |
| `confidence` | number | yes | Confidence 0.0 to 1.0 |

Returns: `{ event_id, logged: true }`

### trace_end

Complete a trace. Auto-calculates total duration, event counts, and span counts.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `trace_id` | string | yes | Trace to complete |
| `outcome` | string | yes | `"success"`, `"failure"`, `"partial"`, or `"timeout"` |
| `summary` | string | no | Optional summary |

Returns: `{ trace_id, duration_ms, events_count, spans_count, tool_calls_count }`

### get_trace

Retrieve a complete trace tree with all spans, events, tool calls, and decisions.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `trace_id` | string | yes | Trace ID to retrieve |

Returns: Full trace object with nested span tree, all events, and computed totals.

### search_traces

Find traces by agent ID and/or status.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `agent_id` | string | - | Filter by agent |
| `status` | string | - | Filter by status |
| `limit` | number | 20 | Max results (1-100) |

Returns: Matching traces sorted by recency with summary stats.

## Resources

| URI | Description |
|-----|-------------|
| `traces://recent` | Last 20 traces with summary |
| `traces://stats` | Aggregate statistics (total, avg duration, success rate) |

## Usage Pattern

```
1. trace_start — when agent begins a task
2. trace_span — create logical work units (research, generation, validation)
3. During execution:
   - trace_tool_call — after each tool invocation
   - trace_decision — at each decision point
4. trace_end — when task completes
5. get_trace — retrieve full audit trail
6. search_traces — find traces by agent or status
```

## EU AI Act Compliance

Article 14 of the EU AI Act requires high-risk AI systems to maintain traceability of decisions and actions. trace-forge-mcp provides:

- Structured decision logging with reasoning and alternatives
- Complete tool call audit trails with timing and cost
- Hierarchical span trees for complex multi-step tasks
- Agent identification and task attribution

## License

MIT
