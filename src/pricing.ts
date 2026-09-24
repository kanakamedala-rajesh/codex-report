import fs from 'node:fs';
import path from 'node:path';
import { Sample } from './types';
import { object, readJson, writeJson } from './util';
export interface Rate {
  input: string;
  cached: string;
  write: string;
  output: string;
  source: string;
  threshold?: number;
  inputMultiplier?: string;
  outputMultiplier?: string;
  expires?: string;
}
export interface PriceTable {
  schema: 1;
  asOf: string;
  models: Record<string, Rate>;
  aliases: Record<string, string>;
}
export function validatePrices(v: unknown): PriceTable {
  const p = object(v);
  if (p.schema !== 1 || typeof p.asOf !== 'string' || !p.models || !p.aliases)
    throw new Error('Invalid price table.');
  for (const [name, value] of Object.entries(object(p.models))) {
    if (!/^[\w./-]{1,120}$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name))
      throw new Error('Invalid model name.');
    const r = object(value);
    for (const key of ['input', 'cached', 'write', 'output'])
      if (typeof r[key] !== 'string' || !/^\d{1,6}(\.\d{1,6})?$/.test(String(r[key])))
        throw new Error(
          'Prices must be nonnegative decimal strings with at most six decimal places.',
        );
    if (typeof r.source !== 'string') throw new Error('Price source required.');
    if (
      r.threshold !== undefined &&
      (!Number.isSafeInteger(r.threshold) || Number(r.threshold) < 1)
    )
      throw new Error('Invalid context threshold.');
    for (const key of ['inputMultiplier', 'outputMultiplier'])
      if (r[key] !== undefined && !/^\d{1,3}(\.\d{1,6})?$/.test(String(r[key])))
        throw new Error('Invalid multiplier.');
    if (r.expires !== undefined && !Number.isFinite(Date.parse(String(r.expires))))
      throw new Error('Invalid price expiry.');
  }
  for (const [alias, target] of Object.entries(object(p.aliases)))
    if (
      !/^[\w./-]{1,120}$/.test(alias) ||
      ['__proto__', 'constructor', 'prototype'].includes(alias) ||
      typeof target !== 'string' ||
      !Object.hasOwn(object(p.models), target)
    )
      throw new Error('Alias must reference an exact priced model.');
  return p as unknown as PriceTable;
}
export function loadPrices(home: string): PriceTable {
  const local = path.join(home, 'prices.json');
  return validatePrices(
    readJson(fs.existsSync(local) ? local : path.resolve(__dirname, '../data/prices.json')),
  );
}
export function initializePrices(home: string): void {
  if (!fs.existsSync(path.join(home, 'prices.json')))
    writeJson(path.join(home, 'prices.json'), loadPrices(home));
}
function micros(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
}
export function priceSample(
  sample: Sample,
  prices: PriceTable,
  basis: 'standard' | 'recorded',
): Sample {
  const s = { ...sample };
  s.pricePico = null;
  s.priceSnapshot = null;
  if (s.priceReason === 'ambiguous_request_boundaries') return s;
  const model = Object.hasOwn(prices.aliases, s.model)
    ? (prices.aliases[s.model] ?? s.model)
    : s.model;
  const r = Object.hasOwn(prices.models, model) ? prices.models[model] : undefined;
  if (!r) {
    s.priceReason = 'unlisted_model';
    return s;
  }
  if (basis === 'recorded' && !['default', 'standard'].includes(s.tier)) {
    s.priceReason = 'unpriced_service_tier';
    return s;
  }
  if (r.expires && Date.parse(s.at) > Date.parse(r.expires)) {
    s.priceReason = 'price_review_required';
    return s;
  }
  const ordinary = s.input - s.cached - s.write;
  let input =
    BigInt(ordinary) * micros(r.input) +
    BigInt(s.cached) * micros(r.cached) +
    BigInt(s.write) * micros(r.write);
  let output = BigInt(s.output) * micros(r.output);
  if (r.threshold && s.input > r.threshold) {
    input = (input * micros(r.inputMultiplier ?? '1')) / 1000000n;
    output = (output * micros(r.outputMultiplier ?? '1')) / 1000000n;
  }
  s.pricePico = String(input + output);
  s.priceReason = null;
  s.priceSnapshot = JSON.stringify({ asOf: prices.asOf, model, basis, rate: r });
  return s;
}
export function dollars(pico: string | bigint | null): string {
  if (pico === null) return 'unpriced';
  const p = BigInt(pico);
  const cents = (p + 5000000000n) / 10000000000n;
  return `$${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
