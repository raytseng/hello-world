import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Evaluator } from '../src/engine/evaluator.js';
import { verifyStripeSignature, verifyNowpaymentsSignature } from '../src/payments/server.js';
import crypto from 'node:crypto';

function setup(rules) {
  const sent = [];
  const sub = { id: 's1', active: true, channels: [], rules };
  const ev = new Evaluator(
    () => [sub],
    (_sub, text) => sent.push(text),
  );
  let t = 1_000_000;
  const tick = (symbol, price, advanceMs = 100) => {
    t += advanceMs;
    ev.onTick({ source: 'test', symbol, price, eventTime: t - 20, recvTime: t });
  };
  return { sent, tick, sub };
}

test('cross_above fires once on crossing, respects cooldown', () => {
  const { sent, tick } = setup([{ symbol: 'BTCUSDT', type: 'cross_above', price: 100, cooldownSec: 60 }]);
  tick('BTCUSDT', 95);
  tick('BTCUSDT', 99);
  assert.equal(sent.length, 0);
  tick('BTCUSDT', 101); // crosses
  assert.equal(sent.length, 1);
  assert.match(sent[0], /向上突破/);
  tick('BTCUSDT', 99);
  tick('BTCUSDT', 102); // crosses again within cooldown → suppressed
  assert.equal(sent.length, 1);
  tick('BTCUSDT', 98, 61_000);
  tick('BTCUSDT', 103); // cooldown elapsed → fires
  assert.equal(sent.length, 2);
});

test('cross_below fires on downward crossing only', () => {
  const { sent, tick } = setup([{ symbol: 'ETHUSDT', type: 'cross_below', price: 50 }]);
  tick('ETHUSDT', 55);
  tick('ETHUSDT', 49);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /向下跌破/);
});

test('other symbols are ignored', () => {
  const { sent, tick } = setup([{ symbol: 'BTCUSDT', type: 'cross_above', price: 100 }]);
  tick('ETHUSDT', 50);
  tick('ETHUSDT', 150);
  assert.equal(sent.length, 0);
});

test('inactive subscriber gets no alerts', () => {
  const { sent, tick, sub } = setup([{ symbol: 'BTCUSDT', type: 'cross_above', price: 100 }]);
  sub.active = false;
  tick('BTCUSDT', 95);
  tick('BTCUSDT', 105);
  assert.equal(sent.length, 0);
});

test('pct_change fires on move within window and resets', () => {
  const { sent, tick } = setup([{ symbol: 'BTCUSDT', type: 'pct_change', windowMin: 5, pct: 3, cooldownSec: 0 }]);
  tick('BTCUSDT', 100);
  tick('BTCUSDT', 101, 60_000);
  tick('BTCUSDT', 102, 60_000);
  assert.equal(sent.length, 0); // +2% — below threshold
  tick('BTCUSDT', 103.5, 60_000); // +3.5% vs window start
  assert.equal(sent.length, 1);
  assert.match(sent[0], /急漲/);
  tick('BTCUSDT', 103.6, 1_000); // window was reset — tiny move, no re-fire
  assert.equal(sent.length, 1);
});

test('pct_change ignores moves older than the window', () => {
  const { sent, tick } = setup([{ symbol: 'BTCUSDT', type: 'pct_change', windowMin: 5, pct: 3, cooldownSec: 0 }]);
  tick('BTCUSDT', 100);
  tick('BTCUSDT', 102, 6 * 60_000); // first point aged out; window now starts at 102
  tick('BTCUSDT', 104, 60_000); // +1.96% vs 102 — no fire
  assert.equal(sent.length, 0);
});

test('alert includes source and latency', () => {
  const { sent, tick } = setup([{ symbol: 'BTCUSDT', type: 'cross_above', price: 100 }]);
  tick('BTCUSDT', 95);
  tick('BTCUSDT', 105);
  assert.match(sent[0], /來源 test・行情延遲 20ms/);
});

test('stripe signature verification', () => {
  const secret = 'whsec_test';
  const body = '{"type":"checkout.session.completed"}';
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${v1}`, secret), true);
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${'0'.repeat(64)}`, secret), false);
  const oldT = t - 3600;
  const oldV1 = crypto.createHmac('sha256', secret).update(`${oldT}.${body}`).digest('hex');
  assert.equal(verifyStripeSignature(body, `t=${oldT},v1=${oldV1}`, secret), false, 'stale timestamp rejected');
});

test('nowpayments signature verification uses sorted keys', () => {
  const secret = 'ipn_test';
  const body = { payment_status: 'finished', order_id: 'ray:30', amount: 1 };
  const sorted = JSON.stringify(body, Object.keys(body).sort());
  const sig = crypto.createHmac('sha512', secret).update(sorted).digest('hex');
  assert.equal(verifyNowpaymentsSignature(body, sig, secret), true);
  assert.equal(verifyNowpaymentsSignature({ ...body, amount: 2 }, sig, secret), false);
});
