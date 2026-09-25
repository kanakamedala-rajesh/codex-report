import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { object, readJson, writeJson, privateDir, clean } from './util';
export interface Account {
  billingDay?: number;
  billingTime?: string;
  timezone?: string;
  monthlyUsd?: number;
  currency?: string;
  subscriptionAmount?: number;
  localPerUsd?: number;
}
export interface Source {
  name: string;
  path: string;
  account: string;
  kind: 'codex-home' | 'rollouts';
}
export interface DashboardPreferences {
  theme: 'dark' | 'light' | 'system';
  defaultView: 'overview' | 'sessions' | 'limits' | 'health';
  defaultPeriod: 'cycle' | '5h' | 'day' | 'week' | 'lifetime';
  defaultModel: string;
  sessionsPerPage: 10 | 20 | 50;
}
export const DASHBOARD_DEFAULTS: DashboardPreferences = {
  theme: 'dark',
  defaultView: 'overview',
  defaultPeriod: 'cycle',
  defaultModel: '',
  sessionsPerPage: 20,
};
export function dashboardPreferences(config: Config): DashboardPreferences {
  return { ...DASHBOARD_DEFAULTS, ...config.dashboard };
}
export interface Config {
  schema: 1;
  deviceId: string;
  token: string;
  port: number;
  pollMs: number;
  timezone: string;
  display: 'compact' | 'detailed' | 'quiet';
  sources: Source[];
  accounts: Record<string, Account>;
  reportAccount: string;
  priceBasis: 'standard' | 'recorded';
  maxFileMb: number;
  dashboard?: DashboardPreferences;
  sessionNames?: Record<string, string>;
}
export function validLabel(label: string): boolean {
  return (
    /^[\w.-]{1,80}$/.test(label) &&
    !['all', '__proto__', 'prototype', 'constructor'].includes(label)
  );
}
export function validateConfig(input: unknown): Config {
  const c = object(input);
  if (
    c.schema !== 1 ||
    typeof c.deviceId !== 'string' ||
    typeof c.token !== 'string' ||
    c.token.length < 32
  )
    throw new Error('Unsupported or invalid configuration.');
  if (!Number.isInteger(c.port) || Number(c.port) < 0 || Number(c.port) > 65535)
    throw new Error('Port must be 0..65535.');
  if (!Number.isInteger(c.pollMs) || Number(c.pollMs) < 500 || Number(c.pollMs) > 60000)
    throw new Error('pollMs must be 500..60000.');
  if (!['compact', 'detailed', 'quiet'].includes(String(c.display)))
    throw new Error('Invalid display mode.');
  if (!['standard', 'recorded'].includes(String(c.priceBasis)))
    throw new Error('Invalid price basis.');
  if (typeof c.timezone !== 'string') throw new Error('Timezone required.');
  new Intl.DateTimeFormat('en', { timeZone: c.timezone }).format();
  if (!Array.isArray(c.sources) || c.sources.length > 64) throw new Error('Invalid sources.');
  const seen = new Set<string>();
  for (const entry of c.sources) {
    const s = object(entry);
    if (
      typeof s.name !== 'string' ||
      !/^[\w-]{1,64}$/.test(s.name) ||
      seen.has(s.name) ||
      typeof s.path !== 'string' ||
      !path.isAbsolute(s.path) ||
      typeof s.account !== 'string' ||
      !validLabel(s.account) ||
      !['codex-home', 'rollouts'].includes(String(s.kind))
    )
      throw new Error('Invalid source configuration.');
    seen.add(s.name);
  }
  if (!Number.isInteger(c.maxFileMb) || Number(c.maxFileMb) < 1 || Number(c.maxFileMb) > 2048)
    throw new Error('maxFileMb must be 1..2048.');
  if (!c.accounts || typeof c.accounts !== 'object' || Array.isArray(c.accounts))
    throw new Error('Invalid accounts.');
  if (
    c.reportAccount !== 'all' &&
    (typeof c.reportAccount !== 'string' || !validLabel(c.reportAccount))
  )
    throw new Error('Invalid report account.');
  for (const [label, value] of Object.entries(object(c.accounts))) {
    if (!validLabel(label)) throw new Error('Invalid account label.');
    const a = object(value);
    if (
      a.billingDay !== undefined &&
      (!Number.isInteger(a.billingDay) || Number(a.billingDay) < 1 || Number(a.billingDay) > 31)
    )
      throw new Error('Billing day must be 1..31.');
    if (a.billingTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(a.billingTime)))
      throw new Error('Billing time must be HH:MM.');
    if (a.timezone !== undefined)
      new Intl.DateTimeFormat('en', { timeZone: String(a.timezone) }).format();
    for (const k of ['monthlyUsd', 'subscriptionAmount', 'localPerUsd']) {
      if (
        a[k] !== undefined &&
        (typeof a[k] !== 'number' || !Number.isFinite(a[k]) || Number(a[k]) <= 0)
      )
        throw new Error(`Invalid ${k}.`);
    }
  }
  if (c.dashboard !== undefined) {
    const d = object(c.dashboard);
    if (
      typeof d.theme !== 'string' ||
      !['dark', 'light', 'system'].includes(d.theme) ||
      typeof d.defaultView !== 'string' ||
      !['overview', 'sessions', 'limits', 'health'].includes(d.defaultView) ||
      typeof d.defaultPeriod !== 'string' ||
      !['cycle', '5h', 'day', 'week', 'lifetime'].includes(d.defaultPeriod) ||
      typeof d.defaultModel !== 'string' ||
      d.defaultModel.length > 240 ||
      clean(d.defaultModel, 240) !== d.defaultModel ||
      ![10, 20, 50].includes(Number(d.sessionsPerPage)) ||
      typeof d.sessionsPerPage !== 'number'
    )
      throw new Error('Invalid dashboard preferences.');
  }
  if (c.sessionNames !== undefined) {
    if (!c.sessionNames || typeof c.sessionNames !== 'object' || Array.isArray(c.sessionNames))
      throw new Error('Invalid session names.');
    const names = Object.entries(object(c.sessionNames));
    if (names.length > 2000) throw new Error('Too many local session names.');
    for (const [id, name] of names) {
      if (
        !/^[a-zA-Z0-9._-]{1,240}$/.test(id) ||
        ['__proto__', 'constructor', 'prototype'].includes(id) ||
        typeof name !== 'string' ||
        !name.trim() ||
        name.length > 120 ||
        name !== name.trim() ||
        clean(name, 120) !== name
      )
        throw new Error('Session names must be 1..120 characters on one line.');
    }
  }
  return c as unknown as Config;
}
export function loadConfig(home: string): Config {
  const file = path.join(home, 'config.json');
  if (!fs.existsSync(file)) throw new Error('Not initialized. Run codex-report init first.');
  return validateConfig(readJson(file));
}
export function saveConfig(home: string, config: Config): void {
  writeJson(path.join(home, 'config.json'), validateConfig(config));
}
export function initializeConfig(
  home: string,
  codexHome?: string,
  account = 'unattributed',
): Config {
  privateDir(home);
  const file = path.join(home, 'config.json');
  if (fs.existsSync(file)) return loadConfig(home);
  const config: Config = {
    schema: 1,
    deviceId: crypto.randomUUID(),
    token: crypto.randomBytes(32).toString('hex'),
    port: 47831,
    pollMs: 2000,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    display: 'compact',
    sources: [
      {
        name: 'primary',
        path: path.resolve(
          codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'),
        ),
        account,
        kind: 'codex-home',
      },
    ],
    accounts: {},
    reportAccount: 'all',
    priceBasis: 'standard',
    maxFileMb: 256,
    dashboard: { ...DASHBOARD_DEFAULTS },
    sessionNames: {},
  };
  saveConfig(home, config);
  return config;
}
