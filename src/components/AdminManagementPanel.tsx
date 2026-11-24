import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Building2,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  LifeBuoy,
  Pencil,
  Plus,
  Shield,
  UserPlus,
  X,
} from 'lucide-react';
import {
  ROLE_LABELS,
  USER_ROLES,
  type AuditLogRecord,
  type AuthUser,
  type DepartmentRecord,
  type ManagedUser,
  type PasswordResetRequestRecord,
  type UserRole,
} from '../types';
import {
  ApiError,
  createAdminDepartment,
  createAdminUser,
  dismissPasswordResetRequest,
  fetchAdminDepartments,
  fetchAdminUsers,
  fetchAuditLogs,
  fetchPasswordResetRequests,
  issuePasswordResetToken,
  updateAdminDepartment,
  updateAdminUser,
} from '../lib/api';
import { formatShortDate, formatWibTime } from '../lib/format';

interface AdminManagementPanelProps {
  token: string;
  currentUser: AuthUser;
  mode: 'departments' | 'users' | 'audit';
  onDepartmentsUpdated: () => void;
  onSessionExpired: () => void;
}

export function AdminManagementPanel({
  token,
  currentUser,
  mode,
  onDepartmentsUpdated,
  onSessionExpired,
}: AdminManagementPanelProps) {
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [resetRequests, setResetRequests] = useState<PasswordResetRequestRecord[]>([]);
  const [issuedCodeInfo, setIssuedCodeInfo] = useState<{
    requestId: string;
    username: string;
    recoveryCode: string;
  } | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // New & edit department form
  const deptInputRef = useRef<HTMLInputElement>(null);
  const [newDeptName, setNewDeptName] = useState('');
  const [deptFieldError, setDeptFieldError] = useState('');
  const [savingDept, setSavingDept] = useState(false);
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null);
  const [editingDeptName, setEditingDeptName] = useState('');

  // New user form
  const [newUsername, setNewUsername] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('resepsionis');
  const [newUserDept, setNewUserDept] = useState('Semua Bidang');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [showNewUserPassword, setShowNewUserPassword] = useState(false);
  const [savingUser, setSavingUser] = useState(false);

  // Reset password inline
  const [resetTargetId, setResetTargetId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (mode === 'departments' || mode === 'users') {
        const depts = await fetchAdminDepartments(token);
        setDepartments(depts);
      }

      if (mode === 'users') {
        const [usersList, requestsList] = await Promise.all([
          fetchAdminUsers(token),
          fetchPasswordResetRequests(token),
        ]);
        setUsers(usersList);
        setResetRequests(requestsList);
      }

      if (mode === 'audit') {
        const logsList = await fetchAuditLogs(token);
        setAuditLogs(logsList);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired();
        return;
      }
      setError(err instanceof Error ? err.message : 'Gagal terhubung ke server.');
    } finally {
      setLoading(false);
    }
  }, [mode, token, onSessionExpired]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setDeptFieldError('');
    setNotice('');
    const rawValue = newDeptName.trim() ? newDeptName : deptInputRef.current?.value || '';
    const candidateName = rawValue.trim();

    if (candidateName.length < 3) {
      const msg =
        candidateName.length === 0
          ? 'Silakan ketik nama bidang baru pada kolom input terlebih dahulu (minimal 3 karakter).'
          : 'Nama bidang minimal 3 karakter.';
      setDeptFieldError(msg);
      setError(msg);
      deptInputRef.current?.focus();
      return;
    }

    setSavingDept(true);
    try {
      const dept = await createAdminDepartment(token, candidateName);
      setNewDeptName('');
      if (deptInputRef.current) {
        deptInputRef.current.value = '';
      }
      setDepartments((prev) => {
        if (prev.some((d) => d.id === dept.id)) return prev;
        return [...prev, dept];
      });
      setNotice(`Bidang "${dept.name}" berhasil ditambahkan dan aktif di Formulir Tamu.`);
      onDepartmentsUpdated();
      await loadData();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired();
        return;
      }
      const msg = err instanceof Error ? err.message : 'Gagal menambahkan bidang.';
      setDeptFieldError(msg);
      setError(msg);
    } finally {
      setSavingDept(false);
    }
  };

  const handleSaveDepartmentName = async (dept: DepartmentRecord) => {
    const trimmed = editingDeptName.trim();
    setError('');
    setNotice('');
    if (trimmed.length < 3) {
      setError('Nama bidang minimal 3 karakter.');
      return;
    }
    setSavingDept(true);
    try {
      const updated = await updateAdminDepartment(token, dept.id, { name: trimmed });
      setEditingDeptId(null);
      setEditingDeptName('');
      setNotice(`Nama bidang diperbarui menjadi "${updated.name}".`);
      onDepartmentsUpdated();
      await loadData();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired();
        return;
      }
      setError(err instanceof Error ? err.message : 'Gagal mengubah nama bidang.');
    } finally {
      setSavingDept(false);
    }
  };

  const handleToggleDepartment = async (dept: DepartmentRecord) => {
    setError('');
    setNotice('');
    try {
      await updateAdminDepartment(token, dept.id, { isActive: !dept.isActive });
      onDepartmentsUpdated();
      await loadData();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired();
        return;
      }
      setError(err instanceof Error ? err.message : 'Gagal memperbarui status bidang.');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');

    if (!/^[a-zA-Z0-9._-]{3,60}$/.test(newUsername.trim())) {
      setError('NIP / Username harus 3-60 karakter (huruf, angka, titik, atau garis bawah).');
      return;
    }
    if (newFullName.trim().length < 2) {
      setError('Nama lengkap wajib diisi.');
      return;
    }
    if (newUserPassword.length < 8) {
      setError('Kata sandi akun baru minimal 8 karakter.');
      return;
    }

    setSavingUser(true);
    try {
      const created = await createAdminUser(token, {
        username: newUsername.trim(),
        fullName: newFullName.trim(),
        role: newRole,
        department: newRole === 'pimpinan' ? newUserDept : 'Semua Bidang',
        password: newUserPassword,
      });
      setNewUsername('');
      setNewFullName('');
      setNewRole('resepsionis');
      setNewUserDept('Semua Bidang');
      setNewUserPassword('');
      setNotice(`Akun "${created.username}" (${ROLE_LABELS[created.role]}) berhasil dibuat.`);
      await loadData();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired();
        return;
      }
      setError(err instanceof Error ? err.message : 'Gagal membuat akun pengguna.');
    } finally {
      setSavingUser(false);
    }
  };

  const handleToggleUserActive = async (u: ManagedUser) => {
    setError('');
    setNotice('');
    try {
      await updateAdminUser(token, u.id, { isActive: !u.isActive });
      await loadData();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired();
        return;
      }
      setError(err instanceof Error ? err.message : 'Gagal mengubah status akun.');
    }
  };

  const handleResetUserPassword = async (userId: string) => {
    setError('');
    setNotice('');
    if (resetPasswordValue.length < 8) {
      setError('Kata sandi baru minimal 8 karakter.');
      return;
    }
    try {
      const updated = await updateAdminUser(token, userId, { newPassword: resetPasswordValue });
      setResetTargetId(null);
      setResetPasswordValue('');
      setNotice(`Kata sandi akun "${updated.username}" berhasil diperbarui.`);
      await loadData();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired();
        return;
      }
      setError(err instanceof Error ? err.message : 'Gagal mereset kata sandi.');
    }
  };

  const handleIssueRecoveryCode = async (reqItem: PasswordResetRequestRecord) => {
    setError('');
    setNotice('');
    try {
      const data = await issuePasswordResetToken(token, reqItem.id);
      setIssuedCodeInfo({
        requestId: reqItem.id,
        username: reqItem.username,
        recoveryCode: data.recoveryCode,
      });
      setNotice(
        `Kode pemulihan 1x pakai untuk "${reqItem.username}" berhasil dibuat (berlaku 15 menit).`,
      );
      await loadData();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired();
        return;
      }
      setError(err instanceof Error ? err.message : 'Gagal membuat kode pemulihan.');
    }
  };

  const handleDismissResetRequest = async (reqItem: PasswordResetRequestRecord) => {
    setError('');
    try {
      await dismissPasswordResetRequest(token, reqItem.id);
      if (issuedCodeInfo?.requestId === reqItem.id) {
        setIssuedCodeInfo(null);
      }
      await loadData();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired();
        return;
      }
      setError(err instanceof Error ? err.message : 'Gagal menutup permintaan reset.');
    }
  };

  if (loading) {
    return (
      <div className="bg-[#F8FAFC] border border-white/25 rounded-2xl p-6 space-y-3 shadow-xl">
        <div className="h-6 bg-slate-200 rounded w-1/3 animate-pulse" />
        <div className="h-12 bg-slate-200 rounded-xl animate-pulse" />
        <div className="h-12 bg-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      {mode === 'departments' && (
        <div className="bg-[#F8FAFC] border border-white/25 rounded-2xl overflow-hidden shadow-xl">
          <div className="px-5 sm:px-6 py-4 sm:py-5 bg-gradient-to-r from-[#0F294A] to-[#1A4275] text-white flex items-center gap-3">
            <Building2 className="w-5 h-5 text-[#FB923C] shrink-0" aria-hidden="true" />
            <div>
              <h2 className="font-display text-base font-bold">Master Data Bidang Tujuan</h2>
              <p className="text-xs text-slate-200">
                Bidang yang aktif otomatis muncul pada dropdown Formulir Buku Tamu Publik
              </p>
            </div>
          </div>

          <div className="p-4 sm:p-6 space-y-5">
            <form
              onSubmit={handleAddDepartment}
              noValidate
              className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
            >
              <div>
                <label
                  htmlFor="new-dept-name"
                  className="block text-xs sm:text-sm font-bold text-[#0F294A] mb-1.5"
                >
                  Nama Bidang / Unit Layanan Baru *
                </label>
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    ref={deptInputRef}
                    id="new-dept-name"
                    type="text"
                    maxLength={100}
                    value={newDeptName}
                    onChange={(e) => {
                      setNewDeptName(e.target.value);
                      if (deptFieldError) setDeptFieldError('');
                    }}
                    placeholder="Ketik nama bidang baru, misal: Bidang Logistik..."
                    className={`flex-1 min-h-[44px] px-3.5 py-2 text-sm rounded-xl border bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 ${
                      deptFieldError
                        ? 'border-red-500 focus:border-red-600 focus:ring-red-200'
                        : 'border-slate-300 focus:border-[#0F294A] focus:ring-[#EA580C]/25'
                    }`}
                  />
                  <button
                    type="submit"
                    disabled={savingDept}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] text-sm font-semibold text-white bg-[#EA580C] hover:bg-[#C2410C] disabled:opacity-60 rounded-xl whitespace-nowrap transition-colors"
                  >
                    <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{savingDept ? 'Menyimpan...' : 'Simpan Bidang'}</span>
                  </button>
                </div>
                {deptFieldError ? (
                  <p className="mt-1.5 text-xs font-medium text-red-600">{deptFieldError}</p>
                ) : (
                  <p className="mt-1.5 text-xs text-slate-500">
                    Ketik nama bidang pada kolom di atas lalu tekan <strong>Simpan Bidang</strong>.
                  </p>
                )}
              </div>
            </form>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
              <div className="hidden sm:grid sm:grid-cols-12 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 py-3 px-4">
                <div className="col-span-6">Nama Bidang / Unit Kerja</div>
                <div className="col-span-3">Status Form Publik</div>
                <div className="col-span-3 text-right">Aksi</div>
              </div>

              {departments.map((dept) => {
                const isEditing = editingDeptId === dept.id;
                return (
                  <div
                    key={dept.id}
                    className="p-4 hover:bg-slate-50/70 flex flex-col sm:grid sm:grid-cols-12 sm:items-center gap-3"
                  >
                    <div className="sm:col-span-6 min-w-0">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            maxLength={100}
                            value={editingDeptName}
                            onChange={(e) => setEditingDeptName(e.target.value)}
                            aria-label="Ubah nama bidang"
                            className="flex-1 min-h-[38px] px-3 py-1.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-900"
                          />
                          <button
                            type="button"
                            disabled={savingDept}
                            onClick={() => handleSaveDepartmentName(dept)}
                            aria-label="Simpan perubahan nama bidang"
                            className="p-2 min-h-[36px] min-w-[36px] rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                          >
                            <Check className="w-4 h-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingDeptId(null);
                              setEditingDeptName('');
                            }}
                            aria-label="Batal ubah nama bidang"
                            className="p-2 min-h-[36px] min-w-[36px] rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"
                          >
                            <X className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>
                      ) : (
                        <p className="font-semibold text-sm text-[#0F294A] break-words">
                          {dept.name}
                        </p>
                      )}
                    </div>

                    <div className="sm:col-span-3 flex items-center justify-between sm:justify-start">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold ${
                          dept.isActive
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {dept.isActive ? 'Aktif Ditampilkan' : 'Nonaktif'}
                      </span>

                      <div className="flex sm:hidden items-center gap-1.5">
                        {!isEditing && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingDeptId(dept.id);
                              setEditingDeptName(dept.name);
                            }}
                            className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                          >
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleToggleDepartment(dept)}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${
                            dept.isActive
                              ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                              : 'bg-[#0F294A] text-white hover:bg-[#091B33]'
                          }`}
                        >
                          {dept.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                      </div>
                    </div>

                    <div className="hidden sm:flex sm:col-span-3 items-center justify-end gap-2">
                      {!isEditing && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingDeptId(dept.id);
                            setEditingDeptName(dept.name);
                          }}
                          title="Ubah Nama Bidang"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
                        >
                          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Edit</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleToggleDepartment(dept)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${
                          dept.isActive
                            ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            : 'bg-[#0F294A] text-white hover:bg-[#091B33]'
                        }`}
                      >
                        {dept.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {mode === 'users' && (
        <div className="space-y-6">
          {/* Permintaan Lupa Kata Sandi Pegawai */}
          {resetRequests.some((r) => r.status === 'pending' || r.status === 'token_issued') && (
            <div className="bg-[#FFF7ED] border border-orange-200 rounded-2xl overflow-hidden shadow-lg">
              <div className="px-6 py-4 bg-gradient-to-r from-[#EA580C] to-[#C2410C] text-white flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <LifeBuoy className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <div>
                    <h2 className="text-base font-bold">Permintaan Lupa Kata Sandi</h2>
                    <p className="text-xs text-orange-50">
                      Terbitkan kode pemulihan 1x pakai atau reset sandi langsung untuk pegawai
                    </p>
                  </div>
                </div>
              </div>

              {issuedCodeInfo && (
                <div className="mx-6 mt-4 p-4 rounded-xl bg-white border-2 border-[#0F294A] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-600">
                      Kode Pemulihan 1x Pakai untuk{' '}
                      <span className="font-bold text-[#0F294A]">{issuedCodeInfo.username}</span>{' '}
                      (berlaku 15 menit):
                    </p>
                    <p className="mt-1 text-xl font-bold tracking-wider text-[#EA580C]">
                      {issuedCodeInfo.recoveryCode}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(issuedCodeInfo.recoveryCode);
                      setNotice(`Kode ${issuedCodeInfo.recoveryCode} disalin ke clipboard.`);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-[#0F294A] hover:bg-[#091B33] rounded-lg"
                  >
                    <Copy className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Salin Kode</span>
                  </button>
                </div>
              )}

              <div className="p-5 space-y-3">
                {resetRequests
                  .filter((r) => r.status === 'pending' || r.status === 'token_issued')
                  .map((reqItem) => {
                    const iso = new Date(reqItem.createdAt).toISOString();
                    return (
                      <div
                        key={reqItem.id}
                        className="bg-white border border-orange-200/80 rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                      >
                        <div className="space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-[#0F294A]">{reqItem.fullName}</span>
                            <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">
                              {reqItem.username}
                            </span>
                            <span className="text-xs font-semibold text-[#EA580C]">
                              {ROLE_LABELS[reqItem.role as UserRole] || reqItem.role}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600">
                            Diajukan {formatShortDate(iso)} · {formatWibTime(iso)}
                            {reqItem.note ? ` · Keterangan: "${reqItem.note}"` : ''}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleIssueRecoveryCode(reqItem)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-[#0F294A] hover:bg-[#091B33] rounded-lg"
                          >
                            <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>
                              {reqItem.status === 'token_issued'
                                ? 'Buat Kode Baru'
                                : 'Terbitkan Kode Pemulihan'}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDismissResetRequest(reqItem)}
                            className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
                          >
                            Tutup
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Create User Form */}
          <form
            onSubmit={handleCreateUser}
            className="lg:col-span-5 bg-[#F8FAFC] border border-white/25 rounded-2xl overflow-hidden shadow-xl"
          >
            <div className="px-6 py-4 bg-gradient-to-r from-[#0F294A] to-[#1A4275] text-white flex items-center gap-2.5">
              <UserPlus className="w-5 h-5 text-[#FB923C]" aria-hidden="true" />
              <h2 className="font-display text-base font-bold">Tambah Akun Internal RBAC</h2>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label htmlFor="u-username" className="block text-xs font-semibold text-slate-800 mb-1">
                  NIP / Username *
                </label>
                <input
                  id="u-username"
                  type="text"
                  required
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="Contoh: 198901012015031001 atau piket.lobi"
                  className="w-full min-h-[42px] px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white"
                />
              </div>

              <div>
                <label htmlFor="u-fullname" className="block text-xs font-semibold text-slate-800 mb-1">
                  Nama Lengkap Pegawai *
                </label>
                <input
                  id="u-fullname"
                  type="text"
                  required
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  placeholder="Contoh: Siti Aminah, S.Sos"
                  className="w-full min-h-[42px] px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white"
                />
              </div>

              <div>
                <label htmlFor="u-role" className="block text-xs font-semibold text-slate-800 mb-1">
                  Peran Hak Akses (Role RBAC) *
                </label>
                <select
                  id="u-role"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="w-full min-h-[42px] px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white"
                >
                  {USER_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>

              {newRole === 'pimpinan' && (
                <div>
                  <label htmlFor="u-dept" className="block text-xs font-semibold text-slate-800 mb-1">
                    Cakupan Bidang Pimpinan / Kabid *
                  </label>
                  <select
                    id="u-dept"
                    value={newUserDept}
                    onChange={(e) => setNewUserDept(e.target.value)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white"
                  >
                    <option value="Semua Bidang">Semua Bidang (Kalaksa / Sekretaris)</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="u-password" className="block text-xs font-semibold text-slate-800 mb-1">
                  Kata Sandi Awal (min. 8 karakter) *
                </label>
                <div className="relative">
                  <input
                    id="u-password"
                    type={showNewUserPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                    placeholder="Masukkan kata sandi"
                    className="w-full min-h-[42px] pl-3 pr-10 py-2 text-sm rounded-xl border border-slate-300 bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewUserPassword((v) => !v)}
                    aria-label={showNewUserPassword ? 'Sembunyikan sandi' : 'Lihat sandi'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-[#0F294A]"
                  >
                    {showNewUserPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={savingUser}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[44px] text-sm font-semibold text-white bg-[#EA580C] hover:bg-[#C2410C] rounded-xl"
              >
                <UserPlus className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{savingUser ? 'Menyimpan...' : 'Buat Akun Pegawai'}</span>
              </button>
            </div>
          </form>

          {/* Users Table */}
          <div className="lg:col-span-7 bg-[#F8FAFC] border border-white/25 rounded-2xl overflow-hidden shadow-xl">
            <div className="px-6 py-4 bg-gradient-to-r from-[#0F294A] to-[#1A4275] text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Shield className="w-5 h-5 text-[#FB923C]" aria-hidden="true" />
                <h2 className="font-display text-base font-bold">Daftar Akun Internal</h2>
              </div>
              <span className="text-xs font-mono tabular-nums text-slate-200">
                {users.length} akun
              </span>
            </div>

            <div className="overflow-x-auto bg-white">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">NIP / Nama</th>
                    <th className="py-3 px-4">Peran & Bidang</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => {
                    const isSelf = u.id === currentUser.id;
                    return (
                      <tr key={u.id} className="hover:bg-slate-50/70 align-top">
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-[#0F294A]">{u.fullName}</div>
                          <div className="text-xs font-mono text-slate-500">{u.username}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-medium text-slate-800">{ROLE_LABELS[u.role]}</div>
                          {u.role === 'pimpinan' && (
                            <div className="text-xs text-[#EA580C]">{u.department}</div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-xs font-semibold whitespace-nowrap">
                          <span className={u.isActive ? 'text-emerald-700' : 'text-red-600'}>
                            {u.isActive ? 'Aktif' : 'Nonaktif'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap space-y-2">
                          <div className="inline-flex items-center gap-1.5">
                            {!isSelf && (
                              <button
                                type="button"
                                onClick={() => handleToggleUserActive(u)}
                                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"
                              >
                                {u.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setResetTargetId(resetTargetId === u.id ? null : u.id);
                                setResetPasswordValue('');
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-[#0F294A] text-white hover:bg-[#091B33]"
                            >
                              <KeyRound className="w-3 h-3" aria-hidden="true" />
                              <span>Reset Sandi</span>
                            </button>
                          </div>

                          {resetTargetId === u.id && (
                            <div className="flex items-center justify-end gap-1.5 mt-1">
                              <input
                                type="password"
                                minLength={8}
                                value={resetPasswordValue}
                                onChange={(e) => setResetPasswordValue(e.target.value)}
                                placeholder="Sandi baru (min 8)"
                                className="w-36 px-2.5 py-1 text-xs rounded-lg border border-slate-300"
                              />
                              <button
                                type="button"
                                onClick={() => handleResetUserPassword(u.id)}
                                className="px-2.5 py-1 text-xs font-semibold bg-[#EA580C] text-white rounded-lg"
                              >
                                Simpan
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          </div>
        </div>
      )}

      {mode === 'audit' && (
        <div className="bg-[#F8FAFC] border border-white/25 rounded-2xl overflow-hidden shadow-xl">
          <div className="px-6 py-5 bg-gradient-to-r from-[#0F294A] to-[#1A4275] text-white flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-bold">Log Audit Aktivitas Sistem</h2>
              <p className="text-xs text-slate-200">
                Rekaman aktivitas autentikasi, pengelolaan data tamu, dan perubahan RBAC
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-200">
              {auditLogs.length} aktivitas terakhir
            </span>
          </div>

          <div className="overflow-x-auto bg-white">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4 whitespace-nowrap">Waktu (WIB)</th>
                  <th className="py-3 px-4">Pelaku & Peran</th>
                  <th className="py-3 px-4">Aksi</th>
                  <th className="py-3 px-4">Target & Keterangan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-500">
                      Belum ada catatan aktivitas.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => {
                    const iso = new Date(log.createdAt).toISOString();
                    return (
                      <tr key={log.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                          {formatShortDate(iso)} · {formatWibTime(iso)}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-[#0F294A]">{log.actorUsername}</div>
                          <div className="text-xs text-slate-500">{log.actorRole}</div>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs font-semibold text-[#EA580C]">
                          {log.action}
                        </td>
                        <td className="py-3 px-4 text-slate-700">
                          <span className="font-medium text-slate-900">{log.target}</span>
                          <span className="mx-1.5 text-slate-300">·</span>
                          <span>{log.details}</span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
