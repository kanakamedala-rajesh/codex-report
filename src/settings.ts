import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  Account,
  Config,
  DashboardPreferences,
  dashboardPreferences,
  loadConfig,
  saveConfig,
  validateConfig,
  validLabel,
} from './config';
import { hash, object, privateDir, exclusiveOutput } from './util';

const ACCOUNT_KEYS = [
  'billingDay',
  'billingTime',
  'timezone',
  'monthlyUsd',
  'currency',
  'subscriptionAmount',
  'localPerUsd',
] as const;
export interface EditableSettings {
  dashboard: DashboardPreferences;
  timezone: string;
  reportAccount: string;
  display: Config['display'];
  accounts: Record<string, Account>;
}
export interface SettingsSnapshot {
  revision: string;
  values: EditableSettings;
}
export class SettingsError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'SettingsError';
  }
}
function strictObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SettingsError(`${name} must be an object.`);
  return object(value);
}
function keysOnly(value: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new SettingsError(`Setting is not editable: ${key}.`);
}
export function settingsRevision(config: Config): string {
  return hash(JSON.stringify(config));
}
/** An explicit allowlist: never return tokens, source paths, or private device identifiers. */
export function settingsSnapshot(config: Config): SettingsSnapshot {
  const accounts: Record<string, Account> = Object.create(null) as Record<string, Account>;
  for (const [label, value] of Object.entries(config.accounts)) {
    const a: Account = {};
    for (const key of ACCOUNT_KEYS)
      if (value[key] !== undefined) Object.assign(a, { [key]: value[key] });
    accounts[label] = a;
  }
  return {
    revision: settingsRevision(config),
    values: {
      dashboard: dashboardPreferences(config),
      timezone: config.timezone,
      reportAccount: config.reportAccount,
      display: config.display,
      accounts,
    },
  };
}
/** Validates a partial update without modifying either the config or the ledger. */
export function settingsUpdate(config: Config, input: unknown): Config {
  const request = strictObject(input, 'Request');
  keysOnly(request, ['revision', 'changes']);
  if (typeof request.revision !== 'string' || request.revision !== settingsRevision(config))
    throw new SettingsError(
      'Settings changed in another window. Reload settings before saving.',
      409,
    );
  const changes = strictObject(request.changes, 'changes');
  keysOnly(changes, [
    'dashboard',
    'timezone',
    'reportAccount',
    'display',
    'accounts',
    'sessionNames',
  ]);
  // Clone so a rejected update cannot affect a running collector.
  const next = JSON.parse(JSON.stringify(config)) as Config;
  for (const key of ['timezone', 'reportAccount', 'display'] as const)
    if (key in changes) Object.assign(next, { [key]: changes[key] });
  if ('dashboard' in changes) {
    const d = strictObject(changes.dashboard, 'dashboard');
    keysOnly(d, ['theme', 'defaultView', 'defaultPeriod', 'defaultModel', 'sessionsPerPage']);
    next.dashboard = { ...dashboardPreferences(config), ...d } as DashboardPreferences;
  }
  if ('accounts' in changes) {
    const accounts = strictObject(changes.accounts, 'accounts');
    if (Object.keys(accounts).length > 128)
      throw new SettingsError('Too many accounts in one update.');
    for (const [label, value] of Object.entries(accounts)) {
      if (!validLabel(label)) throw new SettingsError('Invalid account label.');
      const update = strictObject(value, 'Account settings');
      keysOnly(update, ACCOUNT_KEYS);
      const a = { ...next.accounts[label] };
      for (const key of ACCOUNT_KEYS) {
        if (update[key] === null) delete a[key];
        else if (key in update) Object.assign(a, { [key]: update[key] });
      }
      if (a.currency !== undefined && !/^[A-Z]{3}$/.test(a.currency))
        throw new SettingsError('Currency must be a three-letter code, such as USD or INR.');
      if (a.timezone !== undefined && typeof a.timezone !== 'string')
        throw new SettingsError('Account timezone must be a string.');
      if (a.billingTime !== undefined && typeof a.billingTime !== 'string')
        throw new SettingsError('Billing time must be a string.');
      if (
        a.monthlyUsd !== undefined &&
        (a.subscriptionAmount !== undefined || a.localPerUsd !== undefined)
      )
        throw new SettingsError('Choose a USD fee or a local-currency fee, not both.');
      if ((a.subscriptionAmount === undefined) !== (a.localPerUsd === undefined))
        throw new SettingsError('Local-currency comparison needs both a fee and units per USD.');
      next.accounts[label] = a;
    }
  }
  if ('sessionNames' in changes) {
    const names = strictObject(changes.sessionNames, 'sessionNames');
    if (Object.keys(names).length > 1) throw new SettingsError('Rename one session at a time.');
    next.sessionNames = { ...next.sessionNames };
    for (const [id, name] of Object.entries(names)) {
      if (
        !/^[a-zA-Z0-9._-]{1,240}$/.test(id) ||
        ['__proto__', 'constructor', 'prototype'].includes(id)
      )
        throw new SettingsError('Invalid session identifier.');
      if (name === null || name === '') delete next.sessionNames[id];
      else {
        if (typeof name !== 'string') throw new SettingsError('Session name must be text.');
        next.sessionNames[id] = name.trim();
      }
    }
  }
  try {
    return validateConfig(next);
  } catch (e) {
    throw new SettingsError(e instanceof Error ? e.message : 'Invalid settings.');
  }
}
export function saveSettings(home: string, input: unknown): Config {
  const config = loadConfig(home);
  const next = settingsUpdate(config, input);
  if (settingsRevision(next) === settingsRevision(config)) return next;
  const dir = path.join(home, 'backups');
  privateDir(dir);
  exclusiveOutput(
    path.join(dir, `settings-${crypto.randomUUID()}.json`),
    fs.readFileSync(path.join(home, 'config.json'), 'utf8'),
  );
  saveConfig(home, next);
  return next;
}
