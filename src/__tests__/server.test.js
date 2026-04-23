import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTrace, endTrace, createSpan, logToolCall, logDecision, getTrace, searchTraces } from '../store.js';

describe('trace-forge-mcp', () => {
  let traceId;

  it('starts a trace', () => {
    const result = startTrace('test-agent', 'Test task description');
    assert.ok(result.trace_id);
    assert.ok(result.started_at);
    traceId = result.trace_id;
  });

  it('creates a span within a trace', () => {
    const result = createSpan(traceId, 'processing', { step: 1 });
    assert.ok(result);
  });

  it('logs a tool call event', () => {
    const result = logToolCall(traceId, 'read_file', { path: '/test.js' });
    assert.ok(result);
  });

  it('logs a decision event', () => {
    const result = logDecision(traceId, 'Chose option A', 'Better performance', 0.9);
    assert.ok(result);
  });

  it('retrieves a trace by ID', () => {
    const trace = getTrace(traceId);
    assert.ok(trace);
    assert.equal(trace.trace_id || trace.trace?.trace_id, traceId);
  });

  it('ends a trace with outcome', () => {
    const result = endTrace(traceId, 'success', 'Task completed');
    assert.ok(result);
  });

  it('searches traces', () => {
    const results = searchTraces('test-agent');
    assert.ok(results);
  });
});
