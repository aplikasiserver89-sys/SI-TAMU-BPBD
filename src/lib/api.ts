import type {
  AdminAuthStatus,
  AuditLogRecord,
  AuthUser,
  BackupConflictMode,
  BackupDataBundle,
  BackupImportResult,
  DashboardStats,
  DepartmentRecord,
  ManagedUser,
  PasswordResetRequestRecord,
  UserRole,
  VisitRecord,
  VisitSubmissionResponse,
} from '../types';
import { getTodayWib } from './format';
import { getBrowserSupabase, isBrowserSupabaseConfigured } from './supabaseClient';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

interface RpcPayload {
  ok?: boolean;
  status?: number;
  error?: string;
}

async function callSupabaseRpc<T extends RpcPayload>(
  fnName: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase.rpc(fnName, params);
  if (error) {
    console.error(`Supabase RPC ${fnName} error:`, error);
    throw new ApiError(
      500,
      'Gagal terhubung ke database Supabase. Pastikan script SQL Supabase sudah dijalankan.',
    );
  }
  const payload = (data ?? {}) as T;
  if (payload.ok === false) {
    throw new ApiError(Number(payload.status || 400), payload.error || 'Permintaan gagal diproses.');
  }
  return payload;
}

async function fetchApiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // ignore non-JSON body
  }
  if (!res.ok) {
    const msg =
      typeof data.error === 'string' && data.error
        ? data.error
        : 'Terjadi kesalahan saat menghubungi server.';
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

function sanitizeCsvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const neutralized = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  const escaped = neutralized.replace(/"/g, '""');
  return `"${escaped}"`;
}

// ============================================================================
// Public Guest & Auth Status API
// ============================================================================

export async function fetchPublicDepartments(): Promise<DepartmentRecord[]> {
  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<RpcPayload & { departments?: DepartmentRecord[] }>(
      'api_get_public_departments',
    );
    return data.departments ?? [];
  }

  const data = await fetchApiJson<{ departments?: DepartmentRecord[] }>('/api/departments');
  return data.departments ?? [];
}

export async function submitPublicVisit(input: {
  fullName: string;
  phone: string;
  visitorCategory: string;
  institutionAddress: string;
  department: string;
  purpose: string;
  signatureData: string;
}): Promise<VisitSubmissionResponse> {
  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<RpcPayload & VisitSubmissionResponse>('api_submit_visit', {
      p_full_name: input.fullName,
      p_phone: input.phone,
      p_visitor_category: input.visitorCategory,
      p_institution_address: input.institutionAddress,
      p_department: input.department,
      p_purpose: input.purpose,
      p_signature_data: input.signatureData,
    });
    return { visit: data.visit, checkoutToken: data.checkoutToken };
  }

  return fetchApiJson<VisitSubmissionResponse>('/api/visits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function fetchVisitReceipt(
  visitId: string,
  checkoutToken: string,
): Promise<VisitRecord> {
  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<RpcPayload & { visit: VisitRecord }>(
      'api_get_visit_receipt',
      {
        p_visit_id: visitId,
        p_checkout_token: checkoutToken,
      },
    );
    return data.visit;
  }

  const data = await fetchApiJson<{ visit: VisitRecord }>(
    `/api/visits/${encodeURIComponent(visitId)}/receipt`,
    {
      headers: { 'X-Checkout-Token': checkoutToken },
    },
  );
  return data.visit;
}

export async function checkoutPublicVisit(
  visitId: string,
  checkoutToken: string,
): Promise<VisitRecord> {
  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<RpcPayload & { visit: VisitRecord }>('api_checkout_visit', {
      p_visit_id: visitId,
      p_checkout_token: checkoutToken,
    });
    return data.visit;
  }

  const data = await fetchApiJson<{ visit: VisitRecord }>(
    `/api/visits/${encodeURIComponent(visitId)}/checkout`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Checkout-Token': checkoutToken,
      },
    },
  );
  return data.visit;
}

