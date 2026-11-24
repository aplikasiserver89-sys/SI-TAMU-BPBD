import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Request, Response } from 'express';
import {
  db,
  getWibDateString,
  getWibMonthPrefix,
  mapVisitRow,
  recordAuditLog,
  type AuditLogRow,
  type DepartmentRow,
  type PasswordResetRequestRow,
  type UserRow,
  type VisitRow,
} from './server/db.ts';
import {
  authenticateInternalUser,
  extractBearerToken,
  getAdminCredentialState,
  hashCheckoutToken,
  hashPasswordScrypt,
  issueUserToken,
  requireAuth,
  requireRole,
  revokeUserToken,
  verifyCheckoutToken,
  verifyUserToken,
  type UserRole,
} from './server/auth.ts';

const PORT = 3000;
const VISITOR_CATEGORIES = new Set([
  'Masyarakat Umum',
  'Instansi Pemerintah/OPD',
  'TNI/Polri',
  'Relawan/Komunitas',
  'Swasta/Media',
]);
const VALID_ROLES = new Set<UserRole>(['super_admin', 'resepsionis', 'pimpinan']);

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 5 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 15) {
    return false;
  }
  entry.count += 1;
  return true;
}

function sanitizeString(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function sanitizeCsvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const neutralized = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  const escaped = neutralized.replace(/"/g, '""');
  return `"${escaped}"`;
}

function getActiveDepartmentSet(): Set<string> {
  const rows = db
    .prepare('SELECT name FROM departments WHERE is_active = 1')
    .all() as unknown as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function getAllDepartmentSet(): Set<string> {
  const rows = db
    .prepare('SELECT name FROM departments')
    .all() as unknown as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function buildFilterWhere(
  query: Request['query'],
  options?: { forcedDate?: string; forcedDepartment?: string },
) {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  const allDepartments = getAllDepartmentSet();

  const search = typeof query.search === 'string' ? query.search.trim() : '';
  const department = typeof query.department === 'string' ? query.department.trim() : '';
  const status = typeof query.status === 'string' ? query.status.trim() : '';
  const dateFrom = typeof query.dateFrom === 'string' ? query.dateFrom.trim() : '';
  const dateTo = typeof query.dateTo === 'string' ? query.dateTo.trim() : '';

  if (search) {
    const like = `%${search.slice(0, 100)}%`;
    clauses.push(
      '(full_name LIKE ? OR institution_address LIKE ? OR phone LIKE ? OR queue_code LIKE ?)',
    );
    params.push(like, like, like, like);
  }

  if (options?.forcedDepartment) {
    clauses.push('department = ?');
    params.push(options.forcedDepartment);
  } else if (department && allDepartments.has(department)) {
    clauses.push('department = ?');
    params.push(department);
  }

  if (status && (status === 'Sedang Berkunjung' || status === 'Selesai')) {
    clauses.push('status = ?');
    params.push(status);
  }

  if (options?.forcedDate) {
    clauses.push('visit_date = ?');
    params.push(options.forcedDate);
  } else {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
      clauses.push('visit_date >= ?');
      params.push(dateFrom);
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      clauses.push('visit_date <= ?');
      params.push(dateTo);
    }
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return { whereSql, params };
}

function insertVisitTransaction(input: {
  fullName: string;
  phone: string;
  visitorCategory: string;
  institutionAddress: string;
  department: string;
  purpose: string;
  signatureData: string;
}) {
  const now = new Date();
  const visitDate = getWibDateString(now);
  const checkInAt = now.toISOString();
  const createdAt = now.getTime();
  const id = crypto.randomUUID();
  const checkoutToken = crypto.randomBytes(24).toString('base64url');
  const checkoutTokenHash = hashCheckoutToken(checkoutToken);

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
      checkoutTokenHash,
      createdAt,
    );

    const inserted = db.prepare('SELECT * FROM visits WHERE id = ?').get(id) as unknown as VisitRow;
    db.exec('COMMIT');

    return {
      visit: mapVisitRow(inserted),
      checkoutToken,
    };
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    throw err;
  }
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '512kb' }));

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Public: Active departments list
  app.get('/api/departments', (_req: Request, res: Response) => {
    const rows = db
      .prepare('SELECT id, name, is_active, sort_order FROM departments WHERE is_active = 1 ORDER BY sort_order ASC, name ASC')
      .all() as unknown as DepartmentRow[];
    res.json({
      departments: rows.map((r) => ({
        id: r.id,
        name: r.name,
        isActive: r.is_active === 1,
        sortOrder: r.sort_order,
      })),
    });
  });

  // Public: Submit Guest Registration
  app.post('/api/visits', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Payload tidak valid.' });
      return;
    }

    const fullName = sanitizeString(body.fullName, 120);
    const phone = sanitizeString(body.phone, 24);
    const visitorCategory = sanitizeString(body.visitorCategory, 60);
    const institutionAddress = sanitizeString(body.institutionAddress, 200);
    const department = sanitizeString(body.department, 80);
    const purpose = sanitizeString(body.purpose, 500);
    const signatureData = typeof body.signatureData === 'string' ? body.signatureData.trim() : '';

    const activeDepartments = getActiveDepartmentSet();

    if (fullName.length < 2) {
      res.status(400).json({ error: 'Nama lengkap wajib diisi (minimal 2 karakter).' });
      return;
    }
    if (!/^[0-9+\-\s()]{8,24}$/.test(phone)) {
      res.status(400).json({ error: 'Nomor HP/WhatsApp wajib diisi dengan format yang benar.' });
      return;
    }
    if (!VISITOR_CATEGORIES.has(visitorCategory)) {
      res.status(400).json({ error: 'Kategori pengunjung tidak valid.' });
      return;
    }
    if (institutionAddress.length < 2) {
      res.status(400).json({ error: 'Nama instansi/alamat wajib diisi.' });
      return;
    }
    if (!activeDepartments.has(department)) {
      res.status(400).json({ error: 'Bidang tujuan tidak valid atau sedang tidak aktif.' });
      return;
    }
    if (purpose.length < 3) {
      res.status(400).json({ error: 'Keperluan kunjungan wajib diisi.' });
      return;
    }
    if (
      !signatureData.startsWith('data:image/png;base64,') ||
      signatureData.length < 150 ||
      signatureData.length > 350_000
    ) {
      res.status(400).json({ error: 'Tanda tangan digital wajib diisi pada kotak tanda tangan.' });
      return;
    }

    try {
      const result = insertVisitTransaction({
        fullName,
        phone,
        visitorCategory,
        institutionAddress,
        department,
        purpose,
        signatureData,
      });
      res.status(201).json(result);
    } catch (err) {
      console.error('Error creating visit:', err);
      res.status(500).json({ error: 'Gagal menyimpan data kunjungan. Silakan coba lagi.' });
    }
  });

  // Public (with visitor checkout token header): Retrieve own receipt
  app.get('/api/visits/:id/receipt', (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const token = req.headers['x-checkout-token'];
    if (!id || typeof token !== 'string' || !token) {
      res.status(401).json({ error: 'Token bukti kunjungan tidak ditemukan.' });
      return;
    }

    const row = db.prepare('SELECT * FROM visits WHERE id = ?').get(id) as unknown as VisitRow | undefined;
    if (!row || !verifyCheckoutToken(token, row.checkout_token_hash)) {
      res.status(404).json({ error: 'Bukti kunjungan tidak ditemukan atau token tidak cocok.' });
      return;
    }

    res.json({ visit: mapVisitRow(row) });
  });

  // Public (with visitor checkout token header): Self Check-Out
  app.post('/api/visits/:id/checkout', (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const token = req.headers['x-checkout-token'];
    if (!id || typeof token !== 'string' || !token) {
      res.status(401).json({ error: 'Token bukti kunjungan tidak valid.' });
      return;
    }

    const row = db.prepare('SELECT * FROM visits WHERE id = ?').get(id) as unknown as VisitRow | undefined;
    if (!row || !verifyCheckoutToken(token, row.checkout_token_hash)) {
      res.status(404).json({ error: 'Bukti kunjungan tidak ditemukan atau token tidak cocok.' });
      return;
    }

    if (row.status === 'Selesai') {
      res.json({ visit: mapVisitRow(row) });
      return;
    }

    const checkOutAt = new Date().toISOString();
    db.prepare('UPDATE visits SET status = ?, check_out_at = ? WHERE id = ?').run(
      'Selesai',
      checkOutAt,
      id,
    );

    const updated = db.prepare('SELECT * FROM visits WHERE id = ?').get(id) as unknown as VisitRow;
    res.json({ visit: mapVisitRow(updated) });
  });

  // Admin / Internal Auth Status & First-Run Bootstrap
  app.get('/api/admin/auth-status', (req: Request, res: Response) => {
    const credState = getAdminCredentialState();
    const token = extractBearerToken(req);
    const user = token ? verifyUserToken(token) : null;
    res.json({
      configured: credState.configured,
      source: credState.source,
      authenticated: Boolean(user),
      user,
    });
  });

  app.post('/api/admin/bootstrap', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown> | null;
    const username = sanitizeString(body?.username, 60);
    const fullName = sanitizeString(body?.fullName, 120);
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!/^[a-zA-Z0-9._-]{3,60}$/.test(username)) {
      res.status(400).json({
        error: 'NIP / Username wajib diisi (3-60 karakter, huruf, angka, titik, atau garis bawah).',
      });
      return;
    }
    if (fullName.length < 2) {
      res.status(400).json({ error: 'Nama lengkap Super Admin wajib diisi.' });
      return;
    }
    if (password.length < 8 || password.length > 128) {
      res.status(400).json({ error: 'Kata sandi harus 8 sampai 128 karakter.' });
      return;
    }

    const credState = getAdminCredentialState();
    if (credState.configured) {
      res.status(409).json({ error: 'Akun internal sudah dikonfigurasi. Silakan masuk melalui halaman login.' });
      return;
    }

    try {
      db.exec('BEGIN IMMEDIATE');
      const userCount = db.prepare('SELECT COUNT(*) as total FROM users').get() as { total: number };
      if ((userCount?.total ?? 0) > 0) {
        db.exec('ROLLBACK');
        res.status(409).json({ error: 'Akun Super Admin sudah dibuat sebelumnya. Silakan login.' });
        return;
      }

      const id = crypto.randomUUID();
      const now = Date.now();
      const passwordHash = hashPasswordScrypt(password);

      db.prepare(
        `INSERT INTO users (id, username, full_name, role, department, password_hash, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'super_admin', 'Semua Bidang', ?, 1, ?, ?)`,
      ).run(id, username, fullName, passwordHash, now, now);

      db.exec('COMMIT');

      const authUser = {
        id,
        username,
        fullName,
        role: 'super_admin' as const,
        department: 'Semua Bidang',
      };
      recordAuditLog(username, 'super_admin', 'BOOTSTRAP_SUPER_ADMIN', username, 'Aktivasi akun Super Admin pertama');
      const token = issueUserToken(authUser);
      res.status(201).json({ token, user: authUser });
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      console.error('Error bootstrapping super admin:', err);
      res.status(500).json({ error: 'Gagal menyimpan akun Super Admin.' });
    }
  });

  app.post('/api/admin/login', (req: Request, res: Response) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(ip)) {
      res.status(429).json({ error: 'Terlalu banyak percobaan login. Silakan tunggu beberapa menit.' });
      return;
    }

    const credState = getAdminCredentialState();
    if (!credState.configured) {
      res.status(409).json({ error: 'Akun internal belum diaktivasi. Lakukan aktivasi Super Admin terlebih dahulu.' });
      return;
    }

    const body = req.body as Record<string, unknown> | null;
    const username = sanitizeString(body?.username, 60);
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!username || !password) {
      res.status(400).json({ error: 'NIP / Username dan kata sandi wajib diisi.' });
      return;
    }

    const authUser = authenticateInternalUser(username, password);
    if (!authUser) {
      res.status(401).json({ error: 'NIP / Username atau kata sandi salah, atau akun tidak aktif.' });
      return;
    }

    recordAuditLog(authUser.username, authUser.role, 'LOGIN', authUser.username, 'Berhasil masuk ke sistem');
    const token = issueUserToken(authUser);
    res.json({ token, user: authUser });
  });

  app.post('/api/admin/logout', (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (token) {
      const user = verifyUserToken(token);
      if (user) {
        recordAuditLog(user.username, user.role, 'LOGOUT', user.username, 'Keluar dari sistem');
      }
      revokeUserToken(token);
    }
    res.json({ ok: true });
  });

  // Public (Rate-Limited): Forgot Password Request to Super Admin
  app.post('/api/admin/forgot-password', (req: Request, res: Response) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(ip)) {
      res.status(429).json({
        error: 'Terlalu banyak percobaan. Silakan tunggu beberapa menit sebelum mencoba lagi.',
      });
      return;
    }

    const body = req.body as Record<string, unknown> | null;
    const username = sanitizeString(body?.username, 60);
    const note = sanitizeString(body?.note, 200);

    if (!/^[a-zA-Z0-9._-]{3,60}$/.test(username)) {
      res.status(400).json({ error: 'NIP / Username wajib diisi (minimal 3 karakter).' });
      return;
    }

    const userRow = db
      .prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND is_active = 1')
      .get(username) as unknown as UserRow | undefined;

    if (userRow) {
      const now = Date.now();
      const recentReq = db
        .prepare(
          "SELECT id FROM password_reset_requests WHERE user_id = ? AND status = 'pending' AND created_at > ?",
        )
        .get(userRow.id, now - 2 * 60 * 1000) as { id: string } | undefined;

      if (!recentReq) {
        db.prepare(
          `INSERT INTO password_reset_requests (
            id, user_id, username, full_name, role, note, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
        ).run(
          crypto.randomUUID(),
          userRow.id,
          userRow.username,
          userRow.full_name,
          userRow.role,
          note,
          now,
        );

        recordAuditLog(
          userRow.username,
          userRow.role,
          'REQUEST_PASSWORD_RESET',
          userRow.username,
          note ? `Pengajuan lupa password: ${note}` : 'Mengajukan reset kata sandi',
        );
      }
    }

    // Non-enumerating response: same reply whether user exists or not
    res.json({
      ok: true,
      message:
        'Permintaan reset kata sandi telah dicatat. Jika NIP / Username terdaftar dan aktif, silakan hubungi Super Admin (Pengadministrasi Umum) untuk mendapatkan kode pemulihan 1x pakai atau reset sandi.',
    });
  });

  // Public (Rate-Limited): Reset Password via One-Time Recovery Code or Server ADMIN_RECOVERY_KEY
  app.post('/api/admin/reset-password', (req: Request, res: Response) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(ip)) {
      res.status(429).json({
        error: 'Terlalu banyak percobaan pemulihan. Silakan tunggu beberapa menit.',
      });
      return;
    }

    const body = req.body as Record<string, unknown> | null;
    const username = sanitizeString(body?.username, 60);
    const recoveryCode = sanitizeString(body?.recoveryCode, 128);
    const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';

    if (!username || !recoveryCode) {
      res.status(400).json({ error: 'NIP / Username dan Kode Pemulihan wajib diisi.' });
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      res.status(400).json({ error: 'Kata sandi baru wajib 8 sampai 128 karakter.' });
      return;
    }

    const userRow = db
      .prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND is_active = 1')
      .get(username) as unknown as UserRow | undefined;

    if (!userRow) {
      res.status(401).json({
        error: 'NIP / Username atau kode pemulihan tidak valid atau sudah kedaluwarsa.',
      });
      return;
    }

    const now = Date.now();
    let authorizedMethod: 'token' | 'recovery_key' | null = null;
    let matchedRequestId: string | null = null;

    // 1) Check issued one-time recovery token for this user (case-insensitive, ignore spaces/hyphens)
    const normalizedToken = recoveryCode.toUpperCase().replace(/[\s-]+/g, '');
    const providedTokenHash = hashCheckoutToken(normalizedToken);
    const issuedRequests = db
      .prepare(
        "SELECT * FROM password_reset_requests WHERE user_id = ? AND status = 'token_issued' AND token_hash IS NOT NULL AND token_expires_at > ? ORDER BY created_at DESC",
      )
      .all(userRow.id, now) as unknown as PasswordResetRequestRow[];

    for (const reqRow of issuedRequests) {
      if (reqRow.token_hash && verifyCheckoutToken(normalizedToken, reqRow.token_hash)) {
        authorizedMethod = 'token';
        matchedRequestId = reqRow.id;
        break;
      }
    }

    // 2) Fallback for Super Admin using server environment ADMIN_RECOVERY_KEY (min 12 chars)
    if (!authorizedMethod && userRow.role === 'super_admin') {
      const envRecoveryKey = process.env.ADMIN_RECOVERY_KEY?.trim();
      if (envRecoveryKey && envRecoveryKey.length >= 12) {
        const a = Buffer.from(hashCheckoutToken(recoveryCode.trim()), 'hex');
        const b = Buffer.from(hashCheckoutToken(envRecoveryKey), 'hex');
        if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
          authorizedMethod = 'recovery_key';
        }
      }
    }

    void providedTokenHash;

    if (!authorizedMethod) {
      res.status(401).json({
        error: 'NIP / Username atau kode pemulihan tidak valid atau sudah kedaluwarsa.',
      });
      return;
    }

    const nextHash = hashPasswordScrypt(newPassword);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      nextHash,
      now,
      userRow.id,
    );

    if (matchedRequestId) {
      db.prepare(
        "UPDATE password_reset_requests SET status = 'completed', token_hash = NULL, resolved_at = ? WHERE id = ?",
      ).run(now, matchedRequestId);
    }

    // Close any remaining open reset requests for this user
    db.prepare(
      "UPDATE password_reset_requests SET status = 'completed', token_hash = NULL, resolved_at = ? WHERE user_id = ? AND status IN ('pending', 'token_issued')",
    ).run(now, userRow.id);

    recordAuditLog(
      userRow.username,
      userRow.role,
      'PASSWORD_RESET_COMPLETED',
      userRow.username,
      authorizedMethod === 'recovery_key'
        ? 'Reset sandi menggunakan ADMIN_RECOVERY_KEY'
        : 'Reset sandi menggunakan kode pemulihan 1x pakai',
    );

    res.json({
      ok: true,
      message: 'Kata sandi berhasil diperbarui. Silakan masuk menggunakan kata sandi baru Anda.',
    });
  });

  // RBAC-Protected Dashboard Data (All 3 roles, scoped per role)
  app.get(
    '/api/admin/dashboard',
    requireAuth,
    requireRole('super_admin', 'resepsionis', 'pimpinan'),
    (req: Request, res: Response) => {
      const user = req.authUser!;
      const todayWib = getWibDateString();
      const monthPrefix = getWibMonthPrefix();
      const currentYear = todayWib.slice(0, 4);
      const lastYear = String(Number(currentYear) - 1);

      // Compute Monday of current WIB week
      const wibTodayNoon = new Date(`${todayWib}T12:00:00+07:00`);
      const dayOfWeek = wibTodayNoon.getUTCDay();
      const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      wibTodayNoon.setUTCDate(wibTodayNoon.getUTCDate() - diffToMonday);
      const weekStartWib = getWibDateString(wibTodayNoon);
      const monthStartWib = `${monthPrefix}-01`;
      const yearStartWib = `${currentYear}-01-01`;
      const lastYearStartWib = `${lastYear}-01-01`;
      const lastYearEndWib = `${lastYear}-12-31`;

      // Pimpinan with specific department sees only their department's data & stats
      const scopedDepartment =
        user.role === 'pimpinan' && user.department && user.department !== 'Semua Bidang'
          ? user.department
          : undefined;

      // Resepsionis sees only today's visits
      const scopedDate = user.role === 'resepsionis' ? todayWib : undefined;

      const deptSql = scopedDepartment ? ' AND department = ?' : '';
      const deptParams = scopedDepartment ? [scopedDepartment] : [];

      const countPeriod = (extraWhere: string, extraParams: (string | number)[]) => {
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

      const todayCounts = countPeriod('visit_date = ?', [todayWib]);
      const weekCounts = scopedDate
        ? todayCounts
        : countPeriod('visit_date >= ? AND visit_date <= ?', [weekStartWib, todayWib]);
      const monthCounts = scopedDate
        ? todayCounts
        : countPeriod('visit_date LIKE ?', [`${monthPrefix}%`]);
      const yearCounts = scopedDate
        ? todayCounts
        : countPeriod('visit_date >= ? AND visit_date <= ?', [yearStartWib, todayWib]);
      const lastYearCounts = scopedDate
        ? { total: 0, active: 0, done: 0 }
        : countPeriod('visit_date >= ? AND visit_date <= ?', [lastYearStartWib, lastYearEndWib]);
      const allCounts = scopedDate ? todayCounts : countPeriod('1=1', []);

      const activeNowRow = db
        .prepare(
          `SELECT COUNT(*) as total FROM visits WHERE status = 'Sedang Berkunjung'${
            scopedDate ? ' AND visit_date = ?' : ''
          }${deptSql}`,
        )
        .get(...(scopedDate ? [scopedDate] : []), ...deptParams) as { total: number };

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

      const { whereSql, params } = buildFilterWhere(req.query, {
        forcedDate: scopedDate,
        forcedDepartment: scopedDepartment,
      });

      const rows = db
        .prepare(`SELECT * FROM visits ${whereSql} ORDER BY check_in_at DESC LIMIT 1000`)
        .all(...params) as unknown as VisitRow[];

      const departmentBreakdown = db
        .prepare(
          `SELECT department as name, COUNT(*) as total
           FROM visits ${whereSql}
           GROUP BY department
           ORDER BY total DESC, department ASC`,
        )
        .all(...params) as unknown as { name: string; total: number }[];

      const categoryBreakdown = db
        .prepare(
          `SELECT visitor_category as name, COUNT(*) as total
           FROM visits ${whereSql}
           GROUP BY visitor_category
           ORDER BY total DESC, visitor_category ASC`,
        )
        .all(...params) as unknown as { name: string; total: number }[];

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

      res.json({
        stats: {
          totalToday: todayCounts.total,
          activeNow: activeNowRow?.total ?? 0,
          totalWeek: weekCounts.total,
          totalMonth: monthCounts.total,
          totalYear: yearCounts.total,
          totalLastYear: lastYearCounts.total,
          totalAll: allCounts.total,
          topDepartment: topDeptRow ? { name: topDeptRow.name, count: topDeptRow.total } : null,
          periodRecap,
          departmentBreakdown,
          categoryBreakdown,
        },
        visits: rows.map(mapVisitRow),
      });
    },
  );

  // RBAC: Staff-Assisted Manual Visit Entry (super_admin & resepsionis only)
  app.post(
    '/api/admin/manual-visit',
    requireAuth,
    requireRole('super_admin', 'resepsionis'),
    (req: Request, res: Response) => {
      const user = req.authUser!;
      const body = req.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'Payload tidak valid.' });
        return;
      }

      const fullName = sanitizeString(body.fullName, 120);
      const phone = sanitizeString(body.phone, 24);
      const visitorCategory = sanitizeString(body.visitorCategory, 60);
      const institutionAddress = sanitizeString(body.institutionAddress, 200);
      const department = sanitizeString(body.department, 80);
      const purpose = sanitizeString(body.purpose, 500);
      const signatureData = typeof body.signatureData === 'string' ? body.signatureData.trim() : '';

      const activeDepartments = getActiveDepartmentSet();

      if (fullName.length < 2) {
        res.status(400).json({ error: 'Nama lengkap wajib diisi.' });
        return;
      }
      if (!/^[0-9+\-\s()]{8,24}$/.test(phone)) {
        res.status(400).json({ error: 'Nomor HP/WhatsApp wajib diisi dengan format valid.' });
        return;
      }
      if (!VISITOR_CATEGORIES.has(visitorCategory)) {
        res.status(400).json({ error: 'Kategori pengunjung tidak valid.' });
        return;
      }
      if (institutionAddress.length < 2) {
        res.status(400).json({ error: 'Nama instansi/alamat wajib diisi.' });
        return;
      }
      if (!activeDepartments.has(department)) {
        res.status(400).json({ error: 'Bidang tujuan tidak valid.' });
        return;
      }
      if (purpose.length < 3) {
        res.status(400).json({ error: 'Keperluan kunjungan wajib diisi.' });
        return;
      }
      if (
        !signatureData.startsWith('data:image/png;base64,') ||
        signatureData.length < 150 ||
        signatureData.length > 350_000
      ) {
        res.status(400).json({ error: 'Tanda tangan digital wajib diisi.' });
        return;
      }

      try {
        const result = insertVisitTransaction({
          fullName,
          phone,
          visitorCategory,
          institutionAddress,
          department,
          purpose,
          signatureData,
        });
        recordAuditLog(
          user.username,
          user.role,
          'MANUAL_CHECKIN',
          result.visit.queueCode,
          `Input bantuan petugas untuk ${fullName} (${department})`,
        );
        res.status(201).json(result);
      } catch (err) {
        console.error('Error creating manual visit:', err);
        res.status(500).json({ error: 'Gagal menyimpan input manual tamu.' });
      }
    },
  );

  // RBAC: Toggle status Check-Out (super_admin & resepsionis only)
  app.patch(
    '/api/admin/visits/:id/status',
    requireAuth,
    requireRole('super_admin', 'resepsionis'),
    (req: Request, res: Response) => {
      const user = req.authUser!;
      const id = String(req.params.id || '');
      const body = req.body as Record<string, unknown> | null;
      const targetStatus = typeof body?.status === 'string' ? body.status : '';

      if (targetStatus !== 'Selesai' && targetStatus !== 'Sedang Berkunjung') {
        res.status(400).json({ error: 'Status kunjungan tidak valid.' });
        return;
      }

      const row = db.prepare('SELECT * FROM visits WHERE id = ?').get(id) as unknown as VisitRow | undefined;
      if (!row) {
        res.status(404).json({ error: 'Data kunjungan tidak ditemukan.' });
        return;
      }

      if (user.role === 'resepsionis' && row.visit_date !== getWibDateString()) {
        res.status(403).json({
          error: 'Petugas Resepsionis hanya dapat mengubah status kunjungan hari berjalan.',
        });
        return;
      }

      const checkOutAt = targetStatus === 'Selesai' ? new Date().toISOString() : null;
      db.prepare('UPDATE visits SET status = ?, check_out_at = ? WHERE id = ?').run(
        targetStatus,
        checkOutAt,
        id,
      );

      recordAuditLog(
        user.username,
        user.role,
        'UPDATE_VISIT_STATUS',
        row.queue_code,
        `Status ${row.full_name} diubah menjadi ${targetStatus}`,
      );

      const updated = db.prepare('SELECT * FROM visits WHERE id = ?').get(id) as unknown as VisitRow;
      res.json({ visit: mapVisitRow(updated) });
    },
  );

  // RBAC: Delete entry (super_admin ONLY)
  app.delete(
    '/api/admin/visits/:id',
    requireAuth,
    requireRole('super_admin'),
    (req: Request, res: Response) => {
      const user = req.authUser!;
      const id = String(req.params.id || '');
      const row = db.prepare('SELECT * FROM visits WHERE id = ?').get(id) as unknown as VisitRow | undefined;
      if (!row) {
        res.status(404).json({ error: 'Data kunjungan tidak ditemukan.' });
        return;
      }
      db.prepare('DELETE FROM visits WHERE id = ?').run(id);
      recordAuditLog(
        user.username,
        user.role,
        'DELETE_VISIT',
        row.queue_code,
        `Menghapus data kunjungan ${row.full_name}`,
      );
      res.json({ ok: true });
    },
  );

  // RBAC: Export CSV (super_admin ONLY)
  app.get(
    '/api/admin/export',
    requireAuth,
    requireRole('super_admin'),
    (req: Request, res: Response) => {
      const user = req.authUser!;
      const { whereSql, params } = buildFilterWhere(req.query);
      const rows = db
        .prepare(`SELECT * FROM visits ${whereSql} ORDER BY check_in_at DESC`)
        .all(...params) as unknown as VisitRow[];

      const headers = [
        'No. Urut',
        'Tanggal Kunjungan',
        'Jam Masuk (WIB)',
        'Jam Keluar (WIB)',
        'Nama Lengkap',
        'Nomor HP/WhatsApp',
        'Kategori Pengunjung',
        'Nama Instansi/Alamat',
        'Bidang Tujuan',
        'Keperluan Kunjungan',
        'Status',
      ];

      const timeFormatter = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });

      const csvLines = [headers.map((h) => sanitizeCsvCell(h)).join(',')];

      for (const row of rows) {
        const checkInTime = timeFormatter.format(new Date(row.check_in_at));
        const checkOutTime = row.check_out_at ? timeFormatter.format(new Date(row.check_out_at)) : '-';
        csvLines.push(
          [
            row.queue_code,
            row.visit_date,
            checkInTime,
            checkOutTime,
            row.full_name,
            row.phone,
            row.visitor_category,
            row.institution_address,
            row.department,
            row.purpose,
            row.status,
          ]
            .map((cell) => sanitizeCsvCell(cell))
            .join(','),
        );
      }

      recordAuditLog(
        user.username,
        user.role,
        'EXPORT_CSV',
        'laporan-buku-tamu',
        `Mengunduh ${rows.length} baris rekap CSV`,
      );

      const csvContent = `\uFEFF${csvLines.join('\r\n')}`;
      const filename = `laporan-buku-tamu-bpbd-sidoarjo-${getWibDateString()}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvContent);
    },
  );

  // RBAC: Master Departments Management (super_admin ONLY)
  app.get(
    '/api/admin/departments',
    requireAuth,
    requireRole('super_admin'),
    (_req: Request, res: Response) => {
      const rows = db
        .prepare('SELECT * FROM departments ORDER BY sort_order ASC, name ASC')
        .all() as unknown as DepartmentRow[];
      res.json({
        departments: rows.map((r) => ({
          id: r.id,
          name: r.name,
          isActive: r.is_active === 1,
          sortOrder: r.sort_order,
        })),
      });
    },
  );

  app.post(
    '/api/admin/departments',
    requireAuth,
    requireRole('super_admin'),
    (req: Request, res: Response) => {
      const user = req.authUser!;
      const body = req.body as Record<string, unknown> | null;
      const name = sanitizeString(body?.name, 100);
      if (name.length < 3) {
        res.status(400).json({ error: 'Nama bidang minimal 3 karakter.' });
        return;
      }

      const existing = db
        .prepare('SELECT id FROM departments WHERE LOWER(name) = LOWER(?)')
        .get(name) as { id: string } | undefined;
      if (existing) {
        res.status(409).json({ error: 'Nama bidang tersebut sudah ada.' });
        return;
      }

      const maxSortRow = db
        .prepare('SELECT COALESCE(MAX(sort_order), 0) as maxSort FROM departments')
        .get() as { maxSort: number };

      const id = crypto.randomUUID();
      const sortOrder = (maxSortRow?.maxSort ?? 0) + 1;
      db.prepare(
        'INSERT INTO departments (id, name, is_active, sort_order, created_at) VALUES (?, ?, 1, ?, ?)',
      ).run(id, name, sortOrder, Date.now());

      recordAuditLog(user.username, user.role, 'ADD_DEPARTMENT', name, 'Menambahkan master bidang baru');
      res.status(201).json({
        department: { id, name, isActive: true, sortOrder },
      });
    },
  );

  app.patch(
    '/api/admin/departments/:id',
    requireAuth,
    requireRole('super_admin'),
    (req: Request, res: Response) => {
      const user = req.authUser!;
      const id = String(req.params.id || '');
      const body = req.body as Record<string, unknown> | null;
      const row = db
        .prepare('SELECT * FROM departments WHERE id = ?')
        .get(id) as unknown as DepartmentRow | undefined;
      if (!row) {
        res.status(404).json({ error: 'Bidang tidak ditemukan.' });
        return;
      }

      const nextName =
        typeof body?.name === 'string' && body.name.trim().length >= 3
          ? body.name.trim().slice(0, 100)
          : row.name;
      const nextActive =
        typeof body?.isActive === 'boolean' ? (body.isActive ? 1 : 0) : row.is_active;

      if (nextActive === 0) {
        const activeCount = db
          .prepare('SELECT COUNT(*) as total FROM departments WHERE is_active = 1 AND id != ?')
          .get(id) as { total: number };
        if ((activeCount?.total ?? 0) === 0) {
          res.status(400).json({ error: 'Minimal harus ada 1 bidang yang tetap aktif.' });
          return;
        }
      }

      db.prepare('UPDATE departments SET name = ?, is_active = ? WHERE id = ?').run(
        nextName,
        nextActive,
        id,
      );

      recordAuditLog(
        user.username,
        user.role,
        'UPDATE_DEPARTMENT',
        nextName,
        `Status aktif: ${nextActive === 1 ? 'Aktif' : 'Nonaktif'}`,
      );

      res.json({
        department: {
          id,
          name: nextName,
          isActive: nextActive === 1,
          sortOrder: row.sort_order,
        },
      });
    },
  );

  // RBAC: User & Role Management (super_admin ONLY)
  app.get(
    '/api/admin/users',
    requireAuth,
    requireRole('super_admin'),
    (_req: Request, res: Response) => {
      const rows = db
        .prepare(
          'SELECT id, username, full_name, role, department, is_active, created_at FROM users ORDER BY created_at DESC',
        )
        .all() as unknown as UserRow[];
      res.json({
        users: rows.map((u) => ({
          id: u.id,
          username: u.username,
          fullName: u.full_name,
          role: u.role,
          department: u.department,
          isActive: u.is_active === 1,
          createdAt: u.created_at,
        })),
      });
    },
  );

  app.post(
    '/api/admin/users',
    requireAuth,
    requireRole('super_admin'),
    (req: Request, res: Response) => {
      const actor = req.authUser!;
      const body = req.body as Record<string, unknown> | null;
      const username = sanitizeString(body?.username, 60);
      const fullName = sanitizeString(body?.fullName, 120);
      const role = sanitizeString(body?.role, 30) as UserRole;
      const department = sanitizeString(body?.department, 100) || 'Semua Bidang';
      const password = typeof body?.password === 'string' ? body.password : '';

      if (!/^[a-zA-Z0-9._-]{3,60}$/.test(username)) {
        res.status(400).json({
          error: 'NIP / Username wajib 3-60 karakter (huruf, angka, titik, atau garis bawah).',
        });
        return;
      }
      if (fullName.length < 2) {
        res.status(400).json({ error: 'Nama lengkap wajib diisi.' });
        return;
      }
      if (!VALID_ROLES.has(role)) {
        res.status(400).json({ error: 'Peran RBAC tidak valid.' });
        return;
      }
      if (password.length < 8 || password.length > 128) {
        res.status(400).json({ error: 'Kata sandi wajib 8 sampai 128 karakter.' });
        return;
      }

      const existing = db
        .prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)')
        .get(username) as { id: string } | undefined;
      if (existing) {
        res.status(409).json({ error: 'NIP / Username tersebut sudah terdaftar.' });
        return;
      }

      const assignedDepartment =
        role === 'pimpinan' ? department : 'Semua Bidang';

      const id = crypto.randomUUID();
      const now = Date.now();
      const passwordHash = hashPasswordScrypt(password);

      db.prepare(
        `INSERT INTO users (id, username, full_name, role, department, password_hash, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      ).run(id, username, fullName, role, assignedDepartment, passwordHash, now, now);

      recordAuditLog(
        actor.username,
        actor.role,
        'CREATE_USER',
        username,
        `Membuat akun ${fullName} dengan peran ${role} (${assignedDepartment})`,
      );

      res.status(201).json({
        user: {
          id,
          username,
          fullName,
          role,
          department: assignedDepartment,
          isActive: true,
          createdAt: now,
        },
      });
    },
  );

  app.patch(
    '/api/admin/users/:id',
    requireAuth,
    requireRole('super_admin'),
    (req: Request, res: Response) => {
      const actor = req.authUser!;
      const id = String(req.params.id || '');
      const body = req.body as Record<string, unknown> | null;

      const targetUser = db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(id) as unknown as UserRow | undefined;
      if (!targetUser) {
        res.status(404).json({ error: 'Akun pengguna tidak ditemukan.' });
        return;
      }

      const nextRole =
        typeof body?.role === 'string' && VALID_ROLES.has(body.role as UserRole)
          ? (body.role as UserRole)
          : targetUser.role;

      const nextDepartment =
        nextRole === 'pimpinan'
          ? sanitizeString(body?.department, 100) || targetUser.department || 'Semua Bidang'
          : 'Semua Bidang';

      const nextActive =
        typeof body?.isActive === 'boolean' ? (body.isActive ? 1 : 0) : targetUser.is_active;

      if (targetUser.id === actor.id && (nextActive === 0 || nextRole !== 'super_admin')) {
        res.status(400).json({
          error: 'Anda tidak dapat menonaktifkan atau menurunkan peran akun Anda sendiri.',
        });
        return;
      }

      if (targetUser.role === 'super_admin' && (nextActive === 0 || nextRole !== 'super_admin')) {
        const otherSuperAdmins = db
          .prepare(
            "SELECT COUNT(*) as total FROM users WHERE role = 'super_admin' AND is_active = 1 AND id != ?",
          )
          .get(id) as { total: number };
        if ((otherSuperAdmins?.total ?? 0) === 0) {
          res.status(400).json({
            error: 'Minimal harus ada 1 akun Super Admin yang tetap aktif.',
          });
          return;
        }
      }

      let nextPasswordHash = targetUser.password_hash;
      const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
      if (newPassword) {
        if (newPassword.length < 8 || newPassword.length > 128) {
          res.status(400).json({ error: 'Kata sandi baru wajib 8 sampai 128 karakter.' });
          return;
        }
        nextPasswordHash = hashPasswordScrypt(newPassword);
      }

      const now = Date.now();
      db.prepare(
        'UPDATE users SET role = ?, department = ?, is_active = ?, password_hash = ?, updated_at = ? WHERE id = ?',
      ).run(nextRole, nextDepartment, nextActive, nextPasswordHash, now, id);

      if (newPassword) {
        db.prepare(
          "UPDATE password_reset_requests SET status = 'completed', token_hash = NULL, resolved_at = ? WHERE user_id = ? AND status IN ('pending', 'token_issued')",
        ).run(now, id);
      }

      recordAuditLog(
        actor.username,
        actor.role,
        'UPDATE_USER',
        targetUser.username,
        `Role: ${nextRole}, Bidang: ${nextDepartment}, Aktif: ${nextActive === 1}${newPassword ? ', Reset Sandi' : ''}`,
      );

      res.json({
        user: {
          id: targetUser.id,
          username: targetUser.username,
          fullName: targetUser.full_name,
          role: nextRole,
          department: nextDepartment,
          isActive: nextActive === 1,
          createdAt: targetUser.created_at,
        },
      });
    },
  );

  // RBAC: Password Reset Requests Management (super_admin ONLY)
  app.get(
    '/api/admin/password-reset-requests',
    requireAuth,
    requireRole('super_admin'),
    (_req: Request, res: Response) => {
      const rows = db
        .prepare(
          `SELECT id, user_id, username, full_name, role, note, status, token_expires_at, created_at, resolved_at
           FROM password_reset_requests
           ORDER BY CASE WHEN status IN ('pending', 'token_issued') THEN 0 ELSE 1 END, created_at DESC
           LIMIT 50`,
        )
        .all() as unknown as PasswordResetRequestRow[];

      res.json({
        requests: rows.map((r) => ({
          id: r.id,
          userId: r.user_id,
          username: r.username,
          fullName: r.full_name,
          role: r.role,
          note: r.note,
          status: r.status,
          tokenExpiresAt: r.token_expires_at,
          createdAt: r.created_at,
          resolvedAt: r.resolved_at,
        })),
      });
    },
  );

  app.post(
    '/api/admin/password-reset-requests/:id/issue-token',
    requireAuth,
    requireRole('super_admin'),
    (req: Request, res: Response) => {
      const actor = req.authUser!;
      const id = String(req.params.id || '');
      const reqRow = db
        .prepare('SELECT * FROM password_reset_requests WHERE id = ?')
        .get(id) as unknown as PasswordResetRequestRow | undefined;

      if (!reqRow) {
        res.status(404).json({ error: 'Permintaan reset password tidak ditemukan.' });
        return;
      }

      const rawCode = crypto.randomBytes(5).toString('hex').toUpperCase();
      const recoveryCode = `${rawCode.slice(0, 5)}-${rawCode.slice(5)}`;
      const normalizedCode = recoveryCode.replace(/-/g, '');
      const tokenHash = hashCheckoutToken(normalizedCode);
      const expiresAt = Date.now() + 15 * 60 * 1000;

      // Also accept code with or without hyphen by hashing normalizedCode; we'll verify consistently!
      db.prepare(
        "UPDATE password_reset_requests SET status = 'token_issued', token_hash = ?, token_expires_at = ? WHERE id = ?",
      ).run(tokenHash, expiresAt, id);

      recordAuditLog(
        actor.username,
        actor.role,
        'ISSUE_RECOVERY_TOKEN',
        reqRow.username,
        'Menerbitkan kode pemulihan 1x pakai (berlaku 15 menit)',
      );

      res.json({
        recoveryCode,
        expiresAt,
        username: reqRow.username,
      });
    },
  );

  app.post(
    '/api/admin/password-reset-requests/:id/dismiss',
    requireAuth,
    requireRole('super_admin'),
    (req: Request, res: Response) => {
      const actor = req.authUser!;
      const id = String(req.params.id || '');
      const reqRow = db
        .prepare('SELECT * FROM password_reset_requests WHERE id = ?')
        .get(id) as unknown as PasswordResetRequestRow | undefined;

      if (!reqRow) {
        res.status(404).json({ error: 'Permintaan reset password tidak ditemukan.' });
        return;
      }

      db.prepare(
        "UPDATE password_reset_requests SET status = 'rejected', token_hash = NULL, resolved_at = ? WHERE id = ?",
      ).run(Date.now(), id);

      recordAuditLog(
        actor.username,
        actor.role,
        'DISMISS_PASSWORD_RESET',
        reqRow.username,
        'Menutup/menolak permintaan reset kata sandi',
      );

      res.json({ ok: true });
    },
  );

  // RBAC: Audit Logs (super_admin ONLY)
  app.get(
    '/api/admin/audit-logs',
    requireAuth,
    requireRole('super_admin'),
    (_req: Request, res: Response) => {
      const rows = db
        .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200')
        .all() as unknown as AuditLogRow[];
      res.json({
        logs: rows.map((l) => ({
          id: l.id,
          actorUsername: l.actor_username,
          actorRole: l.actor_role,
          action: l.action,
          target: l.target,
          details: l.details,
          createdAt: l.created_at,
        })),
      });
    },
  );

  // Vite dev middleware or static dist serving
  const isProd = process.env.NODE_ENV === 'production';
  const distPath = path.resolve(process.cwd(), 'dist');

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SI-TAMU BPBD server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
