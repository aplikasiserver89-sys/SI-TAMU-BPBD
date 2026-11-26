import crypto from 'node:crypto';
import {
  db,
  getWibDateString,
  mapVisitRow,
  recordAuditLog as recordSqliteAuditLog,
  type AuditLogRow,
  type DepartmentRow,
  type PasswordResetRequestRow,
  type UserRow,
  type VisitRow,
} from './db.ts';
import { getSupabase, isSupabaseEnabled } from './supabase.ts';

export type StorageBackend = 'supabase' | 'sqlite';

export function getActiveStorageBackend(): StorageBackend {
  return isSupabaseEnabled() ? 'supabase' : 'sqlite';
}

function escapeIlikeLiteral(value: string): string {
  return value.replace(/([%_\\])/g, '\\$1');
}

function sanitizePostgrestSearchTerm(value: string): string {
  return value.replace(/[,().%_*\\]/g, ' ').trim().slice(0, 100);
}

// ============================================================================
// Auth & User Repository
// ============================================================================

export async function getUserCount(): Promise<number> {
  if (isSupabaseEnabled()) {
    const { count, error } = await getSupabase()
      .from('users')
      .select('id', { count: 'exact', head: true });
    if (error) {
      console.error('Supabase getUserCount error:', error);
      throw new Error('Gagal memeriksa akun pengguna.', { cause: error });
    }
    return count ?? 0;
  }

  const row = db.prepare('SELECT COUNT(*) as total FROM users').get() as { total: number };
  return row?.total ?? 0;
}

export async function getAdminConfigValue(key: string): Promise<string | null> {
  if (isSupabaseEnabled()) {
    const { data, error } = await getSupabase()
      .from('admin_config')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error) {
      console.error('Supabase getAdminConfigValue error:', error);
      throw new Error('Gagal membaca konfigurasi sistem.', { cause: error });
    }
    return data?.value ?? null;
  }

  const row = db
    .prepare('SELECT value FROM admin_config WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export async function findUserByUsernameInsensitive(username: string): Promise<UserRow | null> {
  const clean = username.trim();
  if (!clean) return null;

  if (isSupabaseEnabled()) {
    const { data, error } = await getSupabase()
      .from('users')
      .select('*')
      .ilike('username', escapeIlikeLiteral(clean));
    if (error) {
      console.error('Supabase findUserByUsername error:', error);
      throw new Error('Gagal memverifikasi akun pengguna.', { cause: error });
    }
    const exact = (data as UserRow[] | null)?.find(
      (u) => u.username.toLowerCase() === clean.toLowerCase(),
    );
    return exact ?? null;
  }

  const row = db
    .prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)')
    .get(clean) as unknown as UserRow | undefined;
  return row ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  if (!id) return null;

  if (isSupabaseEnabled()) {
    const { data, error } = await getSupabase()
      .from('users')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      console.error('Supabase findUserById error:', error);
      throw new Error('Gagal memuat data pengguna.', { cause: error });
    }
    return (data as UserRow | null) ?? null;
  }

  const row = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(id) as unknown as UserRow | undefined;
  return row ?? null;
}

export async function bootstrapSuperAdmin(input: {
  id: string;
  username: string;
  fullName: string;
  passwordHash: string;
  now: number;
}): Promise<'ok' | 'already_configured'> {
  if (isSupabaseEnabled()) {
    const existingCount = await getUserCount();
    if (existingCount > 0) {
      return 'already_configured';
    }
    const { error } = await getSupabase().from('users').insert({
      id: input.id,
      username: input.username,
      full_name: input.fullName,
      role: 'super_admin',
      department: 'Semua Bidang',
      password_hash: input.passwordHash,
      is_active: 1,
      created_at: input.now,
      updated_at: input.now,
    });
    if (error) {
      console.error('Supabase bootstrapSuperAdmin error:', error);
      throw new Error('Gagal menyimpan akun Super Admin.', { cause: error });
    }
    return 'ok';
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const userCount = db.prepare('SELECT COUNT(*) as total FROM users').get() as { total: number };
    if ((userCount?.total ?? 0) > 0) {
      db.exec('ROLLBACK');
      return 'already_configured';
    }

    db.prepare(
      `INSERT INTO users (id, username, full_name, role, department, password_hash, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'super_admin', 'Semua Bidang', ?, 1, ?, ?)`,
    ).run(input.id, input.username, input.fullName, input.passwordHash, input.now, input.now);

    db.exec('COMMIT');
    return 'ok';
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    throw err;
  }
}

export async function listUsers(): Promise<UserRow[]> {
  if (isSupabaseEnabled()) {
    const { data, error } = await getSupabase()
      .from('users')
      .select('id, username, full_name, role, department, is_active, created_at, updated_at')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Supabase listUsers error:', error);
      throw new Error('Gagal memuat daftar akun pengguna.', { cause: error });
    }
    return ((data ?? []) as Omit<UserRow, 'password_hash'>[]).map((u) => ({
      ...u,
      password_hash: '',
    }));
  }

  return db
    .prepare(
      'SELECT id, username, full_name, role, department, is_active, created_at, updated_at FROM users ORDER BY created_at DESC',
    )
    .all() as unknown as UserRow[];
}

