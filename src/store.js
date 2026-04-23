/**
 * SQLite-backed trace store.
 * All function signatures are identical to the original in-memory version —
 * drop-in replacement; no changes required in index.js or tests.
 */

import { randomUUID } from 'node:crypto';
import db from './db.js';

// ═══════════════════════════════════════════
// TRACE LIFECYCLE
// ═══════════════════════════════════════════

export function startTrace(agent_id, task_description, metadata = {}) {
  const trace_id = randomUUID();
  const started_at = new Date().toISOString();

  db.prepare(`
    INSERT INTO traces (trace_id, agent_id, task_description, status, started_at, metadata_json)
    VALUES (?, ?, ?, 'active', ?, ?)
  `).run(trace_id, agent_id, task_description, started_at, JSON.stringify(metadata));

  return { trace_id, started_at };
}

export function endTrace(trace_id, outcome, summary = null) {
  const trace = db.prepare('SELECT * FROM traces WHERE trace_id = ?').get(trace_id);
  if (!trace) {
    return { error: `Trace ${trace_id} not found` };
  }
  if (trace.status !== 'active') {
    return { error: `Trace ${trace_id} already ended with status "${trace.status}"` };
  }

  const ended_at = new Date().toISOString();
  const duration_ms = new Date(ended_at).getTime() - new Date(trace.started_at).getTime();

  db.prepare(`
    UPDATE traces SET status = ?, ended_at = ?, outcome = ?, summary = ? WHERE trace_id = ?
  `).run(outcome, ended_at, outcome, summary, trace_id);

  const spans_count = db.prepare('SELECT COUNT(*) as c FROM spans WHERE trace_id = ?').get(trace_id).c;
  const tool_calls_count = db.prepare('SELECT COUNT(*) as c FROM tool_calls WHERE trace_id = ?').get(trace_id).c;
  const decisions_count = db.prepare('SELECT COUNT(*) as c FROM decisions WHERE trace_id = ?').get(trace_id).c;
  const events_count = tool_calls_count + decisions_count;

  return {
    trace_id,
    duration_ms,
    events_count,
    spans_count,
    tool_calls_count,
  };
}

// ═══════════════════════════════════════════
// SPANS
// ═══════════════════════════════════════════

