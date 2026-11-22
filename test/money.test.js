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
  assert.deepEqual([b.dir, b.amount, b.balance, b.counterparty, b.category], ['out', 1500, 8000, 'TALABAT', 'طلبات']);
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

test('real messages: Al Ahly instant transfer, Vodafone Cash transfer with fee and ad tail', () => {
  const a = p('BanK-AlAhly', 'تم تنفيذ تحويل لحظي من حسابكم رقم 0100 بمبلغ 500.00 جم إلى AMAL M****** M****** H****** رقم مرجعي 469064469959 يوم 11-22 الساعة 16:19 للمزيد اتصل بـ 19623');
  assert.deepEqual([a.kind, a.dir, a.amount, a.source, a.category], ['tx', 'out', 500, 'البنك الأهلي', 'تحويلات']);
  assert.equal(a.counterparty, 'AMAL M****** M****** H******');
  const v = p('VF-Cash', 'تم تحويل 2335 جنيه لرقم 01069949365 مصاريف الخدمة 1 جنيه رصيد حسابك فى فودافون كاش الحالي 1311.58.\nتاريخ العملية 12:39 26-11-22 :\nرقم العملية 026052499293 :\n حول فلوس لأي محفظة وزود فرصك تكسب جنيه دهب! وكمان هيجيلك لحد 100ج كاش باك. http://vf.eg/vfcash?id=money_transfer');
  assert.deepEqual([v.dir, v.amount, v.fee, v.balance, v.counterparty, v.category], ['out', 2336, 1, 1311.58, '****9365', 'تحويلات']);
  assert.ok(!v.text.includes('http'));
  assert.equal(p('VF-Cash', 'جدد باقة Flex من خلال فودافون كاش قبل ما تخلص').kind, 'ignore');
});

test('OTP for a purchase in progress is ignored even though it carries the amount', () => {
  const r = p('BanK-AlAhly', 'راجع هذا الكود سرى 224700. يرجى عدم مشاركته مع أي شخص آخر، وهو مخصص لعملية الشراء التي تقوم بها الآن بمبلغ EGP 10,122.00 عند التاجر My fawry في 22.11.2026 12:25 بالبطاقة رقم 8502');
  assert.equal(r.kind, 'ignore');
  assert.equal(p('NBE', 'تم خصم مبلغ 300 جنيه لدى مطعم سريع الرصيد المتاح 100').kind, 'tx');
});

test('Fawry payments count as ads', () => {
  const r = p('BanK-AlAhly', 'تم خصم مبلغ EGP 10,122.00 من بطاقتكم رقم 8502 لدى My fawry يوم 22-11 الساعة 12:26');
  assert.deepEqual([r.kind, r.dir, r.amount, r.category, r.source], ['tx', 'out', 10122, 'إعلانات', 'البنك الأهلي']);
});