export async function createUser(input: {
  id: string;
  username: string;
  fullName: string;
  role: 'super_admin' | 'resepsionis' | 'pimpinan';
  department: string;
  passwordHash: string;
  now: number;
}): Promise<void> {
  if (isSupabaseEnabled()) {
    const { error } = await getSupabase().from('users').insert({
      id: input.id,
      username: input.username,
      full_name: input.fullName,
      role: input.role,
      department: input.department,
      password_hash: input.passwordHash,
      is_active: 1,
      created_at: input.now,
      updated_at: input.now,
    });
    if (error) {
      console.error('Supabase createUser error:', error);
      throw new Error('Gagal membuat akun pengguna baru.', { cause: error });
    }
    return;
  }

  db.prepare(
    `INSERT INTO users (id, username, full_name, role, department, password_hash, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    input.id,
    input.username,
    input.fullName,
    input.role,
    input.department,
    input.passwordHash,
    input.now,
    input.now,
  );
}

export async function countOtherActiveSuperAdmins(excludeUserId: string): Promise<number> {
  if (isSupabaseEnabled()) {
    const { count, error } = await getSupabase()
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'super_admin')
      .eq('is_active', 1)
      .neq('id', excludeUserId);
    if (error) {
      console.error('Supabase countOtherActiveSuperAdmins error:', error);
      throw new Error('Gagal memvalidasi akun Super Admin aktif.', { cause: error });
    }
    return count ?? 0;
  }

  const row = db
    .prepare("SELECT COUNT(*) as total FROM users WHERE role = 'super_admin' AND is_active = 1 AND id != ?")
    .get(excludeUserId) as { total: number };
  return row?.total ?? 0;
}

export async function updateUser(
  id: string,
  updates: {
    role: 'super_admin' | 'resepsionis' | 'pimpinan';
    department: string;
    isActive: number;
    passwordHash: string;
    now: number;
  },
): Promise<void> {
  if (isSupabaseEnabled()) {
    const { error } = await getSupabase()
      .from('users')
      .update({
        role: updates.role,
        department: updates.department,
        is_active: updates.isActive,
        password_hash: updates.passwordHash,
        updated_at: updates.now,
      })
      .eq('id', id);
    if (error) {
      console.error('Supabase updateUser error:', error);
      throw new Error('Gagal memperbarui akun pengguna.', { cause: error });
    }
    return;
  }

  db.prepare(
    'UPDATE users SET role = ?, department = ?, is_active = ?, password_hash = ?, updated_at = ? WHERE id = ?',
  ).run(updates.role, updates.department, updates.isActive, updates.passwordHash, updates.now, id);
}

export async function updateUserPassword(
  id: string,
  passwordHash: string,
  now: number,
): Promise<void> {
  if (isSupabaseEnabled()) {
    const { error } = await getSupabase()
      .from('users')
      .update({ password_hash: passwordHash, updated_at: now })
      .eq('id', id);
    if (error) {
      console.error('Supabase updateUserPassword error:', error);
      throw new Error('Gagal memperbarui kata sandi.', { cause: error });
    }
    return;
  }

  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    passwordHash,
    now,
    id,
  );
}

// ============================================================================
// Master Departments Repository
// ============================================================================

const DEFAULT_BPBD_DEPARTMENTS = [
  'Kepala Pelaksana',
  'Sekretariat',
  'Bidang Pencegahan & Kesiapsiagaan',
  'Bidang Kedaruratan & Logistik',
  'Bidang Rehabilitasi & Rekonstruksi',
];

export async function listDepartments(activeOnly: boolean): Promise<DepartmentRow[]> {
  if (isSupabaseEnabled()) {
    const supabase = getSupabase();
    let query = supabase
      .from('departments')
      .select('id, name, is_active, sort_order, created_at')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (activeOnly) {
      query = query.eq('is_active', 1);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Supabase listDepartments error:', error);
      throw new Error('Gagal memuat daftar bidang tujuan.', { cause: error });
    }

    if ((!data || data.length === 0) && activeOnly) {
      // Seed defaults once if departments table in Supabase is completely empty
      const { count } = await supabase
        .from('departments')
        .select('id', { count: 'exact', head: true });
      if ((count ?? 0) === 0) {
        const now = Date.now();
        const seedRows = DEFAULT_BPBD_DEPARTMENTS.map((name, idx) => ({
          id: crypto.randomUUID(),
          name,
          is_active: 1,
          sort_order: idx + 1,
          created_at: now,
        }));
        await supabase.from('departments').upsert(seedRows, { onConflict: 'name' });
        return seedRows;
      }
    }

    return (data ?? []) as DepartmentRow[];
  }

  const sql = activeOnly
    ? 'SELECT id, name, is_active, sort_order, created_at FROM departments WHERE is_active = 1 ORDER BY sort_order ASC, name ASC'
    : 'SELECT id, name, is_active, sort_order, created_at FROM departments ORDER BY sort_order ASC, name ASC';
  return db.prepare(sql).all() as unknown as DepartmentRow[];
}

export async function findDepartmentById(id: string): Promise<DepartmentRow | null> {
  if (isSupabaseEnabled()) {
    const { data, error } = await getSupabase()
      .from('departments')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      console.error('Supabase findDepartmentById error:', error);
      throw new Error('Gagal memeriksa master bidang.', { cause: error });
    }
    return (data as DepartmentRow | null) ?? null;
  }

  const row = db
    .prepare('SELECT * FROM departments WHERE id = ?')
    .get(id) as unknown as DepartmentRow | undefined;
  return row ?? null;
}

export async function findDepartmentByNameInsensitive(
  name: string,
): Promise<{ id: string } | null> {
  const clean = name.trim();
  if (isSupabaseEnabled()) {
    const { data, error } = await getSupabase()
      .from('departments')
      .select('id, name')
      .ilike('name', escapeIlikeLiteral(clean));
    if (error) {
      console.error('Supabase findDepartmentByName error:', error);
      throw new Error('Gagal memeriksa duplikasi nama bidang.', { cause: error });
    }
    const exact = (data as { id: string; name: string }[] | null)?.find(
      (d) => d.name.toLowerCase() === clean.toLowerCase(),
    );
    return exact ? { id: exact.id } : null;
  }

  const row = db
    .prepare('SELECT id FROM departments WHERE LOWER(name) = LOWER(?)')
    .get(clean) as { id: string } | undefined;
  return row ?? null;
}

export async function getMaxDepartmentSortOrder(): Promise<number> {
  if (isSupabaseEnabled()) {
    const { data, error } = await getSupabase()
      .from('departments')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1);
    if (error) {
      console.error('Supabase getMaxDepartmentSortOrder error:', error);
      throw new Error('Gagal membaca urutan bidang.', { cause: error });
    }
    const first = (data as { sort_order: number }[] | null)?.[0];
    return first?.sort_order ?? 0;
  }

  const row = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) as maxSort FROM departments')
    .get() as { maxSort: number };
  return row?.maxSort ?? 0;
}

export async function insertDepartment(input: {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: number;
}): Promise<void> {
  if (isSupabaseEnabled()) {
    const { error } = await getSupabase().from('departments').insert({
      id: input.id,
      name: input.name,
      is_active: 1,
      sort_order: input.sortOrder,
      created_at: input.createdAt,
    });
    if (error) {
      console.error('Supabase insertDepartment error:', error);
      throw new Error('Gagal menambahkan master bidang.', { cause: error });
    }
    return;
  }

  db.prepare(
    'INSERT INTO departments (id, name, is_active, sort_order, created_at) VALUES (?, ?, 1, ?, ?)',
  ).run(input.id, input.name, input.sortOrder, input.createdAt);
}

export async function countOtherActiveDepartments(excludeId: string): Promise<number> {
  if (isSupabaseEnabled()) {
    const { count, error } = await getSupabase()
      .from('departments')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', 1)
      .neq('id', excludeId);
    if (error) {
      console.error('Supabase countOtherActiveDepartments error:', error);
      throw new Error('Gagal memvalidasi jumlah bidang aktif.', { cause: error });
    }
    return count ?? 0;
  }

  const row = db
    .prepare('SELECT COUNT(*) as total FROM departments WHERE is_active = 1 AND id != ?')
    .get(excludeId) as { total: number };
  return row?.total ?? 0;
}

export async function updateDepartment(
  id: string,
  name: string,
  isActive: number,
): Promise<void> {
  if (isSupabaseEnabled()) {
    const { error } = await getSupabase()
      .from('departments')
      .update({ name, is_active: isActive })
      .eq('id', id);
    if (error) {
      console.error('Supabase updateDepartment error:', error);
      throw new Error('Gagal memperbarui master bidang.', { cause: error });
    }
    return;
  }

  db.prepare('UPDATE departments SET name = ?, is_active = ? WHERE id = ?').run(name, isActive, id);
}

// ============================================================================
// Visits Repository
// ============================================================================

export async function insertVisitTransaction(input: {
  fullName: string;
  phone: string;
  visitorCategory: string;
  institutionAddress: string;
  department: string;
  purpose: string;
  signatureData: string;
  checkoutTokenHash: string;
}): Promise<VisitRow> {
  const now = new Date();
  const visitDate = getWibDateString(now);
  const checkInAt = now.toISOString();
  const createdAt = now.getTime();
  const id = crypto.randomUUID();

  if (isSupabaseEnabled()) {
    const supabase = getSupabase();
    const { data: seqData, error: seqErr } = await supabase.rpc('next_visit_queue_number', {
      p_visit_date: visitDate,
    });
    if (seqErr) {
      console.error('Supabase next_visit_queue_number error:', seqErr);
      throw new Error('Gagal membuat nomor antrean kunjungan.', { cause: seqErr });
    }

    const nextNumber = Number(seqData) || 1;
    const queueCode = `T-${String(nextNumber).padStart(3, '0')}`;

    const { data, error } = await supabase
      .from('visits')
      .insert({
        id,
        queue_number: nextNumber,
        queue_code: queueCode,
        visit_date: visitDate,
        full_name: input.fullName,
        phone: input.phone,
        visitor_category: input.visitorCategory,
        institution_address: input.institutionAddress,
        department: input.department,
        official_name: null,
        purpose: input.purpose,
        signature_data: input.signatureData,
        status: 'Sedang Berkunjung',
        check_in_at: checkInAt,
        check_out_at: null,
        checkout_token_hash: input.checkoutTokenHash,
        created_at: createdAt,
      })
      .select('*')
      .single();

    if (error || !data) {
      console.error('Supabase insertVisit error:', error);
      throw new Error('Gagal menyimpan data kunjungan ke Supabase.', { cause: error });
    }

    return data as VisitRow;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const counterRow = db
      .prepare('SELECT last_number FROM daily_counters WHERE visit_date = ?')
      .get(visitDate) as { last_number: number } | undefined;

    const nextNumber = counterRow ? counterRow.last_number + 1 : 1;

    if (counterRow) {
      db.prepare('UPDATE daily_counters SET last_number = ? WHERE visit_date = ?').run(
        nextNumber,
        visitDate,
      );
    } else {
      db.prepare('INSERT INTO daily_counters (visit_date, last_number) VALUES (?, ?)').run(
        visitDate,
        nextNumber,
      );
    }

    const queueCode = `T-${String(nextNumber).padStart(3, '0')}`;

    db.prepare(
      `INSERT INTO visits (
        id, queue_number, queue_code, visit_date, full_name, phone,
        visitor_category, institution_address, department, official_name,
        purpose, signature_data, status, check_in_at, check_out_at,
        checkout_token_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'Sedang Berkunjung', ?, NULL, ?, ?)`,
    ).run(
      id,
      nextNumber,
      queueCode,
      visitDate,
      input.fullName,
      input.phone,
      input.visitorCategory,
      input.institutionAddress,
      input.department,
      input.purpose,
      input.signatureData,
      checkInAt,
      input.checkoutTokenHash,
      createdAt,
    );

    const inserted = db.prepare('SELECT * FROM visits WHERE id = ?').get(id) as unknown as VisitRow;
    db.exec('COMMIT');
    return inserted;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    throw err;
  }
}

export async function findVisitById(id: string): Promise<VisitRow | null> {
  if (!id) return null;

  if (isSupabaseEnabled()) {
    const { data, error } = await getSupabase()
      .from('visits')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      console.error('Supabase findVisitById error:', error);
      throw new Error('Gagal membaca data kunjungan.', { cause: error });
    }
    return (data as VisitRow | null) ?? null;
  }

  const row = db
    .prepare('SELECT * FROM visits WHERE id = ?')
    .get(id) as unknown as VisitRow | undefined;
  return row ?? null;
}

export async function updateVisitStatus(
  id: string,
  status: 'Sedang Berkunjung' | 'Selesai',
  checkOutAt: string | null,
): Promise<VisitRow> {
  if (isSupabaseEnabled()) {
    const { data, error } = await getSupabase()
      .from('visits')
      .update({ status, check_out_at: checkOutAt })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) {
      console.error('Supabase updateVisitStatus error:', error);
      throw new Error('Gagal memperbarui status kunjungan.', { cause: error });
    }
    return data as VisitRow;
  }

  db.prepare('UPDATE visits SET status = ?, check_out_at = ? WHERE id = ?').run(
    status,
    checkOutAt,
    id,
  );
  return db.prepare('SELECT * FROM visits WHERE id = ?').get(id) as unknown as VisitRow;
}

export async function deleteVisitById(id: string): Promise<void> {
  if (isSupabaseEnabled()) {
    const { error } = await getSupabase().from('visits').delete().eq('id', id);
    if (error) {
      console.error('Supabase deleteVisitById error:', error);
      throw new Error('Gagal menghapus data kunjungan.', { cause: error });
    }
    return;
  }

  db.prepare('DELETE FROM visits WHERE id = ?').run(id);
}

export interface VisitFilterInput {
  search: string;
  department: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  forcedDate?: string;
  forcedDepartment?: string;
  limit?: number;
}

export async function listFilteredVisits(filters: VisitFilterInput): Promise<VisitRow[]> {
  const allDepartments = new Set((await listDepartments(false)).map((d) => d.name));

  if (isSupabaseEnabled()) {
    let query = getSupabase()
      .from('visits')
      .select('*')
      .order('check_in_at', { ascending: false });

    const safeSearch = sanitizePostgrestSearchTerm(filters.search);
    if (safeSearch) {
      query = query.or(
        `full_name.ilike.%${safeSearch}%,institution_address.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%,queue_code.ilike.%${safeSearch}%`,
      );
    }

    if (filters.forcedDepartment) {
      query = query.eq('department', filters.forcedDepartment);
    } else if (filters.department && allDepartments.has(filters.department)) {
      query = query.eq('department', filters.department);
    }

    if (filters.status === 'Sedang Berkunjung' || filters.status === 'Selesai') {
      query = query.eq('status', filters.status);
    }

    if (filters.forcedDate) {
      query = query.eq('visit_date', filters.forcedDate);
    } else {
      if (/^\d{4}-\d{2}-\d{2}$/.test(filters.dateFrom)) {
        query = query.gte('visit_date', filters.dateFrom);
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo)) {
        query = query.lte('visit_date', filters.dateTo);
      }
    }

    const rowLimit = filters.limit ?? 5000;
    const { data, error } = await query.limit(rowLimit);
    if (error) {
      console.error('Supabase listFilteredVisits error:', error);
      throw new Error('Gagal memuat daftar kunjungan.', { cause: error });
    }
    return (data ?? []) as VisitRow[];
  }

  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filters.search) {
    const like = `%${filters.search.slice(0, 100)}%`;
    clauses.push('(full_name LIKE ? OR institution_address LIKE ? OR phone LIKE ? OR queue_code LIKE ?)');
    params.push(like, like, like, like);
  }

  if (filters.forcedDepartment) {
    clauses.push('department = ?');
    params.push(filters.forcedDepartment);
  } else if (filters.department && allDepartments.has(filters.department)) {
    clauses.push('department = ?');
    params.push(filters.department);
  }

  if (filters.status === 'Sedang Berkunjung' || filters.status === 'Selesai') {
    clauses.push('status = ?');
    params.push(filters.status);
  }

  if (filters.forcedDate) {
    clauses.push('visit_date = ?');
    params.push(filters.forcedDate);
  } else {
    if (/^\d{4}-\d{2}-\d{2}$/.test(filters.dateFrom)) {
      clauses.push('visit_date >= ?');
      params.push(filters.dateFrom);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo)) {
      clauses.push('visit_date <= ?');
      params.push(filters.dateTo);
    }
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limitSql = filters.limit ? ` LIMIT ${Number(filters.limit)}` : '';
  return db
    .prepare(`SELECT * FROM visits ${whereSql} ORDER BY check_in_at DESC${limitSql}`)
    .all(...params) as unknown as VisitRow[];
}

interface PeriodCounts {
  total: number;
  active: number;
  done: number;
}

export async function getDashboardData(params: {
  filters: VisitFilterInput;
  todayWib: string;
  weekStartWib: string;
  monthPrefix: string;
  currentYear: string;
  lastYear: string;
}) {
  const { filters, todayWib, weekStartWib, monthPrefix, currentYear, lastYear } = params;
  const scopedDepartment = filters.forcedDepartment;
  const scopedDate = filters.forcedDate;
  const monthStartWib = `${monthPrefix}-01`;
  const yearStartWib = `${currentYear}-01-01`;
  const lastYearStartWib = `${lastYear}-01-01`;
  const lastYearEndWib = `${lastYear}-12-31`;

  const filteredRows = await listFilteredVisits({ ...filters, limit: 1000 });

  const deptMap = new Map<string, number>();
  const catMap = new Map<string, number>();
  for (const row of filteredRows) {
    deptMap.set(row.department, (deptMap.get(row.department) ?? 0) + 1);
    catMap.set(row.visitor_category, (catMap.get(row.visitor_category) ?? 0) + 1);
  }

  const departmentBreakdown = Array.from(deptMap.entries())
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const categoryBreakdown = Array.from(catMap.entries())
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  let todayCounts: PeriodCounts = { total: 0, active: 0, done: 0 };
  let weekCounts: PeriodCounts = { total: 0, active: 0, done: 0 };
  let monthCounts: PeriodCounts = { total: 0, active: 0, done: 0 };
  let yearCounts: PeriodCounts = { total: 0, active: 0, done: 0 };
  let lastYearCounts: PeriodCounts = { total: 0, active: 0, done: 0 };
  let allCounts: PeriodCounts = { total: 0, active: 0, done: 0 };
  let activeNow = 0;
  let topDepartment: { name: string; count: number } | null = null;

  if (isSupabaseEnabled()) {
    let summaryQuery = getSupabase()
      .from('visits')
      .select('visit_date, status, department')
      .range(0, 9999);

    if (scopedDepartment) {
      summaryQuery = summaryQuery.eq('department', scopedDepartment);
    }
    if (scopedDate) {
      summaryQuery = summaryQuery.eq('visit_date', scopedDate);
    }

    const { data, error } = await summaryQuery;
    if (error) {
      console.error('Supabase dashboard summary error:', error);
      throw new Error('Gagal memuat statistik kunjungan.', { cause: error });
    }

    const summaryRows = (data ?? []) as {
      visit_date: string;
      status: string;
      department: string;
    }[];

    const addTo = (target: PeriodCounts, status: string) => {
      target.total += 1;
      if (status === 'Sedang Berkunjung') target.active += 1;
      else if (status === 'Selesai') target.done += 1;
    };

    const monthDeptCount = new Map<string, number>();
    const allDeptCount = new Map<string, number>();

    for (const r of summaryRows) {
      if (r.status === 'Sedang Berkunjung') {
        activeNow += 1;
      }

      if (r.visit_date === todayWib) addTo(todayCounts, r.status);
      if (r.visit_date >= weekStartWib && r.visit_date <= todayWib) addTo(weekCounts, r.status);
      if (r.visit_date.startsWith(monthPrefix)) {
        addTo(monthCounts, r.status);
        monthDeptCount.set(r.department, (monthDeptCount.get(r.department) ?? 0) + 1);
      }
      if (r.visit_date >= yearStartWib && r.visit_date <= todayWib) addTo(yearCounts, r.status);
      if (r.visit_date >= lastYearStartWib && r.visit_date <= lastYearEndWib) {
        addTo(lastYearCounts, r.status);
      }
      addTo(allCounts, r.status);
      allDeptCount.set(r.department, (allDeptCount.get(r.department) ?? 0) + 1);
    }

    if (scopedDate) {
      weekCounts = { ...todayCounts };
      monthCounts = { ...todayCounts };
      yearCounts = { ...todayCounts };
      lastYearCounts = { total: 0, active: 0, done: 0 };
      allCounts = { ...todayCounts };
    }

    const pickTopDept = (map: Map<string, number>) => {
      const sorted = Array.from(map.entries()).sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      );
      return sorted[0] ? { name: sorted[0][0], count: sorted[0][1] } : null;
    };

    topDepartment = pickTopDept(monthDeptCount) ?? pickTopDept(allDeptCount);
  } else {
    const deptSql = scopedDepartment ? ' AND department = ?' : '';
    const deptParams = scopedDepartment ? [scopedDepartment] : [];

    const countPeriod = (extraWhere: string, extraParams: (string | number)[]): PeriodCounts => {
      const row = db
        .prepare(
          `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'Sedang Berkunjung' THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN status = 'Selesai' THEN 1 ELSE 0 END) as done
           FROM visits
           WHERE ${extraWhere}${deptSql}`,
        )
        .get(...extraParams, ...deptParams) as {
        total: number;
        active: number | null;
        done: number | null;
      };
      return {
        total: row?.total ?? 0,
        active: row?.active ?? 0,
        done: row?.done ?? 0,
      };
    };

    todayCounts = countPeriod('visit_date = ?', [todayWib]);
    weekCounts = scopedDate
      ? todayCounts
      : countPeriod('visit_date >= ? AND visit_date <= ?', [weekStartWib, todayWib]);
    monthCounts = scopedDate
      ? todayCounts
      : countPeriod('visit_date LIKE ?', [`${monthPrefix}%`]);
    yearCounts = scopedDate
      ? todayCounts
      : countPeriod('visit_date >= ? AND visit_date <= ?', [yearStartWib, todayWib]);
    lastYearCounts = scopedDate
      ? { total: 0, active: 0, done: 0 }
      : countPeriod('visit_date >= ? AND visit_date <= ?', [lastYearStartWib, lastYearEndWib]);
    allCounts = scopedDate ? todayCounts : countPeriod('1=1', []);

    const activeNowRow = db
      .prepare(
        `SELECT COUNT(*) as total FROM visits WHERE status = 'Sedang Berkunjung'${
          scopedDate ? ' AND visit_date = ?' : ''
        }${deptSql}`,
      )
      .get(...(scopedDate ? [scopedDate] : []), ...deptParams) as { total: number };
    activeNow = activeNowRow?.total ?? 0;

    let topDeptRow = db
      .prepare(
        `SELECT department as name, COUNT(*) as total
         FROM visits
         WHERE visit_date LIKE ?${deptSql}
         GROUP BY department
         ORDER BY total DESC, department ASC
         LIMIT 1`,
      )
      .get(`${monthPrefix}%`, ...deptParams) as { name: string; total: number } | undefined;

    if (!topDeptRow) {
      topDeptRow = db
        .prepare(
          `SELECT department as name, COUNT(*) as total
           FROM visits
           WHERE 1=1${deptSql}
           GROUP BY department
           ORDER BY total DESC, department ASC
           LIMIT 1`,
        )
        .get(...deptParams) as { name: string; total: number } | undefined;
    }

    topDepartment = topDeptRow ? { name: topDeptRow.name, count: topDeptRow.total } : null;
  }

  const periodRecap = [
    {
      key: 'today',
      label: 'Hari Ini',
      rangeLabel: todayWib,
      ...todayCounts,
    },
    {
      key: 'week',
      label: 'Minggu Ini',
      rangeLabel: `${weekStartWib} s.d. ${todayWib}`,
      ...weekCounts,
    },
    {
      key: 'month',
      label: 'Bulan Ini',
      rangeLabel: `${monthStartWib} s.d. ${todayWib}`,
      ...monthCounts,
    },
    {
      key: 'year',
      label: `Tahun Ini (${currentYear})`,
      rangeLabel: `${yearStartWib} s.d. ${todayWib}`,
      ...yearCounts,
    },
    {
      key: 'last_year',
      label: `Tahun Lalu (${lastYear})`,
      rangeLabel: `${lastYearStartWib} s.d. ${lastYearEndWib}`,
      ...lastYearCounts,
    },
    {
      key: 'all',
      label: 'Total Keseluruhan',
      rangeLabel: 'Semua Riwayat Tercatat',
      ...allCounts,
    },
  ];

  return {
    stats: {
      totalToday: todayCounts.total,
      activeNow,
      totalWeek: weekCounts.total,
      totalMonth: monthCounts.total,
      totalYear: yearCounts.total,
      totalLastYear: lastYearCounts.total,
      totalAll: allCounts.total,
      topDepartment,
      periodRecap,
      departmentBreakdown,
      categoryBreakdown,
    },
    visits: filteredRows.map(mapVisitRow),
  };
}

// ============================================================================
// Password Reset Requests Repository
// ============================================================================

export async function findRecentOpenResetRequest(
  userId: string,
  sinceTimestamp: number,
): Promise<{ id: string } | null> {
  if (isSupabaseEnabled()) {
    const { data, error } = await getSupabase()
      .from('password_reset_requests')
      .select('id')
      .eq('user_id', userId)
      .in('status', ['pending', 'token_issued'])
      .gt('created_at', sinceTimestamp)
      .limit(1);
    if (error) {
      console.error('Supabase findRecentOpenResetRequest error:', error);
      return null;
    }
    const first = (data as { id: string }[] | null)?.[0];
    return first ?? null;
  }

  const row = db
    .prepare(
      "SELECT id FROM password_reset_requests WHERE user_id = ? AND status IN ('pending', 'token_issued') AND created_at > ?",
    )
    .get(userId, sinceTimestamp) as { id: string } | undefined;
  return row ?? null;
}

export async function insertPasswordResetRequest(input: {
  id: string;
  userId: string;
  username: string;
  fullName: string;
  role: string;
  note: string;
  status: 'pending' | 'token_issued';
  tokenHash?: string | null;
  tokenExpiresAt?: number | null;
  createdAt: number;
}): Promise<void> {
  if (isSupabaseEnabled()) {
    const { error } = await getSupabase().from('password_reset_requests').insert({
      id: input.id,
      user_id: input.userId,
      username: input.username,
      full_name: input.fullName,
      role: input.role,
      note: input.note,
      status: input.status,
      token_hash: input.tokenHash ?? null,
      token_expires_at: input.tokenExpiresAt ?? null,
      created_at: input.createdAt,
      resolved_at: null,
    });
    if (error) {
      console.error('Supabase insertPasswordResetRequest error:', error);
      throw new Error('Gagal mencatat permintaan reset kata sandi.', { cause: error });
    }
    return;
  }

  db.prepare(
    `INSERT INTO password_reset_requests (
      id, user_id, username, full_name, role, note, status, token_hash, token_expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.userId,
    input.username,
    input.fullName,
    input.role,
    input.note,
    input.status,
    input.tokenHash ?? null,
    input.tokenExpiresAt ?? null,
    input.createdAt,
  );
}

