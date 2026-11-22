import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoneySms as p, maskNumbers } from '../src/money_parse.js';

test('Vodafone Cash: money in, with balance and masked number', () => {
  const r = p('VF-Cash', 'تم استلام مبلغ 500.00 جنيه من رقم 01012345678 رصيدك الحالي 1,250.50 جنيه');
  assert.equal(r.kind, 'tx'); assert.equal(r.dir, 'in'); assert.equal(r.amount, 500); assert.equal(r.balance, 1250.5);
  assert.equal(r.source, 'فودافون كاش'); assert.equal(r.counterparty, '****5678');
  assert.ok(!r.text.includes('01012345678'));
});

test('Vodafone Cash: transfer out', () => {
  const r = p('VF-Cash', 'تم تحويل مبلغ 200 جنيه لرقم 01098765432 بنجاح. رصيدك الحالي 1050.50 جنيه');
  assert.equal(r.dir, 'out'); assert.equal(r.amount, 200); assert.equal(r.category, 'تحويلات');
});

test('bank card purchase (English) and Arabic debit', () => {
  const a = p('CIB', 'Your card ending 1234 was charged EGP 350.00 at CARREFOUR MAADI on 22/11. Avl Bal EGP 12,400.00');
  assert.deepEqual([a.dir, a.amount, a.balance, a.counterparty, a.category], ['out', 350, 12400, 'CARREFOUR MAADI', 'سوبر ماركت']);
  const b = p('NBE', 'تم خصم مبلغ 1500 ج.م من حسابك رقم 1234567890123 لدى TALABAT بتاريخ 22/11 الرصيد المتاح 8000 ج.م');
  assert.deepEqual([b.dir, b.amount, b.balance, b.counterparty, b.category], ['out', 1500, 8000, 'TALABAT', 'أكل وكافيهات']);
});

test('Arabic digits, salary, InstaPay in', () => {
  const s = p('NBE', 'تم إيداع مبلغ ٢٠٬٠٠٠ جنيه في حسابك رقم 123456789012 (راتب)');
  assert.deepEqual([s.dir, s.amount, s.category], ['in', 20000, 'مرتب']);
  const i = p('InstaPay', 'You have received EGP 1,000 from Ahmed Ali to your account');
  assert.deepEqual([i.dir, i.amount, i.counterparty], ['in', 1000, 'Ahmed Ali']);
});

test('codes and offers are ignored; unreadable money messages are kept as unclear', () => {
  assert.equal(p('CIB', 'Your OTP is 123456. Do not share it').kind, 'ignore');
  assert.equal(p('Bank', 'عرض خاص خصم 20% على مشترياتك').kind, 'ignore');
  assert.equal(p('Bank', 'عملية بقيمة 300 جنيه').kind, 'unclear');
});

test('masking keeps the last 4 digits of long numbers only', () => {
  assert.equal(maskNumbers('card 4111 1111 1111 1234, amount 350'), 'card ****1234, amount 350');
});
