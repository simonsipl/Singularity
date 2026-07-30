'use strict';
/* SINGULARITY WORKER HARNESS — bulk-settlement shard executor
 * Machine tree. Attaches to an arena allocated by the main thread (zero-copy),
 * owns one shard, writes counters to its region of a shared stats slab.
 *
 * workerData: { arena, capacity, accountCount, shard, shards, statsSAB }
 * protocol:   main -> { count }  run one batch over `count` records
 *             worker -> 'ready' once, then 'done' after each batch
 *
 * The slab region is 16 f64 slots per shard (128 B — one cache-line pair each,
 * so shards never false-share a line). */

const { parentPort, workerData } = require('node:worker_threads');
const X = require('./bulk-settlement.exec.js');

const L = X.attachLedger(workerData.arena, workerData.capacity, workerData.accountCount);
const slab = new Float64Array(workerData.statsSAB, workerData.shard << 7, 16);
const shard = workerData.shard;
const shards = workerData.shards;

parentPort.on('message', function onBatch(msg) {
  X.processBatchShard(L, msg.count, shard, shards, slab);
  parentPort.postMessage('done');
});

parentPort.postMessage('ready');
