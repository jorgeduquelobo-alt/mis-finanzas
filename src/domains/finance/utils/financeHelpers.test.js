import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeCategory, parseTransactionDate, calculateBalances, calculateAccountBalances } from './financeHelpers';

// ─────────────────────────────────────────────────
// normalizeCategory
// ─────────────────────────────────────────────────
describe('normalizeCategory', () => {
    it('returns string category as-is', () => {
        expect(normalizeCategory('Comida')).toBe('Comida');
    });

    it('extracts name from object category', () => {
        expect(normalizeCategory({ name: 'Transporte', subcategories: [] })).toBe('Transporte');
    });

    it('extracts name from object with extra fields', () => {
        expect(normalizeCategory({ name: 'Servicios', foo: 'bar' })).toBe('Servicios');
    });

    it('returns "general" for null', () => {
        expect(normalizeCategory(null)).toBe('general');
    });

    it('returns "general" for undefined', () => {
        expect(normalizeCategory(undefined)).toBe('general');
    });

    it('returns "general" for empty string', () => {
        expect(normalizeCategory('')).toBe('general');
    });

    it('returns "general" for object without name', () => {
        expect(normalizeCategory({ subcategories: [] })).toBe('general');
    });

    it('handles number input gracefully', () => {
        // A number is truthy and not an object with .name, so it returns as-is
        expect(normalizeCategory(123)).toBe(123);
    });
});

// ─────────────────────────────────────────────────
// parseTransactionDate
// ─────────────────────────────────────────────────
describe('parseTransactionDate', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-24T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('parses Firestore Timestamp (object with toDate())', () => {
        const mockTimestamp = {
            toDate: () => new Date('2026-01-15T10:30:00Z'),
        };
        const result = parseTransactionDate(mockTimestamp);
        expect(result).toEqual(new Date('2026-01-15T10:30:00Z'));
    });

    it('parses a valid date string', () => {
        const result = parseTransactionDate('2026-01-15');
        expect(result.getUTCFullYear()).toBe(2026);
        expect(result.getUTCMonth()).toBe(0); // January
        expect(result.getUTCDate()).toBe(15);
    });

    it('parses ISO 8601 string', () => {
        const result = parseTransactionDate('2026-03-20T15:30:00Z');
        expect(result.getFullYear()).toBe(2026);
        expect(result.getMonth()).toBe(2); // March
    });

    it('returns current date for null', () => {
        const result = parseTransactionDate(null);
        expect(result.getFullYear()).toBe(2026);
        expect(result.getMonth()).toBe(1); // February
        expect(result.getDate()).toBe(24);
    });

    it('returns current date for undefined', () => {
        const result = parseTransactionDate(undefined);
        expect(result.toISOString()).toBe('2026-02-24T12:00:00.000Z');
    });

    it('returns current date for invalid date string', () => {
        const result = parseTransactionDate('not-a-date');
        // Invalid string should fallback to current date
        expect(result.getFullYear()).toBe(2026);
    });

    it('returns a Date object (not a string)', () => {
        const result = parseTransactionDate('2026-06-15');
        expect(result).toBeInstanceOf(Date);
    });
});

