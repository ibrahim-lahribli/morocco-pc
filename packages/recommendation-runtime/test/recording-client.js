'use strict';

// packages/recommendation-runtime/test/recording-client.js — the recording fake
// client the orchestrator transaction-behaviour suite runs on.
//
// It is deliberately the smallest thing that can answer "what was issued, in
// which order, on whose connection": no database, no driver, no `pg`. Each
// `query(sql, params)` records the statement, its parameters and the receiver
// it was issued on (so a test can prove every statement went to ONE object),
// and the connection-lifecycle methods are counters rather than no-ops, so the
// suite can pin that the orchestrator never releases, ends or reconnects a
// client it was handed.
//
// `onQuery(sql, params, callNumber)` may return a result object to answer a
// statement, or throw to make it fail. Returning `undefined` falls through to
// the default `{ rows: [] }`.
//
// The per-module suites keep their own local fakes on purpose: they pin
// different seams, and this file is only the shared recorder for the
// cross-module invariants in transaction-behavior.test.js.

/** The only statements that change transaction state. */
const TRANSACTION_KEYWORDS = Object.freeze(['BEGIN', 'COMMIT', 'ROLLBACK']);

/** `BEGIN` and its documented variants (`BEGIN ISOLATION LEVEL ... READ ONLY`). */
function isTransactionStatement(sql) {
  return sql === 'COMMIT' || sql === 'ROLLBACK' || sql === 'BEGIN' || sql.startsWith('BEGIN ');
}

function isBegin(sql) {
  return sql === 'BEGIN' || sql.startsWith('BEGIN ');
}

function createRecordingClient(options = {}) {
  const calls = [];
  const lifecycle = { release: 0, end: 0, connect: 0 };

  const client = {
    calls,
    lifecycle,
    async query(sql, params) {
      calls.push({ sql, params, receiver: this });
      if (typeof options.onQuery === 'function') {
        const outcome = options.onQuery(sql, params, calls.length);
        if (outcome !== undefined) return outcome;
      }
      return { rows: [] };
    },
    // Present so a caller that wrongly treats the client as a pooled handle
    // would leave a trace: the orchestrator must never invoke any of these.
    release() {
      lifecycle.release += 1;
    },
    end() {
      lifecycle.end += 1;
    },
    connect() {
      lifecycle.connect += 1;
      return client;
    },
  };

  return client;
}

/** The recorded statements, in order, without their parameters. */
function statementsOf(client) {
  return client.calls.map((call) => call.sql);
}

/** The recorded statements that open, commit or roll back a transaction. */
function transactionLog(client) {
  return client.calls
    .map((call, index) => ({ sql: call.sql, index }))
    .filter((call) => isTransactionStatement(call.sql));
}

/**
 * The highest number of transactions open at the same time in the recorded
 * log. `BEGIN` increments, `COMMIT`/`ROLLBACK` decrement; a log that ends a
 * transaction it never opened is itself a defect and throws.
 */
function maxOpenTransactions(client) {
  let open = 0;
  let peak = 0;
  for (const call of transactionLog(client)) {
    if (isBegin(call.sql)) {
      open += 1;
    } else {
      open -= 1;
      if (open < 0) {
        throw new Error('the recorded log ends a transaction before it was opened: ' + call.sql);
      }
    }
    peak = Math.max(peak, open);
  }
  return peak;
}

/** True when the client recorded no transaction control at all. */
function issuesNoTransactionControl(client) {
  return transactionLog(client).length === 0;
}

module.exports = {
  TRANSACTION_KEYWORDS,
  isTransactionStatement,
  createRecordingClient,
  statementsOf,
  transactionLog,
  maxOpenTransactions,
  issuesNoTransactionControl,
};