export async function listValidIssuedResetRequests(
  userId: string,
  now: number,
): Promise<PasswordResetRequestRow[]> {
  if (isSupabaseEnabled()) {
    const { data, error } = await getSupabase()
      .from('password_reset_requests')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'token_issued')
      .not('token_hash', 'is', null)
      .gt('token_expires_at', now)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Supabase listValidIssuedResetRequests error:', error);
      throw new Error('Gagal memverifikasi kode pemulihan.', { cause: error });
    }
    return (data ?? []) as PasswordResetRequestRow[];
  }

  return db
    .prepare(
      "SELECT * FROM password_reset_requests WHERE user_id = ? AND status = 'token_issued' AND token_hash IS NOT NULL AND token_expires_at > ? ORDER BY created_at DESC",
    )
    .all(userId, now) as unknown as PasswordResetRequestRow[];
}

export async function markResetRequestCompleted(requestId: string, now: number): Promise<void> {
  if (isSupabaseEnabled()) {
    const { error } = await getSupabase()
      .from('password_reset_requests')
      .update({ status: 'completed', token_hash: null, resolved_at: now })
      .eq('id', requestId);
    if (error) {
      console.error('Supabase markResetRequestCompleted error:', error);
    }
    return;
  }

  db.prepare(
    "UPDATE password_reset_requests SET status = 'completed', token_hash = NULL, resolved_at = ? WHERE id = ?",
  ).run(now, requestId);
}