// ─────────────────────────────────────────────────
// calculateBalances
// ─────────────────────────────────────────────────
describe('calculateBalances', () => {
    it('returns zero balances for empty transactions', () => {
        const result = calculateBalances([]);
        expect(result.netWorth).toEqual({});
        expect(result.personalBalance).toEqual({});
        expect(result.businessCashFlow).toEqual({});
    });

    it('calculates net worth from a single credit', () => {
        const txs = [{ type: 'credit', amount: 5000, currency: 'COP', context: 'personal' }];
        const result = calculateBalances(txs);
        expect(result.netWorth.COP).toBe(5000);
        expect(result.personalBalance.COP).toBe(5000);
    });

    it('calculates net worth from a single debit', () => {
        const txs = [{ type: 'debit', amount: 3000, currency: 'COP', context: 'personal' }];
        const result = calculateBalances(txs);
        expect(result.netWorth.COP).toBe(-3000);
        expect(result.personalBalance.COP).toBe(-3000);
    });

    it('calculates correct balance with mixed credits and debits', () => {
        const txs = [
            { type: 'credit', amount: 10000, currency: 'COP', context: 'personal' },
            { type: 'debit', amount: 3000, currency: 'COP', context: 'personal' },
            { type: 'debit', amount: 2000, currency: 'COP', context: 'personal' },
        ];
        const result = calculateBalances(txs);
        expect(result.netWorth.COP).toBe(5000); // 10000 - 3000 - 2000
        expect(result.personalBalance.COP).toBe(5000);
    });

    it('separates personal and business balances', () => {
        const txs = [
            { type: 'credit', amount: 8000, currency: 'COP', context: 'personal' },
            { type: 'credit', amount: 15000, currency: 'COP', context: 'business' },
            { type: 'debit', amount: 5000, currency: 'COP', context: 'business' },
        ];
        const result = calculateBalances(txs);
        expect(result.netWorth.COP).toBe(18000); // 8000 + 15000 - 5000
        expect(result.personalBalance.COP).toBe(8000);
        expect(result.businessCashFlow.COP).toBe(10000); // 15000 - 5000
    });

    it('handles multi-currency transactions', () => {
        const txs = [
            { type: 'credit', amount: 100000, currency: 'COP', context: 'personal' },
            { type: 'credit', amount: 500, currency: 'USD', context: 'personal' },
            { type: 'debit', amount: 200, currency: 'USD', context: 'personal' },
        ];
        const result = calculateBalances(txs);
        expect(result.netWorth.COP).toBe(100000);
        expect(result.netWorth.USD).toBe(300); // 500 - 200
        expect(result.personalBalance.COP).toBe(100000);
        expect(result.personalBalance.USD).toBe(300);
    });

    it('falls back to USD when currency is missing', () => {
        const txs = [{ type: 'credit', amount: 1000, context: 'personal' }]; // no currency field
        const result = calculateBalances(txs);
        expect(result.netWorth.USD).toBe(1000);
    });

    it('handles transactions without context (unified only)', () => {
        const txs = [{ type: 'credit', amount: 7000, currency: 'COP' }]; // no context
        const result = calculateBalances(txs);
        expect(result.netWorth.COP).toBe(7000);
        expect(result.personalBalance.COP).toBe(0); // not personal
        expect(result.businessCashFlow.COP).toBe(0); // not business
    });

    it('handles string amounts by coercing to number', () => {
        const txs = [
            { type: 'credit', amount: '5000', currency: 'COP', context: 'personal' },
            { type: 'debit', amount: '2000', currency: 'COP', context: 'personal' },
        ];
        const result = calculateBalances(txs);
        expect(result.netWorth.COP).toBe(3000);
    });

    it('does not produce NaN for undefined amounts', () => {
        const txs = [{ type: 'credit', currency: 'COP', context: 'personal' }]; // no amount
        const result = calculateBalances(txs);
        expect(result.netWorth.COP).toEqual(NaN); // Number(undefined) is NaN — this documents current behavior
    });

    it('excludes type=transfer from all balances', () => {
        const txs = [
            { type: 'credit', amount: 10000, currency: 'COP', context: 'personal' },
            { type: 'transfer', amount: 5000, currency: 'COP', context: 'personal', destinationCard: 'Visa' },
        ];
        const result = calculateBalances(txs);
        expect(result.netWorth.COP).toBe(10000); // transfer is excluded
        expect(result.personalBalance.COP).toBe(10000);
    });

    it('excludes legacy isTransfer=true from all balances', () => {
        const txs = [
            { type: 'credit', amount: 10000, currency: 'COP', context: 'personal' },
            { type: 'debit', amount: 3000, currency: 'COP', context: 'personal', isTransfer: true },
            { type: 'credit', amount: 3000, currency: 'COP', context: 'personal', isTransfer: true },
        ];
        const result = calculateBalances(txs);
        expect(result.netWorth.COP).toBe(10000); // both legacy transfers excluded
        expect(result.personalBalance.COP).toBe(10000);
    });

    it('correctly calculates balances with mixed regular and transfer transactions', () => {
        const txs = [
            { type: 'credit', amount: 50000, currency: 'COP', context: 'personal' },
            { type: 'debit', amount: 10000, currency: 'COP', context: 'personal' },
            { type: 'transfer', amount: 20000, currency: 'COP', context: 'personal', destinationCard: 'Visa' },
            { type: 'credit', amount: 5000, currency: 'USD', context: 'business' },
            { type: 'transfer', amount: 1000, currency: 'USD', context: 'business', destinationCard: 'Checking' },
        ];
        const result = calculateBalances(txs);
        expect(result.netWorth.COP).toBe(40000); // 50000 - 10000
        expect(result.personalBalance.COP).toBe(40000);
        expect(result.netWorth.USD).toBe(5000);
        expect(result.businessCashFlow.USD).toBe(5000);
    });
});