export async function fetchAuthStatus(): Promise<AdminAuthStatus> {
  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<RpcPayload & AdminAuthStatus>('api_auth_status');
    return {
      configured: Boolean(data.configured),
      source: data.source ?? 'database',
      authenticated: false,
      user: null,
      supportEmail: data.supportEmail || 'aplikasiserver89@gmail.com',
      smtpConfigured: Boolean(data.smtpConfigured),
    };
  }

  return fetchApiJson<AdminAuthStatus>('/api/admin/auth-status');
}

export async function bootstrapSuperAdminAccount(input: {
  username: string;
  fullName: string;
  password: string;
}): Promise<{ token: string; user: AuthUser }> {
  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<RpcPayload & { token: string; user: AuthUser }>(
      'api_bootstrap_super_admin',
      {
        p_username: input.username,
        p_full_name: input.fullName,
        p_password: input.password,
      },
    );
    return { token: data.token, user: data.user };
  }

  return fetchApiJson<{ token: string; user: AuthUser }>('/api/admin/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function loginInternalUser(input: {
  username: string;
  password: string;
}): Promise<{ token: string; user: AuthUser }> {
  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<RpcPayload & { token: string; user: AuthUser }>(
      'api_login',
      {
        p_username: input.username,
        p_password: input.password,
      },
    );
    return { token: data.token, user: data.user };
  }

  return fetchApiJson<{ token: string; user: AuthUser }>('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function logoutInternalUser(token: string): Promise<void> {
  if (isBrowserSupabaseConfigured()) {
    await callSupabaseRpc<RpcPayload>('api_logout', { p_token: token });
    return;
  }

  await fetch('/api/admin/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function requestPasswordReset(input: {
  username: string;
  note: string;
}): Promise<{ ok: boolean; supportEmail: string; emailSent: boolean; message: string }> {
  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<
      RpcPayload & { supportEmail: string; emailSent: boolean; message: string }
    >('api_request_password_reset', {
      p_username: input.username,
      p_note: input.note,
    });
    return {
      ok: true,
      supportEmail: data.supportEmail || 'aplikasiserver89@gmail.com',
      emailSent: Boolean(data.emailSent),
      message: data.message,
    };
  }

  return fetchApiJson<{ ok: boolean; supportEmail: string; emailSent: boolean; message: string }>(
    '/api/admin/forgot-password',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export async function completePasswordReset(input: {
  username: string;
  recoveryCode: string;
  newPassword: string;
}): Promise<{ ok: boolean; message: string }> {
  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<RpcPayload & { message: string }>(
      'api_complete_password_reset',
      {
        p_username: input.username,
        p_recovery_code: input.recoveryCode,
        p_new_password: input.newPassword,
      },
    );
    return { ok: true, message: data.message };
  }

  return fetchApiJson<{ ok: boolean; message: string }>('/api/admin/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

// ============================================================================
// Protected Dashboard & Admin Management API
// ============================================================================

export async function fetchDashboardData(
  token: string,
  filters: {
    search?: string;
    department?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  },
): Promise<{ stats: DashboardStats; visits: VisitRecord[] }> {
  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<
      RpcPayload & { stats: DashboardStats; visits: VisitRecord[] }
    >('api_admin_dashboard', {
      p_token: token,
      p_search: filters.search || '',
      p_department: filters.department || '',
      p_status: filters.status || '',
      p_date_from: filters.dateFrom || '',
      p_date_to: filters.dateTo || '',
    });
    return { stats: data.stats, visits: data.visits ?? [] };
  }

  const params = new URLSearchParams();
  if (filters.search?.trim()) params.set('search', filters.search.trim());
  if (filters.department) params.set('department', filters.department);
  if (filters.status) params.set('status', filters.status);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  const qs = params.toString();

  return fetchApiJson<{ stats: DashboardStats; visits: VisitRecord[] }>(
    `/api/admin/dashboard${qs ? `?${qs}` : ''}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function createManualVisit(
  token: string,
  input: {
    fullName: string;
    phone: string;
    visitorCategory: string;
    institutionAddress: string;
    department: string;
    purpose: string;
    signatureData: string;
  },
): Promise<VisitSubmissionResponse> {
  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<RpcPayload & VisitSubmissionResponse>(
      'api_admin_manual_visit',
      {
        p_token: token,
        p_full_name: input.fullName,
        p_phone: input.phone,
        p_visitor_category: input.visitorCategory,
        p_institution_address: input.institutionAddress,
        p_department: input.department,
        p_purpose: input.purpose,
        p_signature_data: input.signatureData,
      },
    );
    return { visit: data.visit, checkoutToken: data.checkoutToken };
  }

  return fetchApiJson<VisitSubmissionResponse>('/api/admin/manual-visit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
}

export async function updateVisitStatus(
  token: string,
  visitId: string,
  status: 'Sedang Berkunjung' | 'Selesai',
): Promise<VisitRecord> {
  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<RpcPayload & { visit: VisitRecord }>(
      'api_admin_update_visit_status',
      {
        p_token: token,
        p_visit_id: visitId,
        p_status: status,
      },
    );
    return data.visit;
  }

  const data = await fetchApiJson<{ visit: VisitRecord }>(
    `/api/admin/visits/${encodeURIComponent(visitId)}/status`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status }),
    },
  );
  return data.visit;
}

export async function deleteVisitRecord(token: string, visitId: string): Promise<void> {
  if (isBrowserSupabaseConfigured()) {
    await callSupabaseRpc<RpcPayload>('api_admin_delete_visit', {
      p_token: token,
      p_visit_id: visitId,
    });
    return;
  }

  await fetchApiJson<{ ok: boolean }>(`/api/admin/visits/${encodeURIComponent(visitId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function exportVisitsCsvBlob(
  token: string,
  filters: {
    search?: string;
    department?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  },
): Promise<{ blob: Blob; filename: string }> {
  const filename = `laporan-buku-tamu-bpbd-sidoarjo-${getTodayWib()}.csv`;

  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<RpcPayload & { visits: VisitRecord[] }>(
      'api_admin_export_visits',
      {
        p_token: token,
        p_search: filters.search || '',
        p_department: filters.department || '',
        p_status: filters.status || '',
        p_date_from: filters.dateFrom || '',
        p_date_to: filters.dateTo || '',
      },
    );

    const rows = data.visits ?? [];
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
      const checkInTime = timeFormatter.format(new Date(row.checkInAt));
      const checkOutTime = row.checkOutAt ? timeFormatter.format(new Date(row.checkOutAt)) : '-';
      csvLines.push(
        [
          row.queueCode,
          row.visitDate,
          checkInTime,
          checkOutTime,
          row.fullName,
          row.phone,
          row.visitorCategory,
          row.institutionAddress,
          row.department,
          row.purpose,
          row.status,
        ]
          .map((cell) => sanitizeCsvCell(cell))
          .join(','),
      );
    }

    const csvContent = `\uFEFF${csvLines.join('\r\n')}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    return { blob, filename };
  }

  const params = new URLSearchParams();
  if (filters.search?.trim()) params.set('search', filters.search.trim());
  if (filters.department) params.set('department', filters.department);
  if (filters.status) params.set('status', filters.status);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  const qs = params.toString();

  const res = await fetch(`/api/admin/export${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new ApiError(res.status, 'Gagal mengunduh file Excel (CSV).');
  }
  const blob = await res.blob();
  return { blob, filename };
}

export async function fetchAdminDepartments(token: string): Promise<DepartmentRecord[]> {
  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<RpcPayload & { departments: DepartmentRecord[] }>(
      'api_admin_list_departments',
      { p_token: token },
    );
    return data.departments ?? [];
  }

  const data = await fetchApiJson<{ departments?: DepartmentRecord[] }>('/api/admin/departments', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data.departments ?? [];
}

export async function createAdminDepartment(
  token: string,
  name: string,
): Promise<DepartmentRecord> {
  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<RpcPayload & { department: DepartmentRecord }>(
      'api_admin_create_department',
      { p_token: token, p_name: name },
    );
    return data.department;
  }

  const data = await fetchApiJson<{ department: DepartmentRecord }>('/api/admin/departments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name }),
  });
  return data.department;
}

export async function updateAdminDepartment(
  token: string,
  id: string,
  updates: { name?: string; isActive?: boolean },
): Promise<DepartmentRecord> {
  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<RpcPayload & { department: DepartmentRecord }>(
      'api_admin_update_department',
      {
        p_token: token,
        p_id: id,
        p_name: updates.name ?? null,
        p_is_active: typeof updates.isActive === 'boolean' ? updates.isActive : null,
      },
    );
    return data.department;
  }

  const data = await fetchApiJson<{ department: DepartmentRecord }>(
    `/api/admin/departments/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(updates),
    },
  );
  return data.department;
}

export async function fetchAdminUsers(token: string): Promise<ManagedUser[]> {
  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<RpcPayload & { users: ManagedUser[] }>(
      'api_admin_list_users',
      { p_token: token },
    );
    return data.users ?? [];
  }

  const data = await fetchApiJson<{ users?: ManagedUser[] }>('/api/admin/users', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data.users ?? [];
}

export async function createAdminUser(
  token: string,
  input: {
    username: string;
    fullName: string;
    role: UserRole;
    department: string;
    password: string;
  },
): Promise<ManagedUser> {
  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<RpcPayload & { user: ManagedUser }>(
      'api_admin_create_user',
      {
        p_token: token,
        p_username: input.username,
        p_full_name: input.fullName,
        p_role: input.role,
        p_department: input.department,
        p_password: input.password,
      },
    );
    return data.user;
  }

  const data = await fetchApiJson<{ user: ManagedUser }>('/api/admin/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  return data.user;
}

export async function updateAdminUser(
  token: string,
  userId: string,
  updates: {
    role?: UserRole;
    department?: string;
    isActive?: boolean;
    newPassword?: string;
  },
): Promise<ManagedUser> {
  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<RpcPayload & { user: ManagedUser }>(
      'api_admin_update_user',
      {
        p_token: token,
        p_id: userId,
        p_role: updates.role ?? null,
        p_department: updates.department ?? null,
        p_is_active: typeof updates.isActive === 'boolean' ? updates.isActive : null,
        p_new_password: updates.newPassword ?? null,
      },
    );
    return data.user;
  }

  const data = await fetchApiJson<{ user: ManagedUser }>(
    `/api/admin/users/${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(updates),
    },
  );
  return data.user;
}

export async function fetchPasswordResetRequests(
  token: string,
): Promise<PasswordResetRequestRecord[]> {
  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<RpcPayload & { requests: PasswordResetRequestRecord[] }>(
      'api_admin_list_reset_requests',
      { p_token: token },
    );
    return data.requests ?? [];
  }

  const data = await fetchApiJson<{ requests?: PasswordResetRequestRecord[] }>(
    '/api/admin/password-reset-requests',
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return data.requests ?? [];
}

export async function issuePasswordResetToken(
  token: string,
  requestId: string,
): Promise<{ recoveryCode: string; expiresAt: number; username: string }> {
  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<
      RpcPayload & { recoveryCode: string; expiresAt: number; username: string }
    >('api_admin_issue_reset_token', {
      p_token: token,
      p_request_id: requestId,
    });
    return {
      recoveryCode: data.recoveryCode,
      expiresAt: data.expiresAt,
      username: data.username,
    };
  }

  return fetchApiJson<{ recoveryCode: string; expiresAt: number; username: string }>(
    `/api/admin/password-reset-requests/${encodeURIComponent(requestId)}/issue-token`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function dismissPasswordResetRequest(token: string, requestId: string): Promise<void> {
  if (isBrowserSupabaseConfigured()) {
    await callSupabaseRpc<RpcPayload>('api_admin_dismiss_reset_request', {
      p_token: token,
      p_request_id: requestId,
    });
    return;
  }

  await fetchApiJson<{ ok: boolean }>(
    `/api/admin/password-reset-requests/${encodeURIComponent(requestId)}/dismiss`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function fetchAuditLogs(token: string): Promise<AuditLogRecord[]> {
  if (isBrowserSupabaseConfigured()) {
    const data = await callSupabaseRpc<RpcPayload & { logs: AuditLogRecord[] }>(
      'api_admin_list_audit_logs',
      { p_token: token },
    );
    return data.logs ?? [];
  }

  const data = await fetchApiJson<{ logs?: AuditLogRecord[] }>('/api/admin/audit-logs', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data.logs ?? [];
}

function isMissingRpcError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = String(err.message || '').toLowerCase();
  return (
    err.code === 'PGRST202' ||
    err.code === '42883' ||
    msg.includes('could not find the function') ||
    msg.includes('does not exist')
  );
}

export async function exportBackupBundle(token: string): Promise<BackupDataBundle> {
  if (isBrowserSupabaseConfigured()) {
    const supabase = getBrowserSupabase();
    const { data, error } = await supabase.rpc('api_admin_export_backup', { p_token: token });

    if (!error) {
      const payload = (data ?? {}) as RpcPayload & BackupDataBundle;
      if (payload.ok === false) {
        throw new ApiError(Number(payload.status || 400), payload.error || 'Gagal membuat backup.');
      }
      return {
        format: 'si-tamu-bpbd-backup',
        version: Number(payload.version || 1),
        exportedAt: payload.exportedAt || new Date().toISOString(),
        exportedBy: payload.exportedBy,
        departments: payload.departments ?? [],
        visits: payload.visits ?? [],
      };
    }

    // Fallback gracefully if user hasn't executed the new backup SQL RPC on Supabase yet
    if (isMissingRpcError(error)) {
      const [departments, visitsRes] = await Promise.all([
        fetchAdminDepartments(token),
        callSupabaseRpc<RpcPayload & { visits: VisitRecord[] }>('api_admin_export_visits', {
          p_token: token,
          p_search: '',
          p_department: '',
          p_status: '',
          p_date_from: '',
          p_date_to: '',
        }),
      ]);
      return {
        format: 'si-tamu-bpbd-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        departments,
        visits: visitsRes.visits ?? [],
      };
    }

    console.error('Supabase RPC api_admin_export_backup error:', error);
    throw new ApiError(500, 'Gagal terhubung ke database Supabase untuk mengekspor backup.');
  }

  return fetchApiJson<BackupDataBundle>('/api/admin/backup', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function importBackupBundle(
  token: string,
  backup: BackupDataBundle,
  conflictMode: BackupConflictMode,
): Promise<BackupImportResult> {
  if (isBrowserSupabaseConfigured()) {
    const supabase = getBrowserSupabase();
    const { data, error } = await supabase.rpc('api_admin_import_backup', {
      p_token: token,
      p_backup: backup,
      p_conflict_mode: conflictMode,
    });

    if (error) {
      if (isMissingRpcError(error)) {
        throw new ApiError(
          400,
          'Fungsi SQL import backup (api_admin_import_backup) belum dijalankan di Supabase SQL Editor. Silakan jalankan skrip SQL terbaru pada menu SQL Editor Supabase terlebih dahulu.',
        );
      }
      console.error('Supabase RPC api_admin_import_backup error:', error);
      throw new ApiError(500, 'Gagal memproses import backup di database Supabase.');
    }

    const payload = (data ?? {}) as RpcPayload & { summary?: BackupImportResult };
    if (payload.ok === false) {
      throw new ApiError(
        Number(payload.status || 400),
        payload.error || 'Gagal mengimpor file backup.',
      );
    }

    return (
      payload.summary ?? {
        departmentsAdded: 0,
        departmentsUpdated: 0,
        departmentsSkipped: 0,
        visitsAdded: 0,
        visitsUpdated: 0,
        visitsSkipped: 0,
      }
    );
  }

  const data = await fetchApiJson<{ ok: boolean; summary: BackupImportResult }>(
    '/api/admin/import',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ backup, conflictMode }),
    },
  );
  return data.summary;
}
