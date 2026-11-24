import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Request, Response } from 'express';
import { getWibDateString, getWibMonthPrefix, mapVisitRow } from './server/db.ts';
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
import { getSupportResetEmail, isSmtpConfigured, sendPasswordResetEmail } from './server/mailer.ts';
import {
  bootstrapSuperAdmin,
  closeOpenResetRequestsForUser,
  countOtherActiveDepartments,
  countOtherActiveSuperAdmins,
  createUser,
  deleteVisitById,
  dismissResetRequest,
  findDepartmentById,
  findDepartmentByNameInsensitive,
  findPasswordResetRequestById,
  findRecentOpenResetRequest,
  findUserById,
  findUserByUsernameInsensitive,
  findVisitById,
  getActiveStorageBackend,
  getDashboardData,
  getMaxDepartmentSortOrder,
  insertDepartment,
  insertPasswordResetRequest,
  insertVisitTransaction,
  issueResetRequestToken,
  listAuditLogs,
  listDepartments,
  listFilteredVisits,
  listPasswordResetRequests,
  listUsers,
  listValidIssuedResetRequests,
  markResetRequestCompleted,
  recordAuditLog,
  updateDepartment,
  updateUser,
  updateUserPassword,
  updateVisitStatus,
} from './server/store.ts';

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

