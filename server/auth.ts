import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db, type UserRow } from './db.ts';

export type UserRole = 'super_admin' | 'resepsionis' | 'pimpinan';

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  department: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    authUser?: AuthUser;
  }
}

const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const revokedTokens = new Set<string>();

function getSigningSecret(): string {
  const envSecret = process.env.SESSION_SECRET?.trim();
  return envSecret && envSecret.length >= 16 ? envSecret : EPHEMERAL_SECRET;
}

export function hashPasswordScrypt(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPasswordScrypt(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export function hashCheckoutToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function verifyCheckoutToken(rawToken: string, storedHash: string): boolean {
  const candidateHash = hashCheckoutToken(rawToken);
  const a = Buffer.from(candidateHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function getAdminCredentialState(): {
  configured: boolean;
  source: 'env' | 'database' | 'unconfigured';
} {
  const userCount = db.prepare('SELECT COUNT(*) as total FROM users').get() as { total: number };
  if ((userCount?.total ?? 0) > 0) {
    return { configured: true, source: 'database' };
  }

  const envPassword = process.env.ADMIN_PASSWORD?.trim();
  if (envPassword && envPassword.length > 0) {
    return { configured: true, source: 'env' };
  }

  const legacyRow = db
    .prepare('SELECT value FROM admin_config WHERE key = ?')
    .get('admin_password_hash') as { value: string } | undefined;

  if (legacyRow && legacyRow.value) {
    return { configured: true, source: 'database' };
  }

  return { configured: false, source: 'unconfigured' };
}

export function authenticateInternalUser(username: string, password: string): AuthUser | null {
  const normalizedUsername = username.trim().toLowerCase();
  if (!normalizedUsername || !password) return null;

  // Check database users table first
  const userRow = db
    .prepare('SELECT * FROM users WHERE LOWER(username) = ?')
    .get(normalizedUsername) as unknown as UserRow | undefined;

  if (userRow) {
    if (userRow.is_active !== 1) return null;
    if (!verifyPasswordScrypt(password, userRow.password_hash)) return null;
    return {
      id: userRow.id,
      username: userRow.username,
      fullName: userRow.full_name,
      role: userRow.role,
      department: userRow.department || 'Semua Bidang',
    };
  }

  // Fallback for env-configured super admin or legacy admin_config if users table has no matching row
  if (normalizedUsername === 'admin' || normalizedUsername === 'superadmin') {
    const envPassword = process.env.ADMIN_PASSWORD?.trim();
    if (envPassword && envPassword.length > 0) {
      const a = crypto.createHash('sha256').update(password).digest();
      const b = crypto.createHash('sha256').update(envPassword).digest();
      if (crypto.timingSafeEqual(a, b)) {
        return {
          id: 'env-super-admin',
          username: 'admin',
          fullName: 'Pengadministrasi Umum (Super Admin)',
          role: 'super_admin',
          department: 'Semua Bidang',
        };
      }
    }

    const legacyRow = db
      .prepare('SELECT value FROM admin_config WHERE key = ?')
      .get('admin_password_hash') as { value: string } | undefined;
    if (legacyRow && legacyRow.value && verifyPasswordScrypt(password, legacyRow.value)) {
      return {
        id: 'legacy-super-admin',
        username: 'admin',
        fullName: 'Pengadministrasi Umum (Super Admin)',
        role: 'super_admin',
        department: 'Semua Bidang',
      };
    }
  }

  return null;
}

interface TokenPayload {
  sub: string;
  username: string;
  role: UserRole;
  jti: string;
  iat: number;
  exp: number;
}

export function issueUserToken(user: AuthUser): string {
  const now = Date.now();
  const payload: TokenPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifyUserToken(token: string): AuthUser | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payloadB64)
    .digest();

  let providedSig: Buffer;
  try {
    providedSig = Buffer.from(sigB64, 'base64url');
  } catch {
    return null;
  }

  if (expectedSig.length !== providedSig.length) return null;
  if (!crypto.timingSafeEqual(expectedSig, providedSig)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as TokenPayload;
    if (!parsed.sub || !parsed.jti || typeof parsed.exp !== 'number') {
      return null;
    }
    if (Date.now() > parsed.exp) {
      return null;
    }
    if (revokedTokens.has(parsed.jti)) {
      return null;
    }

    if (parsed.sub === 'env-super-admin' || parsed.sub === 'legacy-super-admin') {
      return {
        id: parsed.sub,
        username: parsed.username || 'admin',
        fullName: 'Pengadministrasi Umum (Super Admin)',
        role: 'super_admin',
        department: 'Semua Bidang',
      };
    }

    // Re-read authoritative user role & active state from SQLite
    const userRow = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(parsed.sub) as unknown as UserRow | undefined;

    if (!userRow || userRow.is_active !== 1) {
      return null;
    }

    return {
      id: userRow.id,
      username: userRow.username,
      fullName: userRow.full_name,
      role: userRow.role,
      department: userRow.department || 'Semua Bidang',
    };
  } catch {
    return null;
  }
}

export function revokeUserToken(token: string): void {
  const parts = token.split('.');
  if (parts.length !== 2) return;
  try {
    const parsed = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as TokenPayload;
    if (parsed.jti) revokedTokens.add(parsed.jti);
  } catch {
    // ignore malformed token
  }
}

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7).trim() || null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  const authUser = token ? verifyUserToken(token) : null;
  if (!authUser) {
    res.status(401).json({ error: 'Sesi login tidak valid atau telah berakhir. Silakan masuk kembali.' });
    return;
  }
  req.authUser = authUser;
  next();
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Autentikasi diperlukan.' });
      return;
    }
    if (!allowedRoles.includes(req.authUser.role)) {
      res.status(403).json({
        error: 'Akses ditolak. Peran akun Anda tidak memiliki izin untuk tindakan ini.',
      });
      return;
    }
    next();
  };
}
