import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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

describe('store', () => {
  let traceId;
  let spanId;
  let childSpanId;

  it('starts a trace', () => {
    const result = startTrace('agent-1', 'Build MCP server', { model: 'opus' });
    assert.ok(result.trace_id);
    assert.ok(result.started_at);
    traceId = result.trace_id;
  });

  it('creates a span', () => {
    const result = createSpan(traceId, 'research');
    assert.ok(result.span_id);
    assert.equal(result.trace_id, traceId);
    spanId = result.span_id;
  });

  it('creates a child span', () => {
    const result = createSpan(traceId, 'web-search', spanId);
    assert.ok(result.span_id);
    childSpanId = result.span_id;
  });

  it('rejects span with invalid parent', () => {
    const result = createSpan(traceId, 'bad', 'nonexistent-id');
    assert.ok(result.error);
  });

  it('rejects span for nonexistent trace', () => {
    const result = createSpan('nonexistent-trace', 'bad');
    assert.ok(result.error);
  });

  it('logs a tool call', () => {
    const result = logToolCall(
      traceId, spanId, 'WebSearch', { query: 'MCP servers' },
      'Found 10 results', 1500, 230, 'success'
    );
    assert.ok(result.event_id);
    assert.equal(result.logged, true);
  });

  it('logs a tool call without span', () => {
    const result = logToolCall(
      traceId, null, 'Read', { file: 'index.js' },
      'File contents...', null, 50, 'success'
    );
    assert.ok(result.event_id);
    assert.equal(result.logged, true);
  });

  it('logs a tool call with error status', () => {
    const result = logToolCall(
      traceId, null, 'Bash', { command: 'fail' },
      'exit code 1', 200, 100, 'error'
    );
    assert.ok(result.event_id);
  });

  it('logs a decision', () => {
    const result = logDecision(
      traceId,
      'Need to choose between REST API and GraphQL',
      ['REST API', 'GraphQL', 'gRPC'],
      'REST API',
      0.85
    );
    assert.ok(result.event_id);
    assert.equal(result.logged, true);
  });

  it('retrieves full trace tree', () => {
    const trace = getTrace(traceId);
    assert.equal(trace.trace_id, traceId);
    assert.equal(trace.agent_id, 'agent-1');
    assert.equal(trace.status, 'active');
    assert.equal(trace.total_spans, 2);
    assert.equal(trace.total_tool_calls, 3);
    assert.equal(trace.total_decisions, 1);
    assert.equal(trace.total_events, 4);
    assert.ok(trace.spans.length > 0);
    // Check nested span tree — research span should have web-search child
    const researchSpan = trace.spans.find(s => s.span_name === 'research');
    assert.ok(researchSpan);
    assert.equal(researchSpan.children.length, 1);
    assert.equal(researchSpan.children[0].span_name, 'web-search');
  });

  it('returns error for nonexistent trace', () => {
    const result = getTrace('nonexistent');
    assert.ok(result.error);
  });

  it('ends a trace', () => {
    const result = endTrace(traceId, 'success', 'Built the server');
    assert.equal(result.trace_id, traceId);
    assert.ok(result.duration_ms >= 0);
    assert.equal(result.events_count, 4);
    assert.equal(result.spans_count, 2);
    assert.equal(result.tool_calls_count, 3);
  });

  it('rejects ending an already-ended trace', () => {
    const result = endTrace(traceId, 'failure');
    assert.ok(result.error);
  });

  it('searches traces by agent_id', () => {
    const results = searchTraces('agent-1');
    assert.ok(results.length >= 1);
    assert.equal(results[0].agent_id, 'agent-1');
  });

  it('searches traces by status', () => {
    const results = searchTraces(null, 'success');
    assert.ok(results.length >= 1);
  });

  it('returns empty for nonexistent agent', () => {
    const results = searchTraces('nonexistent-agent');
    assert.equal(results.length, 0);
  });

  it('returns recent traces', () => {
    const recent = getRecentTraces();
    assert.ok(Array.isArray(recent));
    assert.ok(recent.length >= 1);
  });

  it('returns aggregate stats', () => {
    const stats = getStats();
    assert.ok(stats.total_traces >= 1);
    assert.ok(stats.success_rate >= 0);
    assert.ok(stats.total_tool_calls >= 3);
    assert.ok(stats.total_decisions >= 1);
    assert.ok(stats.generated_at);
  });
});