async function getActiveDepartmentSet(): Promise<Set<string>> {
  const rows = await listDepartments(true);
  return new Set(rows.map((r) => r.name));
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
  app.get('/api/departments', async (_req: Request, res: Response) => {
    try {
      const rows = await listDepartments(true);
      res.json({
        departments: rows.map((r) => ({
          id: r.id,
          name: r.name,
          isActive: r.is_active === 1,
          sortOrder: r.sort_order,
        })),
      });
    } catch (err) {
      console.error('Error fetching departments:', err);
      res.status(500).json({ error: 'Gagal memuat daftar bidang tujuan.' });
    }
  });

  // Public: Submit Guest Registration
  app.post('/api/visits', async (req: Request, res: Response) => {
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

    try {
      const activeDepartments = await getActiveDepartmentSet();

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

      const checkoutToken = crypto.randomBytes(24).toString('base64url');
      const checkoutTokenHash = hashCheckoutToken(checkoutToken);

      const inserted = await insertVisitTransaction({
        fullName,
        phone,
        visitorCategory,
        institutionAddress,
        department,
        purpose,
        signatureData,
        checkoutTokenHash,
      });

      res.status(201).json({
        visit: mapVisitRow(inserted),
        checkoutToken,
      });
    } catch (err) {
      console.error('Error creating visit:', err);
      res.status(500).json({ error: 'Gagal menyimpan data kunjungan. Silakan coba lagi.' });
    }
  });

  // Public (with visitor checkout token header): Retrieve own receipt
  app.get('/api/visits/:id/receipt', async (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const token = req.headers['x-checkout-token'];
    if (!id || typeof token !== 'string' || !token) {
      res.status(401).json({ error: 'Token bukti kunjungan tidak ditemukan.' });
      return;
    }

    try {
      const row = await findVisitById(id);
      if (!row || !verifyCheckoutToken(token, row.checkout_token_hash)) {
        res.status(404).json({ error: 'Bukti kunjungan tidak ditemukan atau token tidak cocok.' });
        return;
      }

      res.json({ visit: mapVisitRow(row) });
    } catch (err) {
      console.error('Error reading visit receipt:', err);
      res.status(500).json({ error: 'Gagal memuat bukti kunjungan.' });
    }
  });

  // Public (with visitor checkout token header): Self Check-Out
  app.post('/api/visits/:id/checkout', async (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const token = req.headers['x-checkout-token'];
    if (!id || typeof token !== 'string' || !token) {
      res.status(401).json({ error: 'Token bukti kunjungan tidak valid.' });
      return;
    }

    try {
      const row = await findVisitById(id);
      if (!row || !verifyCheckoutToken(token, row.checkout_token_hash)) {
        res.status(404).json({ error: 'Bukti kunjungan tidak ditemukan atau token tidak cocok.' });
        return;
      }

      if (row.status === 'Selesai') {
        res.json({ visit: mapVisitRow(row) });
        return;
      }

      const checkOutAt = new Date().toISOString();
      const updated = await updateVisitStatus(id, 'Selesai', checkOutAt);
      res.json({ visit: mapVisitRow(updated) });
    } catch (err) {
      console.error('Error checking out visit:', err);
      res.status(500).json({ error: 'Gagal mencatat Check-Out kunjungan.' });
    }
  });

  // Admin / Internal Auth Status & First-Run Bootstrap
  app.get('/api/admin/auth-status', async (req: Request, res: Response) => {
    try {
      const credState = await getAdminCredentialState();
      const token = extractBearerToken(req);
      const user = token ? await verifyUserToken(token) : null;
      res.json({
        configured: credState.configured,
        source: credState.source,
        authenticated: Boolean(user),
        user,
        supportEmail: getSupportResetEmail(),
        smtpConfigured: isSmtpConfigured(),
      });
    } catch (err) {
      console.error('Error loading auth-status:', err);
      res.status(500).json({ error: 'Gagal memeriksa status autentikasi.' });
    }
  });

  app.post('/api/admin/bootstrap', async (req: Request, res: Response) => {
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

    try {
      const credState = await getAdminCredentialState();
      if (credState.configured) {
        res.status(409).json({ error: 'Akun internal sudah dikonfigurasi. Silakan masuk melalui halaman login.' });
        return;
      }

      const id = crypto.randomUUID();
      const now = Date.now();
      const passwordHash = hashPasswordScrypt(password);

      const status = await bootstrapSuperAdmin({
        id,
        username,
        fullName,
        passwordHash,
        now,
      });

      if (status === 'already_configured') {
        res.status(409).json({ error: 'Akun Super Admin sudah dibuat sebelumnya. Silakan login.' });
        return;
      }

      const authUser = {
        id,
        username,
        fullName,
        role: 'super_admin' as const,
        department: 'Semua Bidang',
      };
      await recordAuditLog(username, 'super_admin', 'BOOTSTRAP_SUPER_ADMIN', username, 'Aktivasi akun Super Admin pertama');
      const token = issueUserToken(authUser);
      res.status(201).json({ token, user: authUser });
    } catch (err) {
      console.error('Error bootstrapping super admin:', err);
      res.status(500).json({ error: 'Gagal menyimpan akun Super Admin.' });
    }
  });

  app.post('/api/admin/login', async (req: Request, res: Response) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(ip)) {
      res.status(429).json({ error: 'Terlalu banyak percobaan login. Silakan tunggu beberapa menit.' });
      return;
    }

    try {
      const credState = await getAdminCredentialState();
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

      const authUser = await authenticateInternalUser(username, password);
      if (!authUser) {
        res.status(401).json({ error: 'NIP / Username atau kata sandi salah, atau akun tidak aktif.' });
        return;
      }

      await recordAuditLog(authUser.username, authUser.role, 'LOGIN', authUser.username, 'Berhasil masuk ke sistem');
      const token = issueUserToken(authUser);
      res.json({ token, user: authUser });
    } catch (err) {
      console.error('Error logging in:', err);
      res.status(500).json({ error: 'Gagal memproses login.' });
    }
  });

  app.post('/api/admin/logout', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (token) {
      try {
        const user = await verifyUserToken(token);
        if (user) {
          await recordAuditLog(user.username, user.role, 'LOGOUT', user.username, 'Keluar dari sistem');
        }
      } catch {
        // ignore verification failure during logout
      }
      revokeUserToken(token);
    }
    res.json({ ok: true });
  });

  // Public (Rate-Limited): Forgot Password Request to Super Admin & Helpdesk Email
  app.post('/api/admin/forgot-password', async (req: Request, res: Response) => {
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

    const supportEmail = getSupportResetEmail();
    const smtpReady = isSmtpConfigured();

    try {
      const userRow = await findUserByUsernameInsensitive(username);

      if (userRow && userRow.is_active === 1) {
        const now = Date.now();
        const recentReq = await findRecentOpenResetRequest(userRow.id, now - 2 * 60 * 1000);

        if (!recentReq) {
          const reqId = crypto.randomUUID();
          let emailSentForUser = false;

          if (smtpReady) {
            const rawCode = crypto.randomBytes(5).toString('hex').toUpperCase();
            const recoveryCode = `${rawCode.slice(0, 5)}-${rawCode.slice(5)}`;
            const tokenHash = hashCheckoutToken(rawCode);
            const expiresAt = now + 15 * 60 * 1000;

            const requestedAtWib = new Intl.DateTimeFormat('id-ID', {
              timeZone: 'Asia/Jakarta',
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(now));

            const mailResult = await sendPasswordResetEmail({
              username: userRow.username,
              fullName: userRow.full_name,
              role: userRow.role,
              note,
              recoveryCode,
              requestedAtWib: `${requestedAtWib} WIB`,
            });

            if (mailResult.sent) {
              emailSentForUser = true;
              await insertPasswordResetRequest({
                id: reqId,
                userId: userRow.id,
                username: userRow.username,
                fullName: userRow.full_name,
                role: userRow.role,
                note,
                status: 'token_issued',
                tokenHash,
                tokenExpiresAt: expiresAt,
                createdAt: now,
              });

              await recordAuditLog(
                userRow.username,
                userRow.role,
                'REQUEST_PASSWORD_RESET',
                userRow.username,
                `Kode pemulihan 1x pakai dikirim ke email bantuan ${supportEmail}`,
              );
            }
          }

          if (!emailSentForUser) {
            await insertPasswordResetRequest({
              id: reqId,
              userId: userRow.id,
              username: userRow.username,
              fullName: userRow.full_name,
              role: userRow.role,
              note,
              status: 'pending',
              createdAt: now,
            });

            await recordAuditLog(
              userRow.username,
              userRow.role,
              'REQUEST_PASSWORD_RESET',
              userRow.username,
              note
                ? `Pengajuan lupa password (bantuan email ${supportEmail}): ${note}`
                : `Mengajukan reset kata sandi (bantuan email ${supportEmail})`,
            );
          }
        }
      }

      // Non-enumerating response: reply depends only on server SMTP configuration, never on user existence
      res.json({
        ok: true,
        supportEmail,
        emailSent: smtpReady,
        message: smtpReady
          ? `Permintaan reset kata sandi telah diproses. Jika NIP / Username terdaftar dan aktif, kode pemulihan 1x pakai telah dikirimkan ke email bantuan (${supportEmail}).`
          : `Permintaan reset kata sandi telah dicatat untuk Super Admin. Gunakan tombol "Kirim via Email" di bawah untuk meneruskan permintaan langsung ke ${supportEmail}.`,
      });
    } catch (err) {
      console.error('Error processing forgot password:', err);
      res.status(500).json({ error: 'Gagal memproses permintaan reset kata sandi.' });
    }
  });

  // Public (Rate-Limited): Reset Password via One-Time Recovery Code or Server ADMIN_RECOVERY_KEY
  app.post('/api/admin/reset-password', async (req: Request, res: Response) => {
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

    try {
      const userRow = await findUserByUsernameInsensitive(username);

      if (!userRow || userRow.is_active !== 1) {
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
      const issuedRequests = await listValidIssuedResetRequests(userRow.id, now);

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

      if (!authorizedMethod) {
        res.status(401).json({
          error: 'NIP / Username atau kode pemulihan tidak valid atau sudah kedaluwarsa.',
        });
        return;
      }

      const nextHash = hashPasswordScrypt(newPassword);
      await updateUserPassword(userRow.id, nextHash, now);

      if (matchedRequestId) {
        await markResetRequestCompleted(matchedRequestId, now);
      }
      await closeOpenResetRequestsForUser(userRow.id, now);

      await recordAuditLog(
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
    } catch (err) {
      console.error('Error resetting password:', err);
      res.status(500).json({ error: 'Gagal memperbarui kata sandi.' });
    }
  });

  // RBAC-Protected Dashboard Data (All 3 roles, scoped per role)
  app.get(
    '/api/admin/dashboard',
    requireAuth,
    requireRole('super_admin', 'resepsionis', 'pimpinan'),
    async (req: Request, res: Response) => {
      try {
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

        const scopedDepartment =
          user.role === 'pimpinan' && user.department && user.department !== 'Semua Bidang'
            ? user.department
            : undefined;
        const scopedDate = user.role === 'resepsionis' ? todayWib : undefined;

        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
        const department = typeof req.query.department === 'string' ? req.query.department.trim() : '';
        const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
        const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom.trim() : '';
        const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo.trim() : '';

        const result = await getDashboardData({
          filters: {
            search,
            department,
            status,
            dateFrom,
            dateTo,
            forcedDate: scopedDate,
            forcedDepartment: scopedDepartment,
          },
          todayWib,
          weekStartWib,
          monthPrefix,
          currentYear,
          lastYear,
        });

        res.json(result);
      } catch (err) {
        console.error('Error loading dashboard:', err);
        res.status(500).json({ error: 'Gagal memuat data dashboard.' });
      }
    },
  );

  // RBAC: Staff-Assisted Manual Visit Entry (super_admin & resepsionis only)
  app.post(
    '/api/admin/manual-visit',
    requireAuth,
    requireRole('super_admin', 'resepsionis'),
    async (req: Request, res: Response) => {
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

      try {
        const activeDepartments = await getActiveDepartmentSet();

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

        const checkoutToken = crypto.randomBytes(24).toString('base64url');
        const checkoutTokenHash = hashCheckoutToken(checkoutToken);

        const inserted = await insertVisitTransaction({
          fullName,
          phone,
          visitorCategory,
          institutionAddress,
          department,
          purpose,
          signatureData,
          checkoutTokenHash,
        });

        const visit = mapVisitRow(inserted);
        await recordAuditLog(
          user.username,
          user.role,
          'MANUAL_CHECKIN',
          visit.queueCode,
          `Input bantuan petugas untuk ${fullName} (${department})`,
        );

        res.status(201).json({ visit, checkoutToken });
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
    async (req: Request, res: Response) => {
      const user = req.authUser!;
      const id = String(req.params.id || '');
      const body = req.body as Record<string, unknown> | null;
      const targetStatus = typeof body?.status === 'string' ? body.status : '';

      if (targetStatus !== 'Selesai' && targetStatus !== 'Sedang Berkunjung') {
        res.status(400).json({ error: 'Status kunjungan tidak valid.' });
        return;
      }

      try {
        const row = await findVisitById(id);
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
        const updated = await updateVisitStatus(id, targetStatus, checkOutAt);

        await recordAuditLog(
          user.username,
          user.role,
          'UPDATE_VISIT_STATUS',
          row.queue_code,
          `Status ${row.full_name} diubah menjadi ${targetStatus}`,
        );

        res.json({ visit: mapVisitRow(updated) });
      } catch (err) {
        console.error('Error updating visit status:', err);
        res.status(500).json({ error: 'Gagal memperbarui status kunjungan.' });
      }
    },
  );

  // RBAC: Delete entry (super_admin ONLY)
  app.delete(
    '/api/admin/visits/:id',
    requireAuth,
    requireRole('super_admin'),
    async (req: Request, res: Response) => {
      const user = req.authUser!;
      const id = String(req.params.id || '');

      try {
        const row = await findVisitById(id);
        if (!row) {
          res.status(404).json({ error: 'Data kunjungan tidak ditemukan.' });
          return;
        }
        await deleteVisitById(id);
        await recordAuditLog(
          user.username,
          user.role,
          'DELETE_VISIT',
          row.queue_code,
          `Menghapus data kunjungan ${row.full_name}`,
        );
        res.json({ ok: true });
      } catch (err) {
        console.error('Error deleting visit:', err);
        res.status(500).json({ error: 'Gagal menghapus data kunjungan.' });
      }
    },
  );

  // RBAC: Export CSV (super_admin ONLY)
  app.get(
    '/api/admin/export',
    requireAuth,
    requireRole('super_admin'),
    async (req: Request, res: Response) => {
      try {
        const user = req.authUser!;
        const rows = await listFilteredVisits({
          search: typeof req.query.search === 'string' ? req.query.search.trim() : '',
          department: typeof req.query.department === 'string' ? req.query.department.trim() : '',
          status: typeof req.query.status === 'string' ? req.query.status.trim() : '',
          dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom.trim() : '',
          dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo.trim() : '',
        });

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

        await recordAuditLog(
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
      } catch (err) {
        console.error('Error exporting CSV:', err);
        res.status(500).json({ error: 'Gagal mengekspor data CSV.' });
      }
    },
  );

  // RBAC: Master Departments Management (super_admin ONLY)
  app.get(
    '/api/admin/departments',
    requireAuth,
    requireRole('super_admin'),
    async (_req: Request, res: Response) => {
      try {
        const rows = await listDepartments(false);
        res.json({
          departments: rows.map((r) => ({
            id: r.id,
            name: r.name,
            isActive: r.is_active === 1,
            sortOrder: r.sort_order,
          })),
        });
      } catch (err) {
        console.error('Error listing admin departments:', err);
        res.status(500).json({ error: 'Gagal memuat master bidang.' });
      }
    },
  );

  app.post(
    '/api/admin/departments',
    requireAuth,
    requireRole('super_admin'),
    async (req: Request, res: Response) => {
      const user = req.authUser!;
      const body = req.body as Record<string, unknown> | null;
      const name = sanitizeString(body?.name, 100);
      if (name.length < 3) {
        res.status(400).json({ error: 'Nama bidang minimal 3 karakter.' });
        return;
      }

      try {
        const existing = await findDepartmentByNameInsensitive(name);
        if (existing) {
          res.status(409).json({ error: 'Nama bidang tersebut sudah ada.' });
          return;
        }

        const maxSort = await getMaxDepartmentSortOrder();
        const id = crypto.randomUUID();
        const sortOrder = maxSort + 1;
        await insertDepartment({ id, name, sortOrder, createdAt: Date.now() });

        await recordAuditLog(user.username, user.role, 'ADD_DEPARTMENT', name, 'Menambahkan master bidang baru');
        res.status(201).json({
          department: { id, name, isActive: true, sortOrder },
        });
      } catch (err) {
        console.error('Error adding department:', err);
        res.status(500).json({ error: 'Gagal menambahkan master bidang.' });
      }
    },
  );

  app.patch(
    '/api/admin/departments/:id',
    requireAuth,
    requireRole('super_admin'),
    async (req: Request, res: Response) => {
      const user = req.authUser!;
      const id = String(req.params.id || '');
      const body = req.body as Record<string, unknown> | null;

      try {
        const row = await findDepartmentById(id);
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
          const activeCount = await countOtherActiveDepartments(id);
          if (activeCount === 0) {
            res.status(400).json({ error: 'Minimal harus ada 1 bidang yang tetap aktif.' });
            return;
          }
        }

        await updateDepartment(id, nextName, nextActive);

        await recordAuditLog(
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
      } catch (err) {
        console.error('Error updating department:', err);
        res.status(500).json({ error: 'Gagal memperbarui master bidang.' });
      }
    },
  );

  // RBAC: User & Role Management (super_admin ONLY)
  app.get(
    '/api/admin/users',
    requireAuth,
    requireRole('super_admin'),
    async (_req: Request, res: Response) => {
      try {
        const rows = await listUsers();
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
      } catch (err) {
        console.error('Error listing users:', err);
        res.status(500).json({ error: 'Gagal memuat daftar akun RBAC.' });
      }
    },
  );

  app.post(
    '/api/admin/users',
    requireAuth,
    requireRole('super_admin'),
    async (req: Request, res: Response) => {
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

      try {
        const existing = await findUserByUsernameInsensitive(username);
        if (existing) {
          res.status(409).json({ error: 'NIP / Username tersebut sudah terdaftar.' });
          return;
        }

        const assignedDepartment = role === 'pimpinan' ? department : 'Semua Bidang';
        const id = crypto.randomUUID();
        const now = Date.now();
        const passwordHash = hashPasswordScrypt(password);

        await createUser({
          id,
          username,
          fullName,
          role,
          department: assignedDepartment,
          passwordHash,
          now,
        });

        await recordAuditLog(
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
      } catch (err) {
        console.error('Error creating user:', err);
        res.status(500).json({ error: 'Gagal membuat akun pengguna baru.' });
      }
    },
  );

  app.patch(
    '/api/admin/users/:id',
    requireAuth,
    requireRole('super_admin'),
    async (req: Request, res: Response) => {
      const actor = req.authUser!;
      const id = String(req.params.id || '');
      const body = req.body as Record<string, unknown> | null;

      try {
        const targetUser = await findUserById(id);
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
          const otherCount = await countOtherActiveSuperAdmins(id);
          if (otherCount === 0) {
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
        await updateUser(id, {
          role: nextRole,
          department: nextDepartment,
          isActive: nextActive,
          passwordHash: nextPasswordHash,
          now,
        });

        if (newPassword) {
          await closeOpenResetRequestsForUser(id, now);
        }

        await recordAuditLog(
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
      } catch (err) {
        console.error('Error updating user:', err);
        res.status(500).json({ error: 'Gagal memperbarui akun pengguna.' });
      }
    },
  );

  // RBAC: Password Reset Requests Management (super_admin ONLY)
  app.get(
    '/api/admin/password-reset-requests',
    requireAuth,
    requireRole('super_admin'),
    async (_req: Request, res: Response) => {
      try {
        const rows = await listPasswordResetRequests(50);
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
      } catch (err) {
        console.error('Error listing password reset requests:', err);
        res.status(500).json({ error: 'Gagal memuat permintaan reset kata sandi.' });
      }
    },
  );

  app.post(
    '/api/admin/password-reset-requests/:id/issue-token',
    requireAuth,
    requireRole('super_admin'),
    async (req: Request, res: Response) => {
      const actor = req.authUser!;
      const id = String(req.params.id || '');

      try {
        const reqRow = await findPasswordResetRequestById(id);
        if (!reqRow) {
          res.status(404).json({ error: 'Permintaan reset password tidak ditemukan.' });
          return;
        }

        const rawCode = crypto.randomBytes(5).toString('hex').toUpperCase();
        const recoveryCode = `${rawCode.slice(0, 5)}-${rawCode.slice(5)}`;
        const normalizedCode = recoveryCode.replace(/-/g, '');
        const tokenHash = hashCheckoutToken(normalizedCode);
        const expiresAt = Date.now() + 15 * 60 * 1000;

        await issueResetRequestToken(id, tokenHash, expiresAt);

        await recordAuditLog(
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
      } catch (err) {
        console.error('Error issuing recovery token:', err);
        res.status(500).json({ error: 'Gagal menerbitkan kode pemulihan.' });
      }
    },
  );

  app.post(
    '/api/admin/password-reset-requests/:id/dismiss',
    requireAuth,
    requireRole('super_admin'),
    async (req: Request, res: Response) => {
      const actor = req.authUser!;
      const id = String(req.params.id || '');

      try {
        const reqRow = await findPasswordResetRequestById(id);
        if (!reqRow) {
          res.status(404).json({ error: 'Permintaan reset password tidak ditemukan.' });
          return;
        }

        await dismissResetRequest(id, Date.now());

        await recordAuditLog(
          actor.username,
          actor.role,
          'DISMISS_PASSWORD_RESET',
          reqRow.username,
          'Menutup/menolak permintaan reset kata sandi',
        );

        res.json({ ok: true });
      } catch (err) {
        console.error('Error dismissing password reset request:', err);
        res.status(500).json({ error: 'Gagal menutup permintaan reset kata sandi.' });
      }
    },
  );

  // RBAC: Audit Logs (super_admin ONLY)
  app.get(
    '/api/admin/audit-logs',
    requireAuth,
    requireRole('super_admin'),
    async (_req: Request, res: Response) => {
      try {
        const rows = await listAuditLogs(200);
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
      } catch (err) {
        console.error('Error listing audit logs:', err);
        res.status(500).json({ error: 'Gagal memuat log audit.' });
      }
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
    console.log(
      `SI-TAMU BPBD server running at http://0.0.0.0:${PORT} (storage: ${getActiveStorageBackend()})`,
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
