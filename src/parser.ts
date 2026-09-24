import { Batch, ParseState, Sample, Thread, Tokens, Turn, emptyBatch } from './types';
import { clean, hash, integer, object, str, timestamp } from './util';
export function tokenVector(input: unknown): Tokens | null {
  const p = object(input);
  for (const k of ['input_tokens', 'output_tokens']) {
    if (typeof p[k] !== 'number' || !Number.isSafeInteger(p[k]) || Number(p[k]) < 0) return null;
  }
  for (const key of [
    'cached_input_tokens',
    'cache_write_input_tokens',
    'reasoning_output_tokens',
  ]) {
    if (p[key] !== undefined && (!Number.isSafeInteger(p[key]) || Number(p[key]) < 0)) return null;
  }
  const result: Tokens = {
    input: integer(p.input_tokens),
    cached: integer(p.cached_input_tokens),
    write: integer(p.cache_write_input_tokens),
    output: integer(p.output_tokens),
    reasoning: integer(p.reasoning_output_tokens),
  };
  if (result.cached + result.write > result.input || result.reasoning > result.output) return null;
  return result;
}
export function parseRecord(
  raw: unknown,
  state: ParseState,
  account: string,
  device: string,
): Batch {
  const batch = emptyBatch();
  const record = object(raw);
  const p = object(record.payload);
  const at = timestamp(record.timestamp);
  const type = str(record.type);
  const issue = (code: string): void => {
    batch.issues.push({ scope: state.owner?.id ?? 'source', code, at });
  };
  if (!at) {
    issue('invalid_timestamp');
    return batch;
  }
  if (type === 'session_meta') {
    const id = clean(p.id, 240);
    if (!id) {
      issue('missing_thread_id');
      return batch;
    }
    if (state.owner) {
      // A later header can be inherited from a parent. It must never change ownership.
      return batch;
    }
    const sub = object(object(p.source).subagent);
    const spawn = object(sub.thread_spawn);
    const parent = clean(p.parent_thread_id, 240) || clean(spawn.parent_thread_id, 240) || null;
    const root = clean(p.session_id, 240) || parent || id;
    const kind =
      clean(p.thread_source) || (str(p.source) === 'cli' ? 'user' : parent ? 'subagent' : 'user');
    const owner: Thread = { id, parent, root, kind, started: timestamp(p.timestamp, at) };
    state.owner = owner;
    state.forked = Boolean(p.forked_from_id || p.history_base || parent);
    state.ownStartOrdinal =
      typeof p.subagent_history_start_ordinal === 'number'
        ? p.subagent_history_start_ordinal
        : typeof p.forked_from_ordinal_exclusive === 'number'
          ? p.forked_from_ordinal_exclusive
          : null;
    batch.threads.push(owner);
    return batch;
  }
  const owner = state.owner;
  if (!owner) {
    issue('missing_owner');
    return batch;
  }
  const ordinal = typeof record.ordinal === 'number' ? record.ordinal : null;
  const inherited =
    ordinal !== null && state.ownStartOrdinal !== null && ordinal < state.ownStartOrdinal;
  if (inherited) return batch;
  const event = type === 'event_msg' ? str(p.type) : type;
  if (type === 'turn_context') {
    if (p.thread_id && p.thread_id !== owner.id) return batch;
    state.active = clean(p.turn_id, 240) || state.active;
    state.rootTurn = clean(p.root_turn_id, 240) || state.rootTurn || state.active;
    state.model = clean(p.model);
    state.effort = clean(p.effort) || clean(object(p.effort).effort);
    state.tier = clean(p.service_tier) || state.tier;
    return batch;
  }
  if (event === 'thread_settings_applied') {
    if (p.thread_id && p.thread_id !== owner.id) return batch;
    const settings = object(p.thread_settings);
    state.model = clean(settings.model) || state.model;
    state.effort = clean(settings.reasoning_effort) || state.effort;
    state.tier = clean(settings.service_tier) || state.tier;
    return batch;
  }
  const turn = (id: string, status: Turn['status']): Turn => ({
    thread: owner.id,
    id,
    rootThread: owner.root,
    rootTurn: clean(p.root_turn_id, 240) || state.rootTurn || id,
    started: timestamp(p.started_at, at),
    ended: status === 'running' ? null : timestamp(p.completed_at, at),
    durationMs: typeof p.duration_ms === 'number' && p.duration_ms >= 0 ? p.duration_ms : null,
    status,
    error:
      clean(object(p.error).codex_error_info) ||
      clean(object(object(p.error).codex_error_info).type) ||
      null,
    model: state.model,
    effort: state.effort,
    tier: state.tier,
  });
  if (['task_started', 'turn_started'].includes(event)) {
    const id = clean(p.turn_id, 240);
    if (!id) return batch;
    state.active = id;
    state.rootTurn = clean(p.root_turn_id, 240) || id;
    state.ownStarted = true;
    batch.turns.push(turn(id, 'running'));
    return batch;
  }
  if (['task_complete', 'turn_complete', 'turn_aborted'].includes(event)) {
    const id = clean(p.turn_id, 240) || state.active;
    if (!id) return batch;
    // A child with inherited legacy history needs an owned start or explicit request before projection.
    if (
      state.forked &&
      state.ownStartOrdinal === null &&
      !state.ownStarted &&
      !state.nativeTurns.includes(id)
    )
      return batch;
    const status = event === 'turn_aborted' ? 'interrupted' : p.error ? 'failed' : 'completed';
    batch.turns.push(turn(id, status));
    return batch;
  }
  if (event === 'error' && state.active) {
    const t = turn(state.active, 'failed');
    t.error =
      clean(p.codex_error_info) || clean(object(p.codex_error_info).type) || 'provider_error';
    batch.turns.push(t);
    return batch;
  }
  if (type === 'token_usage_record') {
    if (p.thread_id !== owner.id) return batch;
    const tokens = tokenVector(p.usage);
    const id = clean(p.response_id, 240);
    const tid = clean(p.turn_id, 240);
    if (!tokens || !id || !tid) {
      issue('invalid_native_usage');
      return batch;
    }
    const rootThread = clean(p.session_id, 240) || owner.root;
    const rootTurn = clean(p.root_turn_id, 240) || tid;
    const sample: Sample = {
      ...tokens,
      id: `n:${id}`,
      thread: owner.id,
      turn: tid,
      rootThread,
      rootTurn,
      at,
      model: state.model,
      effort: state.effort,
      tier: state.tier,
      account,
      device,
      format: 'native',
      pricePico: null,
      priceSnapshot: null,
      priceReason: null,
    };
    batch.samples.push(sample);
    if (!state.nativeTurns.includes(tid)) state.nativeTurns.push(tid);
    state.nativeTurns = state.nativeTurns.slice(-64);
    state.active = tid;
    state.rootTurn = rootTurn;
    const t = turn(tid, 'unknown');
    t.rootThread = rootThread;
    t.rootTurn = rootTurn;
    t.ended = null;
    batch.turns.push(t);
    return batch;
  }
  if (event === 'token_count') {
    const q = object(p.rate_limits);
    if (Object.keys(q).length) {
      for (const window of ['primary', 'secondary']) {
        const w = object(q[window]);
        if (!Object.keys(w).length) continue;
        batch.quotas.push({
          id: hash(
            JSON.stringify([owner.id, at, q.limit_id, window, w, q.rate_limit_reached_type]),
          ),
          thread: owner.id,
          at,
          account,
          limit: clean(q.limit_id) || 'unknown',
          window,
          minutes: typeof w.window_minutes === 'number' ? w.window_minutes : null,
          used:
            typeof w.used_percent === 'number' && w.used_percent >= 0 && w.used_percent <= 100
              ? w.used_percent
              : null,
          resets: w.resets_at ? timestamp(w.resets_at) || null : null,
          reached: clean(q.rate_limit_reached_type) || null,
        });
      }
      if (
        q.rate_limit_reached_type &&
        !Object.keys(object(q.primary)).length &&
        !Object.keys(object(q.secondary)).length
      )
        batch.quotas.push({
          id: hash(JSON.stringify([owner.id, at, q.limit_id, q.rate_limit_reached_type])),
          thread: owner.id,
          at,
          account,
          limit: clean(q.limit_id) || 'unknown',
          window: 'unknown',
          minutes: null,
          used: null,
          resets: null,
          reached: clean(q.rate_limit_reached_type),
        });
    }
    const info = object(p.info);
    const total = tokenVector(info.total_token_usage);
    if (!total) return batch;
    const before = state.previous;
    state.previous = total;
    state.previousAt = at;
    if (!state.active || (state.forked && !state.ownStarted)) return batch;
    if (!before && !state.ownStarted) return batch;
    const zero: Tokens = { input: 0, cached: 0, write: 0, output: 0, reasoning: 0 };
    const b = before ?? zero;
    const delta = {
      input: total.input - b.input,
      cached: total.cached - b.cached,
      write: total.write - b.write,
      output: total.output - b.output,
      reasoning: total.reasoning - b.reasoning,
    };
    if (
      Object.values(delta).some((v) => v < 0) ||
      delta.cached + delta.write > delta.input ||
      delta.reasoning > delta.output
    ) {
      issue('legacy_counter_reset');
      return batch;
    }
    if (delta.input + delta.output === 0) return batch;
    const last = tokenVector(info.last_token_usage);
    const exact = last && Object.entries(delta).every(([k, v]) => last[k as keyof Tokens] === v);
    batch.samples.push({
      ...delta,
      id: 'l:' + hash(JSON.stringify([owner.id, state.active, total])),
      thread: owner.id,
      turn: state.active,
      rootThread: owner.root,
      rootTurn: state.rootTurn || state.active,
      at,
      model: state.model,
      effort: state.effort,
      tier: state.tier,
      account,
      device,
      format: 'legacy',
      pricePico: null,
      priceSnapshot: null,
      priceReason: exact ? null : 'ambiguous_request_boundaries',
    });
    return batch;
  }
  if (
    ['function_call', 'custom_tool_call', 'web_search_call', 'image_generation_call'].includes(
      str(p.type),
    ) &&
    state.active
  ) {
    const call = clean(p.call_id, 240) || clean(p.id, 240);
    if (call)
      batch.tools.push({
        id: hash(owner.id + ':' + call),
        thread: owner.id,
        turn: state.active,
        kind: str(p.type),
        at,
      });
  }
  return batch;
}
