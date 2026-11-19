const { findPossibleDuplicates, orderTotal, parseArgs } = require('../../maintenanceScripts/findDuplicateOrders');

const STAFF = '6830789898ef43e5803ea02c';
const order = (id, createdAt, overrides = {}) => ({
  _id: id,
  orderNumber: `PO-${id}`,
  staff: STAFF,
  Title: 'Office printer toner',
  supplier: 'Acme Supplies Ltd',
  products: [{ name: 'Toner', quantity: 4, price: 25000 }],
  createdAt: new Date(createdAt),
  ...overrides,
});

describe('findDuplicateOrders — findPossibleDuplicates', () => {
  it('flags the incident shape: identical orders 90 seconds apart', () => {
    const clusters = findPossibleDuplicates(
      [
        order('A', '2026-11-16T08:48:35.947Z'),
        order('B', '2026-11-16T08:50:05.530Z'),
      ],
      60
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].map((o) => o._id)).toEqual(['A', 'B']);
  });

  it('normalises Title/supplier case and whitespace', () => {
    const clusters = findPossibleDuplicates(
      [
        order('A', '2026-11-16T08:00:00Z'),
        order('B', '2026-11-16T08:05:00Z', { Title: '  OFFICE printer   toner', supplier: 'acme supplies ltd ' }),
      ],
      60
    );
    expect(clusters).toHaveLength(1);
  });

  it('does not flag orders outside the window, different staff, or different totals', () => {
    const clusters = findPossibleDuplicates(
      [
        order('A', '2026-11-16T08:00:00Z'),
        order('B', '2026-11-16T10:00:00Z'), // 2h later
        order('C', '2026-11-16T08:01:00Z', { staff: 'someone-else' }),
        order('D', '2026-11-16T08:02:00Z', { products: [{ name: 'Toner', quantity: 5, price: 25000 }] }),
      ],
      60
    );
    expect(clusters).toHaveLength(0);
  });

  it('chains orders whose consecutive gaps are within the window', () => {
    const clusters = findPossibleDuplicates(
      [
        order('A', '2026-11-16T08:00:00Z'),
        order('B', '2026-11-16T08:50:00Z'),
        order('C', '2026-11-16T09:40:00Z'),
        order('D', '2026-11-16T12:00:00Z'),
      ],
      60
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].map((o) => o._id)).toEqual(['A', 'B', 'C']);
  });

  it('orderTotal is Σ price × quantity and tolerates bad input', () => {
    expect(orderTotal([{ price: 10, quantity: 2 }, { price: 5, quantity: 3 }])).toBe(35);
    expect(orderTotal(undefined)).toBe(0);
  });

  it('parseArgs defaults to a 60 minute window and validates input', () => {
    expect(parseArgs([])).toEqual({ windowMinutes: 60, csv: null });
    expect(parseArgs(['--window-minutes', '15', '--csv', 'out.csv'])).toEqual({ windowMinutes: 15, csv: 'out.csv' });
    expect(() => parseArgs(['--window-minutes', 'abc'])).toThrow();
  });
});