export async function closeOpenResetRequestsForUser(userId: string, now: number): Promise<void> {
  if (isSupabaseEnabled()) {
    const { error } = await getSupabase()
      .from('password_reset_requests')
      .update({ status: 'completed', token_hash: null, resolved_at: now })
      .eq('user_id', userId)
      .in('status', ['pending', 'token_issued']);
    if (error) {
      console.error('Supabase closeOpenResetRequestsForUser error:', error);
    }
    return;
  }

  db.prepare(
    "UPDATE password_reset_requests SET status = 'completed', token_hash = NULL, resolved_at = ? WHERE user_id = ? AND status IN ('pending', 'token_issued')",
  ).run(now, userId);
}

export async function listPasswordResetRequests(
  limit = 50,
): Promise<PasswordResetRequestRow[]> {
  if (isSupabaseEnabled()) {
    const { data, error } = await getSupabase()
      .from('password_reset_requests')
      .select('id, user_id, username, full_name, role, note, status, token_expires_at, created_at, resolved_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('Supabase listPasswordResetRequests error:', error);
      throw new Error('Gagal memuat permintaan reset kata sandi.', { cause: error });
    }
    const rows = ((data ?? []) as Omit<PasswordResetRequestRow, 'token_hash'>[]).map((r) => ({
      ...r,
      token_hash: null,
    }));
    return rows.sort((a, b) => {
      const aOpen = a.status === 'pending' || a.status === 'token_issued' ? 0 : 1;
      const bOpen = b.status === 'pending' || b.status === 'token_issued' ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      return b.created_at - a.created_at;
    });
  }

  return db
    .prepare(
      `SELECT id, user_id, username, full_name, role, note, status, token_expires_at, created_at, resolved_at
       FROM password_reset_requests
       ORDER BY CASE WHEN status IN ('pending', 'token_issued') THEN 0 ELSE 1 END, created_at DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as PasswordResetRequestRow[];
}

export async function findPasswordResetRequestById(
  id: string,
): Promise<PasswordResetRequestRow | null> {
  if (isSupabaseEnabled()) {
    const { data, error } = await getSupabase()
      .from('password_reset_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      console.error('Supabase findPasswordResetRequestById error:', error);
      throw new Error('Gagal membaca permintaan reset kata sandi.', { cause: error });
    }
    return (data as PasswordResetRequestRow | null) ?? null;
  }

  const row = db
    .prepare('SELECT * FROM password_reset_requests WHERE id = ?')
    .get(id) as unknown as PasswordResetRequestRow | undefined;
  return row ?? null;
}

export async function issueResetRequestToken(
  id: string,
  tokenHash: string,
  expiresAt: number,
): Promise<void> {
  if (isSupabaseEnabled()) {
    const { error } = await getSupabase()
      .from('password_reset_requests')
      .update({
        status: 'token_issued',
        token_hash: tokenHash,
        token_expires_at: expiresAt,
      })
      .eq('id', id);
    if (error) {
      console.error('Supabase issueResetRequestToken error:', error);
      throw new Error('Gagal menerbitkan kode pemulihan.', { cause: error });
    }
    return;
  }

  db.prepare(
    "UPDATE password_reset_requests SET status = 'token_issued', token_hash = ?, token_expires_at = ? WHERE id = ?",
  ).run(tokenHash, expiresAt, id);
}

export async function dismissResetRequest(id: string, now: number): Promise<void> {
  if (isSupabaseEnabled()) {
    const { error } = await getSupabase()
      .from('password_reset_requests')
      .update({ status: 'rejected', token_hash: null, resolved_at: now })
      .eq('id', id);
    if (error) {
      console.error('Supabase dismissResetRequest error:', error);
      throw new Error('Gagal menutup permintaan reset kata sandi.', { cause: error });
    }
    return;
  }

  db.prepare(
    "UPDATE password_reset_requests SET status = 'rejected', token_hash = NULL, resolved_at = ? WHERE id = ?",
  ).run(now, id);
}

// ============================================================================
// Audit Logs Repository
// ============================================================================

export async function recordAuditLog(
  actorUsername: string,
  actorRole: string,
  action: string,
  target: string,
  details: string,
): Promise<void> {
  if (isSupabaseEnabled()) {
    try {
      const { error } = await getSupabase().from('audit_logs').insert({
        id: crypto.randomUUID(),
        actor_username: actorUsername,
        actor_role: actorRole,
        action,
        target,
        details: details.slice(0, 300),
        created_at: Date.now(),
      });
      if (error) {
        console.error('Supabase recordAuditLog error:', error);
      }
    } catch (err) {
      console.error('Failed to record Supabase audit log:', err);
    }
    return;
  }

  recordSqliteAuditLog(actorUsername, actorRole, action, target, details);
}

export async function listAuditLogs(limit = 200): Promise<AuditLogRow[]> {
  if (isSupabaseEnabled()) {
    const { data, error } = await getSupabase()
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('Supabase listAuditLogs error:', error);
      throw new Error('Gagal memuat log audit.', { cause: error });
    }
    return (data ?? []) as AuditLogRow[];
  }

  return db
    .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?')
    .all(limit) as unknown as AuditLogRow[];
}

// ============================================================================
// Backup & Import Data Repository
// ============================================================================

export interface BackupImportDepartmentInput {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

export interface BackupImportVisitInput {
  id: string;
  queueNumber: number;
  queueCode: string;
  visitDate: string;
  fullName: string;
  phone: string;
  visitorCategory: string;
  institutionAddress: string;
  department: string;
  purpose: string;
  signatureData: string;
  status: 'Sedang Berkunjung' | 'Selesai';
  checkInAt: string;
  checkOutAt: string | null;
}

export interface BackupImportSummary {
  departmentsAdded: number;
  departmentsUpdated: number;
  departmentsSkipped: number;
  visitsAdded: number;
  visitsUpdated: number;
  visitsSkipped: number;
}

export async function exportBackupBundle(): Promise<{
  departments: DepartmentRow[];
  visits: VisitRow[];
}> {
  if (isSupabaseEnabled()) {
    const { data: deptData, error: deptError } = await getSupabase()
      .from('departments')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (deptError) {
      console.error('Supabase exportBackupBundle departments error:', deptError);
      throw new Error('Gagal mengekspor master bidang dari Supabase.', { cause: deptError });
    }

    const visits: VisitRow[] = [];
    const pageSize = 1000;
    let offset = 0;
    while (true) {
      const { data: visitPage, error: visitError } = await getSupabase()
        .from('visits')
        .select('*')
        .order('visit_date', { ascending: true })
        .order('queue_number', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (visitError) {
        console.error('Supabase exportBackupBundle visits error:', visitError);
        throw new Error('Gagal mengekspor data kunjungan dari Supabase.', { cause: visitError });
      }
      const batch = (visitPage ?? []) as VisitRow[];
      visits.push(...batch);
      if (batch.length < pageSize) break;
      offset += pageSize;
    }

    return {
      departments: (deptData ?? []) as DepartmentRow[],
      visits,
    };
  }

  const departments = db
    .prepare('SELECT * FROM departments ORDER BY sort_order ASC, name ASC')
    .all() as unknown as DepartmentRow[];
  const visits = db
    .prepare('SELECT * FROM visits ORDER BY visit_date ASC, queue_number ASC, check_in_at ASC')
    .all() as unknown as VisitRow[];

  return { departments, visits };
}

export async function importBackupBundle(input: {
  departments: BackupImportDepartmentInput[];
  visits: BackupImportVisitInput[];
  conflictMode: 'skip' | 'overwrite';
}): Promise<BackupImportSummary> {
  const summary: BackupImportSummary = {
    departmentsAdded: 0,
    departmentsUpdated: 0,
    departmentsSkipped: 0,
    visitsAdded: 0,
    visitsUpdated: 0,
    visitsSkipped: 0,
  };
  const now = Date.now();
  const maxQueueByDate = new Map<string, number>();

  for (const v of input.visits) {
    const prevMax = maxQueueByDate.get(v.visitDate) ?? 0;
    if (v.queueNumber > prevMax) {
      maxQueueByDate.set(v.visitDate, v.queueNumber);
    }
  }

  if (isSupabaseEnabled()) {
    const supabase = getSupabase();
    const { data: existingDeptsData, error: deptLoadErr } = await supabase
      .from('departments')
      .select('*');
    if (deptLoadErr) {
      throw new Error('Gagal membaca master bidang saat import.', { cause: deptLoadErr });
    }
    const existingDepts = (existingDeptsData ?? []) as DepartmentRow[];
    const deptById = new Map(existingDepts.map((d) => [d.id, d]));
    const deptByNameLower = new Map(existingDepts.map((d) => [d.name.toLowerCase(), d]));

    for (const dept of input.departments) {
      const matched = deptById.get(dept.id) || deptByNameLower.get(dept.name.toLowerCase());
      if (!matched) {
        const rowId = dept.id || crypto.randomUUID();
        const { error } = await supabase.from('departments').insert({
          id: rowId,
          name: dept.name,
          is_active: dept.isActive ? 1 : 0,
          sort_order: dept.sortOrder,
          created_at: now,
        });
        if (error) {
          summary.departmentsSkipped += 1;
        } else {
          const insertedRow: DepartmentRow = {
            id: rowId,
            name: dept.name,
            is_active: dept.isActive ? 1 : 0,
            sort_order: dept.sortOrder,
            created_at: now,
          };
          deptById.set(rowId, insertedRow);
          deptByNameLower.set(dept.name.toLowerCase(), insertedRow);
          summary.departmentsAdded += 1;
        }
      } else if (input.conflictMode === 'overwrite') {
        const conflictOther = deptByNameLower.get(dept.name.toLowerCase());
        const nextName =
          conflictOther && conflictOther.id !== matched.id ? matched.name : dept.name;
        const { error } = await supabase
          .from('departments')
          .update({
            name: nextName,
            is_active: dept.isActive ? 1 : 0,
            sort_order: dept.sortOrder,
          })
          .eq('id', matched.id);
        if (error) {
          summary.departmentsSkipped += 1;
        } else {
          summary.departmentsUpdated += 1;
        }
      } else {
        summary.departmentsSkipped += 1;
      }
    }

    const existingVisitIds = new Set<string>();
    let offset = 0;
    while (true) {
      const { data: idBatch, error: idErr } = await supabase
        .from('visits')
        .select('id')
        .range(offset, offset + 999);
      if (idErr) {
        throw new Error('Gagal memeriksa data kunjungan saat import.', { cause: idErr });
      }
      const rows = (idBatch ?? []) as { id: string }[];
      for (const r of rows) existingVisitIds.add(r.id);
      if (rows.length < 1000) break;
      offset += 1000;
    }

    for (const v of input.visits) {
      const exists = existingVisitIds.has(v.id);
      if (!exists) {
        const tokenHash = crypto
          .createHash('sha256')
          .update(crypto.randomBytes(24).toString('hex'))
          .digest('hex');
        const createdMs = Date.parse(v.checkInAt) || now;
        const { error } = await supabase.from('visits').insert({
          id: v.id,
          queue_number: v.queueNumber,
          queue_code: v.queueCode,
          visit_date: v.visitDate,
          full_name: v.fullName,
          phone: v.phone,
          visitor_category: v.visitorCategory,
          institution_address: v.institutionAddress,
          department: v.department,
          official_name: null,
          purpose: v.purpose,
          signature_data: v.signatureData,
          status: v.status,
          check_in_at: v.checkInAt,
          check_out_at: v.checkOutAt,
          checkout_token_hash: tokenHash,
          created_at: createdMs,
        });
        if (error) {
          summary.visitsSkipped += 1;
        } else {
          existingVisitIds.add(v.id);
          summary.visitsAdded += 1;
        }
      } else if (input.conflictMode === 'overwrite') {
        const { error } = await supabase
          .from('visits')
          .update({
            queue_number: v.queueNumber,
            queue_code: v.queueCode,
            visit_date: v.visitDate,
            full_name: v.fullName,
            phone: v.phone,
            visitor_category: v.visitorCategory,
            institution_address: v.institutionAddress,
            department: v.department,
            purpose: v.purpose,
            signature_data: v.signatureData,
            status: v.status,
            check_in_at: v.checkInAt,
            check_out_at: v.checkOutAt,
          })
          .eq('id', v.id);
        if (error) {
          summary.visitsSkipped += 1;
        } else {
          summary.visitsUpdated += 1;
        }
      } else {
        summary.visitsSkipped += 1;
      }
    }

    for (const [visitDate, importedMax] of maxQueueByDate.entries()) {
      const { data: counterRow } = await supabase
        .from('daily_counters')
        .select('last_number')
        .eq('visit_date', visitDate)
        .maybeSingle();
      const currentNum = Number((counterRow as { last_number?: number } | null)?.last_number ?? 0);
      if (importedMax > currentNum) {
        await supabase.from('daily_counters').upsert({
          visit_date: visitDate,
          last_number: importedMax,
        });
      }
    }

    return summary;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const findDeptById = db.prepare('SELECT * FROM departments WHERE id = ?');
    const findDeptByName = db.prepare('SELECT * FROM departments WHERE LOWER(name) = LOWER(?)');
    const insertDept = db.prepare(
      'INSERT INTO departments (id, name, is_active, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    const updateDept = db.prepare(
      'UPDATE departments SET name = ?, is_active = ?, sort_order = ? WHERE id = ?',
    );

    for (const dept of input.departments) {
      const byId = findDeptById.get(dept.id) as DepartmentRow | undefined;
      const byName = findDeptByName.get(dept.name) as DepartmentRow | undefined;
      const matched = byId || byName;

      if (!matched) {
        insertDept.run(
          dept.id || crypto.randomUUID(),
          dept.name,
          dept.isActive ? 1 : 0,
          dept.sortOrder,
          now,
        );
        summary.departmentsAdded += 1;
      } else if (input.conflictMode === 'overwrite') {
        const safeName = byName && byName.id !== matched.id ? matched.name : dept.name;
        updateDept.run(safeName, dept.isActive ? 1 : 0, dept.sortOrder, matched.id);
        summary.departmentsUpdated += 1;
      } else {
        summary.departmentsSkipped += 1;
      }
    }

    const findVisitById = db.prepare('SELECT id FROM visits WHERE id = ?');
    const insertVisit = db.prepare(
      `INSERT INTO visits (
        id, queue_number, queue_code, visit_date, full_name, phone,
        visitor_category, institution_address, department, official_name,
        purpose, signature_data, status, check_in_at, check_out_at,
        checkout_token_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updateVisit = db.prepare(
      `UPDATE visits SET
        queue_number = ?, queue_code = ?, visit_date = ?, full_name = ?, phone = ?,
        visitor_category = ?, institution_address = ?, department = ?, purpose = ?,
        signature_data = ?, status = ?, check_in_at = ?, check_out_at = ?
      WHERE id = ?`,
    );

    for (const v of input.visits) {
      const existing = findVisitById.get(v.id) as { id: string } | undefined;
      if (!existing) {
        const tokenHash = crypto
          .createHash('sha256')
          .update(crypto.randomBytes(24).toString('hex'))
          .digest('hex');
        const createdMs = Date.parse(v.checkInAt) || now;
        insertVisit.run(
          v.id,
          v.queueNumber,
          v.queueCode,
          v.visitDate,
          v.fullName,
          v.phone,
          v.visitorCategory,
          v.institutionAddress,
          v.department,
          v.purpose,
          v.signatureData,
          v.status,
          v.checkInAt,
          v.checkOutAt,
          tokenHash,
          createdMs,
        );
        summary.visitsAdded += 1;
      } else if (input.conflictMode === 'overwrite') {
        updateVisit.run(
          v.queueNumber,
          v.queueCode,
          v.visitDate,
          v.fullName,
          v.phone,
          v.visitorCategory,
          v.institutionAddress,
          v.department,
          v.purpose,
          v.signatureData,
          v.status,
          v.checkInAt,
          v.checkOutAt,
          v.id,
        );
        summary.visitsUpdated += 1;
      } else {
        summary.visitsSkipped += 1;
      }
    }

    const selectCounter = db.prepare('SELECT last_number FROM daily_counters WHERE visit_date = ?');
    const upsertCounter = db.prepare(
      `INSERT INTO daily_counters (visit_date, last_number)
       VALUES (?, ?)
       ON CONFLICT(visit_date) DO UPDATE SET last_number = MAX(daily_counters.last_number, excluded.last_number)`,
    );
    for (const [visitDate, importedMax] of maxQueueByDate.entries()) {
      const row = selectCounter.get(visitDate) as { last_number: number } | undefined;
      if (!row || importedMax > row.last_number) {
        upsertCounter.run(visitDate, importedMax);
      }
    }

    db.exec('COMMIT');
    return summary;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    throw err;
  }
}
