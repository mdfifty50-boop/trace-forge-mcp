/**
 * In-memory trace store with structured trace trees.
 * All data lives in Maps — no persistence layer, no dependencies.
 */

import { randomUUID } from 'node:crypto';

/** @type {Map<string, object>} trace_id -> trace object */
const traces = new Map();

/** @type {Map<string, object>} span_id -> span object */
const spans = new Map();

/** @type {Map<string, object[]>} trace_id -> events[] */
const events = new Map();

// ═══════════════════════════════════════════
// TRACE LIFECYCLE
// ═══════════════════════════════════════════

export function startTrace(agent_id, task_description, metadata = {}) {
  const trace_id = randomUUID();
  const started_at = new Date().toISOString();

  traces.set(trace_id, {
    trace_id,
    agent_id,
    task_description,
    metadata,
    status: 'active',
    started_at,
    ended_at: null,
    outcome: null,
    summary: null,
  });

  events.set(trace_id, []);

  return { trace_id, started_at };
}

export function endTrace(trace_id, outcome, summary = null) {
  const trace = traces.get(trace_id);
  if (!trace) {
    return { error: `Trace ${trace_id} not found` };
  }
  if (trace.status !== 'active') {
    return { error: `Trace ${trace_id} already ended with status "${trace.status}"` };
  }

  const ended_at = new Date().toISOString();
  const duration_ms = new Date(ended_at).getTime() - new Date(trace.started_at).getTime();

  const traceEvents = events.get(trace_id) || [];
  const traceSpans = [];
  for (const [, span] of spans) {
    if (span.trace_id === trace_id) traceSpans.push(span);
  }

  const tool_calls = traceEvents.filter(e => e.type === 'tool_call').length;

  trace.status = outcome;
  trace.ended_at = ended_at;
  trace.outcome = outcome;
  trace.summary = summary;

  return {
    trace_id,
    duration_ms,
    events_count: traceEvents.length,
    spans_count: traceSpans.length,
    tool_calls_count: tool_calls,
  };
}

// ═══════════════════════════════════════════
// SPANS
// ═══════════════════════════════════════════

export function createSpan(trace_id, span_name, parent_span_id = null, metadata = {}) {
  const trace = traces.get(trace_id);
  if (!trace) {
    return { error: `Trace ${trace_id} not found` };
  }

  const span_id = randomUUID();
  const created_at = new Date().toISOString();

  if (parent_span_id && !spans.has(parent_span_id)) {
    return { error: `Parent span ${parent_span_id} not found` };
  }

  spans.set(span_id, {
    span_id,
    trace_id,
    span_name,
    parent_span_id,
    metadata,
    created_at,
  });

  return { span_id, trace_id };
}

// ═══════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════

export function logToolCall(trace_id, span_id, tool_name, args, result_preview, tokens_used, duration_ms, status) {
  const trace = traces.get(trace_id);
  if (!trace) {
    return { error: `Trace ${trace_id} not found` };
  }
  if (span_id && !spans.has(span_id)) {
    return { error: `Span ${span_id} not found` };
  }

  const event_id = randomUUID();
  const logged_at = new Date().toISOString();

  // Rough cost estimate: $3/1M input tokens for sonnet-class
  let estimated_cost = null;
  if (tokens_used) {
    estimated_cost = parseFloat((tokens_used * 0.000003).toFixed(6));
  }

  const event = {
    event_id,
    type: 'tool_call',
    trace_id,
    span_id: span_id || null,
    tool_name,
    args,
    result_preview: (result_preview || '').slice(0, 500),
    tokens_used: tokens_used || null,
    estimated_cost,
    duration_ms,
    status,
    logged_at,
  };

  const traceEvents = events.get(trace_id);
  if (traceEvents) traceEvents.push(event);

  return { event_id, logged: true };
}

export function logDecision(trace_id, reasoning, alternatives_considered, chosen_action, confidence) {
  const trace = traces.get(trace_id);
  if (!trace) {
    return { error: `Trace ${trace_id} not found` };
  }

  const event_id = randomUUID();
  const logged_at = new Date().toISOString();

  const event = {
    event_id,
    type: 'decision',
    trace_id,
    reasoning,
    alternatives_considered,
    chosen_action,
    confidence,
    logged_at,
  };

  const traceEvents = events.get(trace_id);
  if (traceEvents) traceEvents.push(event);

  return { event_id, logged: true };
}

// ═══════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════

