import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DELIVERED_TEMPLATE_NAME = 'delivered_offer';
process.env.REJECTED_TEMPLATE_NAME = 'return_reason';
process.env.AUTO_MARKS_FILE = '/tmp/claude-0/-home-claude/ec6995d7-3700-567d-b07b-f3ea7d723b7b/scratchpad/marks-test.json';
const { plan, kindOf } = await import('../src/ecwid_manual_msgs.js');

const now = Date.parse('2026-11-10T12:00:00Z');
const order = (over) => ({ id: 'AAA', orderNumber: 'AAA', fulfillmentStatus: 'DELIVERED', phone: '01012345678', createTimestamp: (now - 3 * 86400000) / 1000, ...over });

test('Delivered → offer, Will not deliver / Returned → reason question, anything else → nothing', () => {
  assert.equal(kindOf(order()), 'delivered');
  assert.equal(kindOf(order({ fulfillmentStatus: 'WILL_NOT_DELIVER' })), 'rejected');
  assert.equal(kindOf(order({ fulfillmentStatus: 'RETURNED' })), 'rejected');
  assert.equal(kindOf(order({ fulfillmentStatus: 'SHIPPED' })), null);
});

test('a hand-closed order is messaged once, to the customer, with the right template', () => {
  const opts = { now, isAutoFn: () => false, sentRecentlyFn: () => false };
  const [m] = plan([order()], {}, opts);
  assert.deepEqual([m.kind, m.to, m.template, m.skip], ['delivered', '201012345678', 'delivered_offer', null]);
  const [r] = plan([order({ id: 'B', fulfillmentStatus: 'WILL_NOT_DELIVER' })], {}, opts);
  assert.equal(r.template, 'return_reason');
  assert.equal(plan([order()], { 'AAA|delivered': { at: 'x' } }, opts).length, 0); // already handled
});

test('skipped: changed by the automation, already sent to that phone, old orders, no phone', () => {
  const base = { now, isAutoFn: () => false, sentRecentlyFn: () => false };
  assert.match(plan([order()], {}, { ...base, isAutoFn: (id) => id === 'AAA' })[0].skip, /automation/);
  assert.match(plan([order()], {}, { ...base, sentRecentlyFn: () => true })[0].skip, /3 days/);
  assert.equal(plan([order({ createTimestamp: (now - 40 * 86400000) / 1000 })], {}, base)[0].skip, 'old order');
  assert.equal(plan([order({ phone: null })], {}, base)[0].skip, 'no phone');
});
