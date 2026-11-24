import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  KeyRound,
  LifeBuoy,
  Lock,
  Mail,
  Send,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import type { AdminAuthStatus, AuthUser } from '../types';
import {
  bootstrapSuperAdminAccount,
  completePasswordReset,
  fetchAuthStatus,
  loginInternalUser,
  requestPasswordReset,
} from '../lib/api';
import { BpbdEmblem, SidoarjoLogo } from './BpbdEmblem';

interface AdminLoginViewProps {
  onAuthenticated: (token: string, user: AuthUser) => void;
  onBackToPublic: () => void;
}

export function AdminLoginView({ onAuthenticated, onBackToPublic }: AdminLoginViewProps) {
  const [authStatus, setAuthStatus] = useState<AdminAuthStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [viewMode, setViewMode] = useState<'login' | 'forgot'>('login');
  const [forgotTab, setForgotTab] = useState<'request' | 'reset'>('request');

  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Forgot / Reset Password States
  const [resetNote, setResetNote] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newResetPassword, setNewResetPassword] = useState('');
  const [confirmResetPassword, setConfirmResetPassword] = useState('');
  const [showNewResetPassword, setShowNewResetPassword] = useState(false);
  const [submittedResetInfo, setSubmittedResetInfo] = useState<{
    username: string;
    note: string;
    emailSent: boolean;
  } | null>(null);

  const [error, setError] = useState('');
  const [successNotice, setSuccessNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const supportEmail = authStatus?.supportEmail || 'aplikasiserver89@gmail.com';

  const buildMailtoHref = (targetUsername: string, targetNote: string) => {
    const cleanUser = targetUsername.trim();
    const cleanNote = targetNote.trim();
    const waktuWib = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date());
    const subject = encodeURIComponent(
      `[SI-TAMU BPBD] Permintaan Reset Kata Sandi - ${cleanUser || 'Akun Internal'}`,
    );
    const body = encodeURIComponent(
      [
        'Yth. Pengelola / Super Admin SI-TAMU BPBD Kabupaten Sidoarjo,',
        '',
        'Mohon bantuan reset kata sandi untuk akun internal berikut:',
        `- NIP / Username : ${cleanUser || '(isi NIP/Username Anda)'}`,
        `- Keterangan / Unit Kerja : ${cleanNote || '-'}`,
        `- Waktu Pengajuan : ${waktuWib} WIB`,
        '',
        'Terima kasih.',
      ].join('\n'),
    );
    return `mailto:${supportEmail}?subject=${subject}&body=${body}`;
  };

  useEffect(() => {
    let active = true;
    const loadStatus = async () => {
      try {
        const data = await fetchAuthStatus();
        if (active) {
          setAuthStatus(data);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : 'Gagal memeriksa status autentikasi server.',
          );
        }
      } finally {
        if (active) {
          setLoadingStatus(false);
        }
      }
    };
    loadStatus();
    return () => {
      active = false;
    };
  }, []);

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!/^[a-zA-Z0-9._-]{3,60}$/.test(username.trim())) {
      setError('NIP / Username harus 3–60 karakter (huruf, angka, titik, atau garis bawah).');
      return;
    }
    if (fullName.trim().length < 2) {
      setError('Nama lengkap Super Admin wajib diisi.');
      return;
    }
    if (password.length < 8) {
      setError('Kata sandi minimal 8 karakter.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Konfirmasi kata sandi tidak cocok.');
      return;
    }

    setSubmitting(true);
    try {
      const data = await bootstrapSuperAdminAccount({
        username: username.trim(),
        fullName: fullName.trim(),
        password,
      });
      onAuthenticated(data.token, data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengaktivasi akun Super Admin.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessNotice('');
    if (!username.trim() || !password) {
      setError('NIP / Username dan kata sandi wajib diisi.');
      return;
    }

    setSubmitting(true);
    try {
      const data = await loginInternalUser({
        username: username.trim(),
        password,
      });
      onAuthenticated(data.token, data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'NIP / Username atau kata sandi salah.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessNotice('');
    setSubmittedResetInfo(null);
    const trimmedUsername = username.trim();
    const trimmedNote = resetNote.trim();
    if (!/^[a-zA-Z0-9._-]{3,60}$/.test(trimmedUsername)) {
      setError('NIP / Username wajib diisi (minimal 3 karakter).');
      return;
    }

    setSubmitting(true);
    try {
      const data = await requestPasswordReset({
        username: trimmedUsername,
        note: trimmedNote,
      });
      setSubmittedResetInfo({
        username: trimmedUsername,
        note: trimmedNote,
        emailSent: Boolean(data.emailSent),
      });
      setResetNote('');
      setSuccessNotice(data.message);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Gagal mengirim permintaan reset kata sandi.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompletePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessNotice('');

    if (!username.trim()) {
      setError('NIP / Username wajib diisi.');
      return;
    }
    if (!recoveryCode.trim()) {
      setError('Kode pemulihan wajib diisi.');
      return;
    }
    if (newResetPassword.length < 8) {
      setError('Kata sandi baru minimal 8 karakter.');
      return;
    }
    if (newResetPassword !== confirmResetPassword) {
      setError('Konfirmasi kata sandi baru tidak cocok.');
      return;
    }

    setSubmitting(true);
    try {
      const data = await completePasswordReset({
        username: username.trim(),
        recoveryCode: recoveryCode.trim(),
        newPassword: newResetPassword,
      });
      setRecoveryCode('');
      setNewResetPassword('');
      setConfirmResetPassword('');
      setPassword('');
      setViewMode('login');
      setSuccessNotice(
        data.message || 'Kata sandi berhasil diperbarui. Silakan masuk dengan sandi baru.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memperbarui kata sandi.');
    } finally {
      setSubmitting(false);
    }
  };

  const isBootstrapMode = authStatus && !authStatus.configured;

  return (
    <main className="max-w-xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
      <div className="bg-[#F4F7FC] border border-white/25 rounded-2xl overflow-hidden shadow-2xl">
        {/* Institutional Dual-Logo Header */}
        <div className="bg-gradient-to-r from-[#091D38] via-[#133663] to-[#091D38] px-6 py-6 text-white border-b-4 border-[#EA580C] flex items-center justify-between gap-4">
          <SidoarjoLogo className="w-12 h-12 sm:w-14 sm:h-14" />
          <div className="text-center flex-1">
            <p className="text-[11px] font-semibold text-[#FDBA74] tracking-wide">
              BPBD KABUPATEN SIDOARJO
            </p>
            <h1 className="font-display text-base sm:text-lg font-extrabold text-white">
              {isBootstrapMode
                ? 'Aktivasi Super Admin Pertama Kali'
                : viewMode === 'forgot'
                  ? 'Pemulihan Kata Sandi Internal'
                  : 'Portal Masuk Internal (RBAC)'}
            </h1>
            <p className="text-xs text-slate-300 mt-0.5">SI-TAMU BPBD · Autentikasi Pegawai</p>
          </div>
          <BpbdEmblem className="w-12 h-12 sm:w-14 sm:h-14" />
        </div>

        <div className="p-6 sm:p-8 space-y-6">
          {loadingStatus ? (
            <div className="space-y-3 py-4">
              <div className="h-4 bg-slate-200 rounded w-3/4 animate-pulse" />
              <div className="h-11 bg-slate-200 rounded-xl w-full animate-pulse" />
              <div className="h-11 bg-slate-200 rounded-xl w-full animate-pulse" />
            </div>
          ) : isBootstrapMode ? (
            <form onSubmit={handleBootstrap} className="space-y-5">
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs sm:text-sm text-amber-950 space-y-1">
                <p className="font-semibold flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#EA580C] shrink-0" aria-hidden="true" />
                  <span>Pengaturan Awal Akun Super Admin</span>
                </p>
                <p className="text-amber-900 leading-relaxed">
                  Belum ada akun internal yang terdaftar. Daftarkan akun Super Admin
                  (Pengadministrasi Umum) terlebih dahulu untuk mengelola hak akses RBAC.
                </p>
              </div>

              {error && (
                <div
                  role="alert"
                  className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700"
                >
                  {error}
                </div>
              )}

              <div>
                <label
                  htmlFor="bootstrap-username"
                  className="block text-sm font-semibold text-slate-800 mb-1.5"
                >
                  NIP / Username Super Admin
                </label>
                <input
                  id="bootstrap-username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Contoh: admin.umum atau NIP"
                  className="w-full min-h-[44px] px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:border-[#0F294A] focus:ring-2 focus:ring-[#EA580C]/25"
                />
              </div>

              <div>
                <label
                  htmlFor="bootstrap-fullname"
                  className="block text-sm font-semibold text-slate-800 mb-1.5"
                >
                  Nama Lengkap
                </label>
                <input
                  id="bootstrap-fullname"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Contoh: Pengadministrasi Umum Sekretariat"
                  className="w-full min-h-[44px] px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:border-[#0F294A] focus:ring-2 focus:ring-[#EA580C]/25"
                />
              </div>

              <div>
                <label
                  htmlFor="bootstrap-password"
                  className="block text-sm font-semibold text-slate-800 mb-1.5"
                >
                  Kata Sandi Baru (minimal 8 karakter)
                </label>
                <div className="relative">
                  <input
                    id="bootstrap-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Masukkan kata sandi baru"
                    className="w-full min-h-[44px] pl-3.5 pr-11 py-2.5 text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:border-[#0F294A] focus:ring-2 focus:ring-[#EA580C]/25"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Lihat kata sandi'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-500 hover:text-[#0F294A] rounded-lg"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="bootstrap-confirm"
                  className="block text-sm font-semibold text-slate-800 mb-1.5"
                >
                  Konfirmasi Kata Sandi
                </label>
                <div className="relative">
                  <input
                    id="bootstrap-confirm"
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Ulangi kata sandi baru"
                    className="w-full min-h-[44px] pl-3.5 pr-11 py-2.5 text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:border-[#0F294A] focus:ring-2 focus:ring-[#EA580C]/25"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    aria-label={showConfirmPassword ? 'Sembunyikan sandi' : 'Lihat sandi'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-500 hover:text-[#0F294A] rounded-lg"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-1">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[46px] text-sm font-semibold text-white bg-[#EA580C] hover:bg-[#C2410C] disabled:opacity-60 rounded-xl transition-colors"
                >
                  <KeyRound className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{submitting ? 'Mengaktifkan...' : 'Aktifkan Super Admin'}</span>
                </button>
                <button
                  type="button"
                  onClick={onBackToPublic}
                  className="px-4 py-3 min-h-[46px] text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Kembali
                </button>
              </div>
            </form>
          ) : viewMode === 'forgot' ? (
            <div className="space-y-5">
              {/* Sub-Tab Selector */}
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-200/80 rounded-xl">
                <button
                  type="button"
                  onClick={() => {
                    setForgotTab('request');
                    setError('');
                    setSuccessNotice('');
                  }}
                  className={`py-2 px-3 text-xs font-bold rounded-lg transition-colors ${
                    forgotTab === 'request'
                      ? 'bg-[#0F294A] text-white shadow-sm'
                      : 'text-slate-700 hover:text-slate-900'
                  }`}
                >
                  1. Ajukan ke Super Admin
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setForgotTab('reset');
                    setError('');
                    setSuccessNotice('');
                  }}
                  className={`py-2 px-3 text-xs font-bold rounded-lg transition-colors ${
                    forgotTab === 'reset'
                      ? 'bg-[#0F294A] text-white shadow-sm'
                      : 'text-slate-700 hover:text-slate-900'
                  }`}
                >
                  2. Pakai Kode Pemulihan
                </button>
              </div>

              {error && (
                <div
                  role="alert"
                  className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700"
                >
                  {error}
                </div>
              )}

              {successNotice && (
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-900 space-y-2.5">
                  <p className="leading-relaxed">{successNotice}</p>
                  {forgotTab === 'request' && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 pt-1">
                      <a
                        href={buildMailtoHref(
                          submittedResetInfo?.username || username,
                          submittedResetInfo?.note || resetNote,
                        )}
                        className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-[#0F294A] hover:bg-[#091B33] rounded-lg transition-colors"
                      >
                        <Mail className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>Kirim via Email ({supportEmail})</span>
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          setForgotTab('reset');
                          setSuccessNotice('');
                        }}
                        className="text-xs font-bold text-[#0F294A] underline hover:text-[#EA580C] text-left sm:text-center"
                      >
                        Sudah punya kode pemulihan? Masukkan di sini
                      </button>
                    </div>
                  )}
                </div>
              )}

              {forgotTab === 'request' ? (
                <form onSubmit={handleRequestPasswordReset} className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-xs text-[#0F294A] leading-relaxed flex items-start gap-2.5">
                    <LifeBuoy className="w-4 h-4 text-[#EA580C] shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="space-y-1">
                      <p>
                        Kirim permintaan reset kata sandi ke <strong>Super Admin</strong> atau melalui
                        email bantuan{' '}
                        <a
                          href={`mailto:${supportEmail}`}
                          className="font-bold text-[#EA580C] underline break-all"
                        >
                          {supportEmail}
                        </a>
                        .
                      </p>
                      <p className="text-slate-600">
                        Kode pemulihan 1x pakai berlaku selama 15 menit untuk mengatur sandi baru
                        akun Anda.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="forgot-username"
                      className="block text-sm font-semibold text-slate-800 mb-1.5"
                    >
                      NIP / Username Akun *
                    </label>
                    <input
                      id="forgot-username"
                      type="text"
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Masukkan NIP atau Username Anda"
                      className="w-full min-h-[44px] px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:border-[#0F294A] focus:ring-2 focus:ring-[#EA580C]/25"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="forgot-note"
                      className="block text-sm font-semibold text-slate-800 mb-1.5"
                    >
                      Keterangan / Unit Kerja (Opsional)
                    </label>
                    <input
                      id="forgot-note"
                      type="text"
                      maxLength={200}
                      value={resetNote}
                      onChange={(e) => setResetNote(e.target.value)}
                      placeholder="Contoh: Petugas Piket Loket / Lupa sandi"
                      className="w-full min-h-[44px] px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:border-[#0F294A] focus:ring-2 focus:ring-[#EA580C]/25"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 pt-1">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[46px] text-sm font-semibold text-white bg-[#EA580C] hover:bg-[#C2410C] disabled:opacity-60 rounded-xl transition-colors"
                    >
                      <Send className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>{submitting ? 'Mengirim...' : 'Kirim Permintaan Reset'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setViewMode('login');
                        setError('');
                        setSuccessNotice('');
                        setSubmittedResetInfo(null);
                      }}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-3 min-h-[46px] text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl transition-colors"
                    >
                      <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>Kembali Login</span>
                    </button>
                  </div>

                  <a
                    href={buildMailtoHref(username, resetNote)}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[42px] text-xs font-semibold text-[#0F294A] bg-white border border-slate-300 hover:bg-slate-100 rounded-xl transition-colors"
                  >
                    <Mail className="w-4 h-4 text-[#EA580C] shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      Kirim Langsung via Email ({supportEmail})
                    </span>
                  </a>
                </form>
              ) : (
                <form onSubmit={handleCompletePasswordReset} className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 leading-relaxed">
                    Masukkan <strong>Kode Pemulihan 1x Pakai</strong> dari Super Admin, atau{' '}
                    <strong>ADMIN_RECOVERY_KEY</strong> server untuk pemulihan darurat Super Admin.
                  </div>

                  <div>
                    <label
                      htmlFor="reset-username"
                      className="block text-sm font-semibold text-slate-800 mb-1.5"
                    >
                      NIP / Username *
                    </label>
                    <input
                      id="reset-username"
                      type="text"
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Masukkan NIP atau Username"
                      className="w-full min-h-[44px] px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:border-[#0F294A] focus:ring-2 focus:ring-[#EA580C]/25"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="reset-code"
                      className="block text-sm font-semibold text-slate-800 mb-1.5"
                    >
                      Kode Pemulihan / Recovery Key *
                    </label>
                    <input
                      id="reset-code"
                      type="text"
                      required
                      value={recoveryCode}
                      onChange={(e) => setRecoveryCode(e.target.value)}
                      placeholder="Contoh: A1B2C-3D4E5"
                      className="w-full min-h-[44px] px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:border-[#0F294A] focus:ring-2 focus:ring-[#EA580C]/25"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="reset-new-password"
                      className="block text-sm font-semibold text-slate-800 mb-1.5"
                    >
                      Kata Sandi Baru (min. 8 karakter) *
                    </label>
                    <div className="relative">
                      <input
                        id="reset-new-password"
                        type={showNewResetPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        value={newResetPassword}
                        onChange={(e) => setNewResetPassword(e.target.value)}
                        placeholder="Masukkan kata sandi baru"
                        className="w-full min-h-[44px] pl-3.5 pr-11 py-2.5 text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:border-[#0F294A] focus:ring-2 focus:ring-[#EA580C]/25"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewResetPassword((v) => !v)}
                        aria-label={showNewResetPassword ? 'Sembunyikan sandi' : 'Lihat sandi'}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-500 hover:text-[#0F294A] rounded-lg"
                      >
                        {showNewResetPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="reset-confirm-password"
                      className="block text-sm font-semibold text-slate-800 mb-1.5"
                    >
                      Konfirmasi Kata Sandi Baru *
                    </label>
                    <input
                      id="reset-confirm-password"
                      type={showNewResetPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      value={confirmResetPassword}
                      onChange={(e) => setConfirmResetPassword(e.target.value)}
                      placeholder="Ulangi kata sandi baru"
                      className="w-full min-h-[44px] px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:border-[#0F294A] focus:ring-2 focus:ring-[#EA580C]/25"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 pt-1">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[46px] text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#091B33] disabled:opacity-60 rounded-xl transition-colors"
                    >
                      <KeyRound className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>{submitting ? 'Menyimpan...' : 'Simpan Kata Sandi Baru'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setViewMode('login');
                        setError('');
                        setSuccessNotice('');
                      }}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-3 min-h-[46px] text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl transition-colors"
                    >
                      <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>Kembali Login</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : (
            <form onSubmit={handleLogin} className="space-y-5">
              <p className="text-sm text-slate-600">
                Masukkan NIP / Username dan kata sandi akun internal BPBD Kabupaten Sidoarjo untuk
                mengakses dashboard sesuai peran RBAC Anda.
              </p>

              {error && (
                <div
                  role="alert"
                  className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700"
                >
                  {error}
                </div>
              )}

              {successNotice && (
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
                  {successNotice}
                </div>
              )}

              <div>
                <label
                  htmlFor="login-username"
                  className="block text-sm font-semibold text-slate-800 mb-1.5"
                >
                  NIP / Username
                </label>
                <input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Masukkan NIP atau Username"
                  className="w-full min-h-[46px] px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:border-[#0F294A] focus:ring-2 focus:ring-[#EA580C]/25"
                />
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label
                    htmlFor="login-password"
                    className="block text-sm font-semibold text-slate-800"
                  >
                    Kata Sandi
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('forgot');
                      setForgotTab('request');
                      setError('');
                      setSuccessNotice('');
                    }}
                    className="text-xs font-semibold text-[#EA580C] hover:text-[#C2410C] hover:underline"
                  >
                    Lupa Kata Sandi?
                  </button>
                </div>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Masukkan kata sandi"
                    className="w-full min-h-[46px] pl-3.5 pr-11 py-2.5 text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:border-[#0F294A] focus:ring-2 focus:ring-[#EA580C]/25"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Lihat kata sandi'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-500 hover:text-[#0F294A] rounded-lg"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-1">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[46px] text-sm font-semibold text-white bg-gradient-to-r from-[#0F294A] to-[#1A4275] hover:from-[#091B33] hover:to-[#0F294A] disabled:opacity-60 rounded-xl shadow-sm transition-all"
                >
                  <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{submitting ? 'Memverifikasi...' : 'Masuk ke Sistem'}</span>
                </button>
                <button
                  type="button"
                  onClick={onBackToPublic}
                  className="px-4 py-3 min-h-[46px] text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Kembali
                </button>
              </div>
            </form>
          )}

          {/* RBAC Role Overview Footer */}
          <div className="pt-4 border-t border-slate-200">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#0F294A] mb-2">
              <UserCheck className="w-4 h-4 text-[#EA580C] shrink-0" aria-hidden="true" />
              <span>Tingkat Hak Akses Sistem (RBAC)</span>
            </div>
            <ul className="space-y-1 text-xs text-slate-600">
              <li>
                <span className="font-semibold text-slate-800">Super Admin:</span> Akses penuh data
                tamu, export Excel/PDF, QR Code, master bidang, & akun RBAC.
              </li>
              <li>
                <span className="font-semibold text-slate-800">Petugas Resepsionis:</span> Pantau
                tamu hari ini, input bantuan petugas, & proses Check-Out.
              </li>
              <li>
                <span className="font-semibold text-slate-800">Pimpinan / Kabid:</span> Akses
                baca (Read-Only) statistik dan daftar tamu sesuai bidang.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
