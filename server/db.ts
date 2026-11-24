import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'sitamu.db');
export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS visits (
    id TEXT PRIMARY KEY,
    queue_number INTEGER NOT NULL,
    queue_code TEXT NOT NULL,
    visit_date TEXT NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    visitor_category TEXT NOT NULL,
    institution_address TEXT NOT NULL,
    department TEXT NOT NULL,
    official_name TEXT,
    purpose TEXT NOT NULL,
    signature_data TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Sedang Berkunjung',
    check_in_at TEXT NOT NULL,
    check_out_at TEXT,
    checkout_token_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_visits_date ON visits (visit_date);
  CREATE INDEX IF NOT EXISTS idx_visits_department ON visits (department);
  CREATE INDEX IF NOT EXISTS idx_visits_status ON visits (status);
  CREATE INDEX IF NOT EXISTS idx_visits_check_in ON visits (check_in_at DESC);

  CREATE TABLE IF NOT EXISTS daily_counters (
    visit_date TEXT PRIMARY KEY,
    last_number INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL,
    department TEXT NOT NULL DEFAULT 'Semua Bidang',
    password_hash TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

  CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_username TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);
`);

// Seed default reference master departments once if empty
const deptCountRow = db.prepare('SELECT COUNT(*) as total FROM departments').get() as {
  total: number;
};
if ((deptCountRow?.total ?? 0) === 0) {
  const defaultDepartments = [
    'Kepala Pelaksana',
    'Sekretariat',
    'Bidang Pencegahan & Kesiapsiagaan',
    'Bidang Kedaruratan & Logistik',
    'Bidang Rehabilitasi & Rekonstruksi',
  ];
  const insertDept = db.prepare(
    'INSERT INTO departments (id, name, is_active, sort_order, created_at) VALUES (?, ?, 1, ?, ?)',
  );
  const now = Date.now();
  defaultDepartments.forEach((name, idx) => {
    insertDept.run(crypto.randomUUID(), name, idx + 1, now);
  });
}

export interface VisitRow {
  id: string;
  queue_number: number;
  queue_code: string;
  visit_date: string;
  full_name: string;
  phone: string;
  visitor_category: string;
  institution_address: string;
  department: string;
  official_name: string | null;
  purpose: string;
  signature_data: string;
  status: string;
  check_in_at: string;
  check_out_at: string | null;
  checkout_token_hash: string;
  created_at: number;
}

export interface UserRow {
  id: string;
  username: string;
  full_name: string;
  role: 'super_admin' | 'resepsionis' | 'pimpinan';
  department: string;
  password_hash: string;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface DepartmentRow {
  id: string;
  name: string;
  is_active: number;
  sort_order: number;
  created_at: number;
}

export interface AuditLogRow {
  id: string;
  actor_username: string;
  actor_role: string;
  action: string;
  target: string;
  details: string;
  created_at: number;
}

export function getWibDateString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

export function getWibMonthPrefix(date: Date = new Date()): string {
  return getWibDateString(date).slice(0, 7);
}

export function mapVisitRow(row: VisitRow) {
  return {
    id: row.id,
    queueNumber: row.queue_number,
    queueCode: row.queue_code,
    visitDate: row.visit_date,
    fullName: row.full_name,
    phone: row.phone,
    visitorCategory: row.visitor_category,
    institutionAddress: row.institution_address,
    department: row.department,
    purpose: row.purpose,
    signatureData: row.signature_data,
    status: row.status,
    checkInAt: row.check_in_at,
    checkOutAt: row.check_out_at,
  };
}

export function recordAuditLog(
  actorUsername: string,
  actorRole: string,
  action: string,
  target: string,
  details: string,
): void {
  try {
    db.prepare(
      'INSERT INTO audit_logs (id, actor_username, actor_role, action, target, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      crypto.randomUUID(),
      actorUsername,
      actorRole,
      action,
      target,
      details.slice(0, 300),
      Date.now(),
    );
  } catch (err) {
    console.error('Failed to record audit log:', err);
  }
}
