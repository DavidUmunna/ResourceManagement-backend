const { makeFingerprint, parseIdempotencyKey, isDuplicateKeyError } = require('../../services/orderDedupe.service');

const BASE = {
  staff: '6830789898ef43e5803ea02c',
  supplier: 'Acme Supplies Ltd',
  Title: 'Office printer toner',
  products: [
    { name: 'Toner black', quantity: 4, price: 25000 },
    { name: 'Toner cyan', quantity: 2, price: 27000 },
  ],
  remarks: 'Printers on the 2nd floor are out',
  urgency: 'Urgent',
};

describe('makeFingerprint', () => {
  const fp = (overrides = {}) => makeFingerprint({ ...BASE, ...overrides });

  it('same content → same sha256 hex hash', () => {
    expect(fp()).toBe(fp());
    expect(fp()).toMatch(/^[a-f0-9]{64}$/);
  });

  it('ignores whitespace and letter case in Title, supplier and product names', () => {
    const messy = fp({
      Title: '  OFFICE   printer toner ',
      supplier: 'acme  SUPPLIES ltd',
      products: [
        { name: ' toner BLACK ', quantity: 4, price: 25000 },
        { name: 'Toner   Cyan', quantity: 2, price: 27000 },
      ],
    });
    expect(messy).toBe(fp());
  });

  it('ignores product order', () => {
    expect(fp({ products: [...BASE.products].reverse() })).toBe(fp());
  });

  it('treats numeric strings and numbers the same (form inputs)', () => {
    expect(fp({ products: [{ name: 'Toner black', quantity: '4', price: '25000' }, BASE.products[1]] })).toBe(fp());
  });

  it.each([
    ['quantity', { products: [{ ...BASE.products[0], quantity: 5 }, BASE.products[1]] }],
    ['price', { products: [{ ...BASE.products[0], price: 25001 }, BASE.products[1]] }],
    ['product name', { products: [{ ...BASE.products[0], name: 'Toner magenta' }, BASE.products[1]] }],
    ['extra product', { products: [...BASE.products, { name: 'Paper', quantity: 1, price: 10 }] }],
    ['supplier', { supplier: 'Other Supplier' }],
    ['Title', { Title: 'Different title' }],
    ['staff', { staff: '6830789898ef43e5803ea02d' }],
  ])('a different %s → a different hash', (_label, overrides) => {
    expect(fp(overrides)).not.toBe(fp());
  });

  it('remarks and urgency do NOT change the hash', () => {
    expect(fp({ remarks: 'Fixed a typo in the remarks', urgency: 'VeryUrgent' })).toBe(fp());
  });

  it('attachments do NOT change the hash', () => {
    expect(fp({ fileRefs: '6afac36325667c482460234a' })).toBe(fp({ fileRefs: '6afac3bdbc7157e859696952' }));
  });

  it('tolerates missing/invalid products', () => {
    expect(() => makeFingerprint({ staff: 's', products: undefined })).not.toThrow();
    expect(() => makeFingerprint({ staff: 's', products: 'nope' })).not.toThrow();
  });
});

describe('parseIdempotencyKey', () => {
  it('absent header is allowed (old clients)', () => {
    expect(parseIdempotencyKey(undefined)).toEqual({ key: null, valid: true });
    expect(parseIdempotencyKey('')).toEqual({ key: null, valid: true });
  });

  it('accepts UUIDs and [A-Za-z0-9-_] up to 100 chars', () => {
    expect(parseIdempotencyKey('3f6c1b0e-6a4e-4b8e-9b1a-2f9c5d7e8a10')).toEqual({
      key: '3f6c1b0e-6a4e-4b8e-9b1a-2f9c5d7e8a10',
      valid: true,
    });
    expect(parseIdempotencyKey('a_B-1'.repeat(20)).valid).toBe(true);
  });

  it('rejects over-long keys and other characters', () => {
    expect(parseIdempotencyKey('a'.repeat(101)).valid).toBe(false);
    expect(parseIdempotencyKey('has space').valid).toBe(false);
    expect(parseIdempotencyKey('semi;colon').valid).toBe(false);
    expect(parseIdempotencyKey('{"$gt":""}').valid).toBe(false);
  });
});

describe('isDuplicateKeyError', () => {
  it('matches E11000 on the requested field only', () => {
    const err = { code: 11000, keyPattern: { idempotencyKey: 1 } };
    expect(isDuplicateKeyError(err)).toBe(true);
    expect(isDuplicateKeyError(err, 'idempotencyKey')).toBe(true);
    expect(isDuplicateKeyError(err, 'orderNumber')).toBe(false);
    expect(isDuplicateKeyError({ code: 11000, message: 'E11000 dup key: orderNumber_1' }, 'orderNumber')).toBe(true);
    expect(isDuplicateKeyError(new Error('other'))).toBe(false);
  });
});