export function createSpan(trace_id, span_name, parent_span_id = null, metadata = {}) {
  const trace = db.prepare('SELECT trace_id FROM traces WHERE trace_id = ?').get(trace_id);
  if (!trace) {
    return { error: `Trace ${trace_id} not found` };
  }

  if (parent_span_id) {
    const parent = db.prepare('SELECT span_id FROM spans WHERE span_id = ?').get(parent_span_id);
    if (!parent) {
      return { error: `Parent span ${parent_span_id} not found` };
    }
  }

  const span_id = randomUUID();
  const started_at = new Date().toISOString();

  db.prepare(`
    INSERT INTO spans (span_id, trace_id, parent_span_id, span_name, status, started_at, metadata_json)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).run(span_id, trace_id, parent_span_id || null, span_name, started_at, JSON.stringify(metadata));

  return { span_id, trace_id };
}

// ═══════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════

export function logToolCall(trace_id, span_id, tool_name, args, result_preview, tokens_used, duration_ms, status) {
  const trace = db.prepare('SELECT trace_id FROM traces WHERE trace_id = ?').get(trace_id);
  if (!trace) {
    return { error: `Trace ${trace_id} not found` };
  }
  if (span_id) {
    const span = db.prepare('SELECT span_id FROM spans WHERE span_id = ?').get(span_id);
    if (!span) {
      return { error: `Span ${span_id} not found` };
    }
  }

  const event_id = randomUUID();
  const timestamp = new Date().toISOString();
  const preview = (result_preview || '').slice(0, 500);

  db.prepare(`
    INSERT INTO tool_calls (trace_id, span_id, tool_name, args_json, result_preview, tokens_used, duration_ms, status, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    trace_id,
    span_id || null,
    tool_name,
    JSON.stringify(args || {}),
    preview,
    tokens_used || null,
    duration_ms,
    status,
    timestamp
  );

  return { event_id, logged: true };
}

export function logDecision(trace_id, reasoning, alternatives_considered, chosen_action, confidence) {
  const trace = db.prepare('SELECT trace_id FROM traces WHERE trace_id = ?').get(trace_id);
  if (!trace) {
    return { error: `Trace ${trace_id} not found` };
  }

  const event_id = randomUUID();
  const timestamp = new Date().toISOString();

  db.prepare(`
    INSERT INTO decisions (trace_id, span_id, decision, rationale, alternatives_json, confidence, timestamp)
    VALUES (?, NULL, ?, ?, ?, ?, ?)
  `).run(
    trace_id,
    chosen_action,
    reasoning,
    JSON.stringify(alternatives_considered || []),
    confidence,
    timestamp
  );

  return { event_id, logged: true };
}

// ═══════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════

export function getTrace(trace_id) {
  const trace = db.prepare('SELECT * FROM traces WHERE trace_id = ?').get(trace_id);
  if (!trace) {
    return { error: `Trace ${trace_id} not found` };
  }

  const metadata = JSON.parse(trace.metadata_json || '{}');

  // Collect spans
  const spanRows = db.prepare('SELECT * FROM spans WHERE trace_id = ?').all(trace_id);
  const traceSpans = spanRows.map(s => ({
    span_id: s.span_id,
    trace_id: s.trace_id,
    span_name: s.span_name,
    parent_span_id: s.parent_span_id,
    metadata: JSON.parse(s.metadata_json || '{}'),
    created_at: s.started_at,
  }));

  const spanTree = buildSpanTree(traceSpans);

  // Collect tool calls
  const toolCallRows = db.prepare('SELECT * FROM tool_calls WHERE trace_id = ? ORDER BY id').all(trace_id);
  const tool_calls = toolCallRows.map(r => ({
    event_id: randomUUID(),
    type: 'tool_call',
    trace_id: r.trace_id,
    span_id: r.span_id,
    tool_name: r.tool_name,
    args: JSON.parse(r.args_json || '{}'),
    result_preview: r.result_preview,
    tokens_used: r.tokens_used,
    estimated_cost: r.tokens_used ? parseFloat((r.tokens_used * 0.000003).toFixed(6)) : null,
    duration_ms: r.duration_ms,
    status: r.status,
    logged_at: r.timestamp,
  }));

  // Collect decisions
  const decisionRows = db.prepare('SELECT * FROM decisions WHERE trace_id = ? ORDER BY id').all(trace_id);
  const decisions = decisionRows.map(r => ({
    event_id: randomUUID(),
    type: 'decision',
    trace_id: r.trace_id,
    reasoning: r.rationale,
    alternatives_considered: JSON.parse(r.alternatives_json || '[]'),
    chosen_action: r.decision,
    confidence: r.confidence,
    logged_at: r.timestamp,
  }));

  const allEvents = [...tool_calls, ...decisions].sort((a, b) =>
    new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime()
  );

  const total_duration_ms = trace.ended_at
    ? new Date(trace.ended_at).getTime() - new Date(trace.started_at).getTime()
    : new Date().getTime() - new Date(trace.started_at).getTime();

  const total_tokens = tool_calls.reduce((sum, e) => sum + (e.tokens_used || 0), 0);
  const total_cost = tool_calls.reduce((sum, e) => sum + (e.estimated_cost || 0), 0);

  return {
    trace_id: trace.trace_id,
    agent_id: trace.agent_id,
    task_description: trace.task_description,
    metadata,
    status: trace.status,
    started_at: trace.started_at,
    ended_at: trace.ended_at,
    outcome: trace.outcome,
    summary: trace.summary,
    total_duration_ms,
    total_events: allEvents.length,
    total_spans: traceSpans.length,
    total_tool_calls: tool_calls.length,
    total_decisions: decisions.length,
    total_tokens,
    total_estimated_cost: parseFloat(total_cost.toFixed(6)),
    spans: spanTree,
    events: allEvents,
  };
}

export function searchTraces(agent_id = null, status = null, limit = 20) {
  let query = 'SELECT * FROM traces WHERE 1=1';
  const params = [];

  if (agent_id) {
    query += ' AND agent_id = ?';
    params.push(agent_id);
  }
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY started_at DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(query).all(...params);

  return rows.map(t => {
    const tc = db.prepare('SELECT COUNT(*) as c FROM tool_calls WHERE trace_id = ?').get(t.trace_id).c;
    const dc = db.prepare('SELECT COUNT(*) as c FROM decisions WHERE trace_id = ?').get(t.trace_id).c;
    const sc = db.prepare('SELECT COUNT(*) as c FROM spans WHERE trace_id = ?').get(t.trace_id).c;
    const events_count = tc + dc;

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
      events_count,
      spans_count: sc,
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
  const total = db.prepare('SELECT COUNT(*) as c FROM traces').get().c;
  const active = db.prepare("SELECT COUNT(*) as c FROM traces WHERE status = 'active'").get().c;
  const completed = total - active;
  const successful = db.prepare("SELECT COUNT(*) as c FROM traces WHERE outcome = 'success'").get().c;
  const failed = db.prepare("SELECT COUNT(*) as c FROM traces WHERE outcome = 'failure'").get().c;

  const durRows = db.prepare('SELECT started_at, ended_at FROM traces WHERE ended_at IS NOT NULL').all();
  const durations = durRows.map(t =>
    new Date(t.ended_at).getTime() - new Date(t.started_at).getTime()
  );
  const avg_duration_ms = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  const total_spans = db.prepare('SELECT COUNT(*) as c FROM spans').get().c;
  const total_tool_calls = db.prepare('SELECT COUNT(*) as c FROM tool_calls').get().c;
  const total_decisions = db.prepare('SELECT COUNT(*) as c FROM decisions').get().c;
  const total_events = total_tool_calls + total_decisions;

  const tokenRow = db.prepare('SELECT SUM(tokens_used) as s FROM tool_calls').get();
  const total_tokens = tokenRow.s || 0;

  const success_rate = completed > 0 ? parseFloat((successful / completed).toFixed(3)) : 0;

  return {
    total_traces: total,
    active_traces: active,
    completed_traces: completed,
    successful_traces: successful,
    failed_traces: failed,
    success_rate,
    avg_duration_ms,
    total_spans,
    total_events,
    total_tool_calls,
    total_decisions,
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