export function getTrace(trace_id) {
  const trace = traces.get(trace_id);
  if (!trace) {
    return { error: `Trace ${trace_id} not found` };
  }

  // Collect spans for this trace
  const traceSpans = [];
  for (const [, span] of spans) {
    if (span.trace_id === trace_id) traceSpans.push(span);
  }

  // Build span tree
  const spanTree = buildSpanTree(traceSpans);

  // Collect events
  const traceEvents = events.get(trace_id) || [];
  const tool_calls = traceEvents.filter(e => e.type === 'tool_call');
  const decisions = traceEvents.filter(e => e.type === 'decision');

  // Calculate totals
  const total_duration_ms = trace.ended_at
    ? new Date(trace.ended_at).getTime() - new Date(trace.started_at).getTime()
    : new Date().getTime() - new Date(trace.started_at).getTime();

  const total_tokens = tool_calls.reduce((sum, e) => sum + (e.tokens_used || 0), 0);
  const total_cost = tool_calls.reduce((sum, e) => sum + (e.estimated_cost || 0), 0);

  return {
    ...trace,
    total_duration_ms,
    total_events: traceEvents.length,
    total_spans: traceSpans.length,
    total_tool_calls: tool_calls.length,
    total_decisions: decisions.length,
    total_tokens,
    total_estimated_cost: parseFloat(total_cost.toFixed(6)),
    spans: spanTree,
    events: traceEvents,
  };
}

export function searchTraces(agent_id = null, status = null, limit = 20) {
  let results = [...traces.values()];

  if (agent_id) {
    results = results.filter(t => t.agent_id === agent_id);
  }
  if (status) {
    results = results.filter(t => t.status === status);
  }

  // Sort by recency (most recent first)
  results.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

  // Apply limit
  results = results.slice(0, limit);

  return results.map(t => {
    const traceEvents = events.get(t.trace_id) || [];
    const traceSpans = [];
    for (const [, span] of spans) {
      if (span.trace_id === t.trace_id) traceSpans.push(span);
    }

    const duration_ms = t.ended_at
      ? new Date(t.ended_at).getTime() - new Date(t.started_at).getTime()
      : new Date().getTime() - new Date(t.started_at).getTime();

    return {
      trace_id: t.trace_id,
      agent_id: t.agent_id,
      task_description: t.task_description,
      status: t.status,
      outcome: t.outcome,
      started_at: t.started_at,
      ended_at: t.ended_at,
      duration_ms,
      events_count: traceEvents.length,
      spans_count: traceSpans.length,
    };
  });
}

// ═══════════════════════════════════════════
// RESOURCES
// ═══════════════════════════════════════════

export function getRecentTraces() {
  return searchTraces(null, null, 20);
}

export function getStats() {
  const allTraces = [...traces.values()];
  const total = allTraces.length;
  const active = allTraces.filter(t => t.status === 'active').length;
  const completed = allTraces.filter(t => t.status !== 'active').length;
  const successful = allTraces.filter(t => t.outcome === 'success').length;
  const failed = allTraces.filter(t => t.outcome === 'failure').length;

  const completedTraces = allTraces.filter(t => t.ended_at);
  const durations = completedTraces.map(t =>
    new Date(t.ended_at).getTime() - new Date(t.started_at).getTime()
  );
  const avg_duration_ms = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  let total_events_count = 0;
  let total_tool_calls_count = 0;
  let total_decisions_count = 0;
  let total_tokens = 0;

  for (const [, evts] of events) {
    total_events_count += evts.length;
    for (const e of evts) {
      if (e.type === 'tool_call') {
        total_tool_calls_count++;
        total_tokens += e.tokens_used || 0;
      }
      if (e.type === 'decision') total_decisions_count++;
    }
  }

  const success_rate = completed > 0 ? parseFloat((successful / completed).toFixed(3)) : 0;

  return {
    total_traces: total,
    active_traces: active,
    completed_traces: completed,
    successful_traces: successful,
    failed_traces: failed,
    success_rate,
    avg_duration_ms,
    total_spans: spans.size,
    total_events: total_events_count,
    total_tool_calls: total_tool_calls_count,
    total_decisions: total_decisions_count,
    total_tokens,
    generated_at: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

function buildSpanTree(spanList) {
  const byId = new Map();
  for (const s of spanList) byId.set(s.span_id, { ...s, children: [] });

  const roots = [];
  for (const [, node] of byId) {
    if (node.parent_span_id && byId.has(node.parent_span_id)) {
      byId.get(node.parent_span_id).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