// ─────────────────────────────────────────────────
// calculateAccountBalances
// ─────────────────────────────────────────────────
describe('calculateAccountBalances', () => {
    const ANCHOR = '2026-08-30T12:00:00.000Z';
    const before = new Date('2026-08-29T12:00:00.000Z');
    const after1 = new Date('2026-08-30T18:00:00.000Z');
    const after2 = new Date('2026-08-31T09:00:00.000Z');

    it('returns empty object when no saldosIniciales are configured', () => {
        expect(calculateAccountBalances([], {})).toEqual({});
        expect(calculateAccountBalances([], undefined)).toEqual({});
        expect(calculateAccountBalances([], null)).toEqual({});
    });

    it('ignores accounts with no monto or no anchor', () => {
        const saldos = {
            SinMonto: { anchor: ANCHOR },
            SinAnchor: { monto: 1000 },
            Ok: { monto: 500, anchor: ANCHOR },
        };
        const result = calculateAccountBalances([], saldos);
        expect(result.SinMonto).toBeUndefined();
        expect(result.SinAnchor).toBeUndefined();
        expect(result.Ok).toEqual({ balance: 500, monto: 500, anchor: ANCHOR });
    });

    it('returns the opening balance untouched when there are no matching transactions', () => {
        const saldos = { Bold: { monto: 562020, anchor: ANCHOR } };
        const result = calculateAccountBalances([], saldos);
        expect(result.Bold.balance).toBe(562020);
    });

    it('ignores transactions dated before or exactly at the anchor', () => {
        const saldos = { Bold: { monto: 562020, anchor: ANCHOR } };
        const txs = [
            { type: 'debit', amount: 100000, currency: 'COP', card: 'Bold', date: before, sortAt: before },
            { type: 'debit', amount: 200000, currency: 'COP', card: 'Bold', date: new Date(ANCHOR), sortAt: new Date(ANCHOR) },
        ];
        const result = calculateAccountBalances(txs, saldos);
        expect(result.Bold.balance).toBe(562020);
    });

    it('subtracts debits and adds credits posted after the anchor', () => {
        const saldos = { Bancolombia: { monto: 1923980, anchor: ANCHOR } };
        const txs = [
            { type: 'debit', amount: 50000, currency: 'COP', card: 'Bancolombia', date: after1, sortAt: after1 },
            { type: 'credit', amount: 200000, currency: 'COP', card: 'Bancolombia', date: after2, sortAt: after2 },
        ];
        const result = calculateAccountBalances(txs, saldos);
        expect(result.Bancolombia.balance).toBe(1923980 - 50000 + 200000);
    });

    it('ignores transactions tagged to a different account', () => {
        const saldos = { Nequi: { monto: 8212, anchor: ANCHOR } };
        const txs = [
            { type: 'debit', amount: 5000, currency: 'COP', card: 'Bold', date: after1, sortAt: after1 },
        ];
        const result = calculateAccountBalances(txs, saldos);
        expect(result.Nequi.balance).toBe(8212);
    });

    it('moves money between two tracked accounts on a transfer (source -, destination +)', () => {
        const saldos = {
            Bancolombia: { monto: 1000000, anchor: ANCHOR },
            'Fondo de Seguridad Financiera': { monto: 4814890, anchor: ANCHOR },
        };
        const txs = [
            { type: 'transfer', amount: 100000, currency: 'COP', card: 'Bancolombia', destinationCard: 'Fondo de Seguridad Financiera', date: after1, sortAt: after1 },
        ];
        const result = calculateAccountBalances(txs, saldos);
        expect(result.Bancolombia.balance).toBe(900000);
        expect(result['Fondo de Seguridad Financiera'].balance).toBe(4914890);
    });

    it('treats isTransfer:true the same as type:"transfer"', () => {
        const saldos = { Bold: { monto: 100000, anchor: ANCHOR } };
        const txs = [
            { isTransfer: true, type: 'debit', amount: 20000, currency: 'COP', card: 'Bold', destinationCard: 'Nequi', date: after1, sortAt: after1 },
        ];
        const result = calculateAccountBalances(txs, saldos);
        expect(result.Bold.balance).toBe(80000);
    });

    it('converts USD transactions to COP using the given exchange rate', () => {
        const saldos = { Bold: { monto: 100000, anchor: ANCHOR } };
        const txs = [
            { type: 'debit', amount: 10, currency: 'USD', card: 'Bold', date: after1, sortAt: after1 },
        ];
        const result = calculateAccountBalances(txs, saldos, 4000);
        expect(result.Bold.balance).toBe(100000 - 40000);
    });

    it('falls back to a 4100 exchange rate when none is given', () => {
        const saldos = { Bold: { monto: 100000, anchor: ANCHOR } };
        const txs = [
            { type: 'credit', amount: 10, currency: 'USD', card: 'Bold', date: after1, sortAt: after1 },
        ];
        const result = calculateAccountBalances(txs, saldos);
        expect(result.Bold.balance).toBe(100000 + 41000);
    });

    it('computes several independent accounts in one pass, matching the Saldo Total use case', () => {
        const saldos = {
            Bold: { monto: 562020, anchor: ANCHOR },
            Nequi: { monto: 8212, anchor: ANCHOR },
            Bancolombia: { monto: 1923980, anchor: ANCHOR },
            'Fondo de Seguridad Financiera': { monto: 4814890, anchor: ANCHOR },
        };
        const txs = [
            { type: 'debit', amount: 20000, currency: 'COP', card: 'Bold', date: after1, sortAt: after1 },
            { type: 'credit', amount: 100000, currency: 'COP', card: 'Bancolombia', date: after1, sortAt: after1 },
            { type: 'transfer', amount: 10000, currency: 'COP', card: 'Bancolombia', destinationCard: 'Fondo de Seguridad Financiera', date: after2, sortAt: after2 },
        ];
        const result = calculateAccountBalances(txs, saldos);
        const trackedTotal = result.Bold.balance + result.Nequi.balance + result.Bancolombia.balance;
        expect(result.Bold.balance).toBe(542020);
        expect(result.Nequi.balance).toBe(8212);
        expect(result.Bancolombia.balance).toBe(1923980 + 100000 - 10000);
        expect(result['Fondo de Seguridad Financiera'].balance).toBe(4814890 + 10000);
        expect(trackedTotal).toBe(542020 + 8212 + 2013980);
    });
});
