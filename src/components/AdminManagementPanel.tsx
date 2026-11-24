import { useCallback, useEffect, useState } from 'react';
import { Building2, Eye, EyeOff, KeyRound, Plus, Shield, UserPlus } from 'lucide-react';
import {
  ROLE_LABELS,
  USER_ROLES,
  type AuditLogRecord,
  type AuthUser,
  type DepartmentRecord,
  type ManagedUser,
  type UserRole,
} from '../types';
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
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // New department form
  const [newDeptName, setNewDeptName] = useState('');
  const [savingDept, setSavingDept] = useState(false);

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
      const headers = { Authorization: `Bearer ${token}` };

      if (mode === 'departments' || mode === 'users') {
        const deptRes = await fetch('/api/admin/departments', { headers });
        if (deptRes.status === 401) {
          onSessionExpired();
          return;
        }
        const deptData = await deptRes.json();
        if (!deptRes.ok) {
          setError(deptData.error || 'Gagal memuat master bidang.');
          return;
        }
        setDepartments(deptData.departments || []);
      }

      if (mode === 'users') {
        const userRes = await fetch('/api/admin/users', { headers });
        if (userRes.status === 401) {
          onSessionExpired();
          return;
        }
        const userData = await userRes.json();
        if (!userRes.ok) {
          setError(userData.error || 'Gagal memuat daftar akun pengguna.');
          return;
        }
        setUsers(userData.users || []);
      }

      if (mode === 'audit') {
        const logRes = await fetch('/api/admin/audit-logs', { headers });
        if (logRes.status === 401) {
          onSessionExpired();
          return;
        }
        const logData = await logRes.json();
        if (!logRes.ok) {
          setError(logData.error || 'Gagal memuat log audit.');
          return;
        }
        setAuditLogs(logData.logs || []);
      }
    } catch {
      setError('Gagal terhubung ke server.');
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
    setNotice('');
    if (newDeptName.trim().length < 3) {
      setError('Nama bidang minimal 3 karakter.');
      return;
    }
    setSavingDept(true);
    try {
      const res = await fetch('/api/admin/departments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: newDeptName.trim() }),
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Gagal menambahkan bidang.');
        return;
      }
      setNewDeptName('');
      setNotice(`Bidang "${data.department.name}" berhasil ditambahkan.`);
      onDepartmentsUpdated();
      await loadData();
    } catch {
      setError('Gagal terhubung ke server.');
    } finally {
      setSavingDept(false);
    }
  };

  const handleToggleDepartment = async (dept: DepartmentRecord) => {
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/admin/departments/${encodeURIComponent(dept.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isActive: !dept.isActive }),
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Gagal memperbarui status bidang.');
        return;
      }
      onDepartmentsUpdated();
      await loadData();
    } catch {
      setError('Gagal terhubung ke server.');
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
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          username: newUsername.trim(),
          fullName: newFullName.trim(),
          role: newRole,
          department: newRole === 'pimpinan' ? newUserDept : 'Semua Bidang',
          password: newUserPassword,
        }),
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Gagal membuat akun pengguna.');
        return;
      }
      setNewUsername('');
      setNewFullName('');
      setNewRole('resepsionis');
      setNewUserDept('Semua Bidang');
      setNewUserPassword('');
      setNotice(`Akun "${data.user.username}" (${ROLE_LABELS[data.user.role as UserRole]}) berhasil dibuat.`);
      await loadData();
    } catch {
      setError('Gagal terhubung ke server.');
    } finally {
      setSavingUser(false);
    }
  };

  const handleToggleUserActive = async (u: ManagedUser) => {
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(u.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isActive: !u.isActive }),
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Gagal mengubah status akun.');
        return;
      }
      await loadData();
    } catch {
      setError('Gagal terhubung ke server.');
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
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ newPassword: resetPasswordValue }),
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Gagal mereset kata sandi.');
        return;
      }
      setResetTargetId(null);
      setResetPasswordValue('');
      setNotice(`Kata sandi akun "${data.user.username}" berhasil diperbarui.`);
    } catch {
      setError('Gagal terhubung ke server.');
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
          <div className="px-6 py-5 bg-gradient-to-r from-[#0F294A] to-[#1A4275] text-white flex items-center gap-3">
            <Building2 className="w-5 h-5 text-[#FB923C]" aria-hidden="true" />
            <div>
              <h2 className="font-display text-base font-bold">Master Data Bidang Tujuan</h2>
              <p className="text-xs text-slate-200">
                Bidang yang aktif otomatis muncul pada dropdown Formulir Buku Tamu Publik
              </p>
            </div>
          </div>

          <div className="p-6 space-y-6">
            <form onSubmit={handleAddDepartment} className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={newDeptName}
                onChange={(e) => setNewDeptName(e.target.value)}
                placeholder="Tambah nama bidang / unit layanan baru..."
                className="flex-1 min-h-[44px] px-3.5 py-2 text-sm rounded-xl border border-slate-300 bg-white"
              />
              <button
                type="submit"
                disabled={savingDept}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] text-sm font-semibold text-white bg-[#EA580C] hover:bg-[#C2410C] rounded-xl whitespace-nowrap"
              >
                <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{savingDept ? 'Menyimpan...' : 'Tambah Bidang'}</span>
              </button>
            </form>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Nama Bidang / Unit Kerja</th>
                    <th className="py-3 px-4">Status Form Publik</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {departments.map((dept) => (
                    <tr key={dept.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-semibold text-[#0F294A]">{dept.name}</td>
                      <td className="py-3 px-4 text-xs font-semibold">
                        <span className={dept.isActive ? 'text-emerald-700' : 'text-slate-500'}>
                          {dept.isActive ? 'Aktif Ditampilkan' : 'Nonaktif'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {mode === 'users' && (
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
