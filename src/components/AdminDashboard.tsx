import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Building2,
  Calendar,
  CalendarRange,
  CheckCircle2,
  ClipboardList,
  Clock,
  Download,
  Eye,
  FileSpreadsheet,
  History,
  IdCard,
  Lock,
  Printer,
  QrCode,
  Search,
  Shield,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  DEPARTMENTS,
  ROLE_LABELS,
  VISIT_STATUSES,
  type AuthUser,
  type DashboardStats,
  type DepartmentRecord,
  type VisitRecord,
  type VisitStatus,
} from '../types';
import {
  formatIndonesianDate,
  formatShortDate,
  formatWibTime,
  getLastYearRangeWib,
  getMonthStartWib,
  getTodayWib,
  getWeekStartWib,
  getYearStartWib,
} from '../lib/format';
import { downloadDeskPosterPdf, downloadVisitReportPdf } from '../lib/pdfGenerator';
import { QrPosterStudio } from './QrPosterStudio';
import { PrintPosterView, PrintReportView } from './PrintViews';
import { ManualVisitModal } from './ManualVisitModal';
import { AdminManagementPanel } from './AdminManagementPanel';

type DashboardTab = 'records' | 'recap' | 'qr' | 'departments' | 'users' | 'audit';
type QuickPreset = 'all' | 'today' | 'week' | 'month' | 'year' | 'last_year';

interface AdminDashboardProps {
  token: string;
  authUser: AuthUser;
  initialTab?: 'records' | 'qr';
  onSessionExpired: () => void;
  onOpenGuestForm: () => void;
}

export function AdminDashboard({
  token,
  authUser,
  initialTab = 'records',
  onSessionExpired,
  onOpenGuestForm,
}: AdminDashboardProps) {
  const isSuperAdmin = authUser.role === 'super_admin';
  const isResepsionis = authUser.role === 'resepsionis';
  const isPimpinan = authUser.role === 'pimpinan';
  const canModifyStatus = isSuperAdmin || isResepsionis;
  const canManualInput = isSuperAdmin || isResepsionis;
  const canDelete = isSuperAdmin;
  const canExport = isSuperAdmin;

  const [activeTab, setActiveTab] = useState<DashboardTab>(
    initialTab === 'qr' && isSuperAdmin ? 'qr' : 'records',
  );
  const [availableDepartments, setAvailableDepartments] = useState<string[]>([...DEPARTMENTS]);

  const [stats, setStats] = useState<DashboardStats>({
    totalToday: 0,
    activeNow: 0,
    totalWeek: 0,
    totalMonth: 0,
    totalYear: 0,
    totalLastYear: 0,
    totalAll: 0,
    topDepartment: null,
    periodRecap: [],
    departmentBreakdown: [],
    categoryBreakdown: [],
  });
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState(() => (isResepsionis ? getTodayWib() : ''));
  const [dateTo, setDateTo] = useState(() => (isResepsionis ? getTodayWib() : ''));
  const [quickPreset, setQuickPreset] = useState<QuickPreset>(() =>
    isResepsionis ? 'today' : 'all',
  );

  // Modals & Row Actions
  const [showManualModal, setShowManualModal] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [selectedVisit, setSelectedVisit] = useState<VisitRecord | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [printingPdf, setPrintingPdf] = useState(false);

  // Print Mode State
  const [printMode, setPrintMode] = useState<'report' | 'poster'>('report');
  const [posterPrintData, setPosterPrintData] = useState<{
    qrDataUrl: string;
    targetUrl: string;
    deskLabel: string;
  } | null>(null);

  useEffect(() => {
    if (initialTab === 'qr' && isSuperAdmin) {
      setActiveTab('qr');
    } else if (initialTab === 'records') {
      setActiveTab('records');
    }
  }, [initialTab, isSuperAdmin]);

  const loadDepartments = useCallback(async () => {
    try {
      const res = await fetch('/api/departments');
      if (!res.ok) return;
      const data = (await res.json()) as { departments?: DepartmentRecord[] };
      if (data.departments?.length) {
        setAvailableDepartments(data.departments.map((d) => d.name));
      }
    } catch {
      // fallback to default list
    }
  }, []);

  useEffect(() => {
    loadDepartments();
  }, [loadDepartments]);

  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (departmentFilter) params.set('department', departmentFilter);
    if (statusFilter) params.set('status', statusFilter);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    return params.toString();
  }, [search, departmentFilter, statusFilter, dateFrom, dateTo]);

  const fetchDashboard = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const qs = buildQueryString();
      const res = await fetch(`/api/admin/dashboard${qs ? `?${qs}` : ''}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Gagal memuat data dashboard.');
        return;
      }
      setStats(data.stats);
      setVisits(data.visits);
    } catch {
      setError('Gagal terhubung ke server untuk memuat data tamu.');
    } finally {
      setLoading(false);
    }
  }, [buildQueryString, token, onSessionExpired]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchDashboard();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [fetchDashboard]);

  const applyQuickPreset = (preset: QuickPreset, switchToRecords = false) => {
    if (isResepsionis) return;
    setQuickPreset(preset);
    setStatusFilter('');
    const today = getTodayWib();
    if (preset === 'all') {
      setDateFrom('');
      setDateTo('');
    } else if (preset === 'today') {
      setDateFrom(today);
      setDateTo(today);
    } else if (preset === 'week') {
      setDateFrom(getWeekStartWib());
      setDateTo(today);
    } else if (preset === 'month') {
      setDateFrom(getMonthStartWib());
      setDateTo(today);
    } else if (preset === 'year') {
      setDateFrom(getYearStartWib());
      setDateTo(today);
    } else if (preset === 'last_year') {
      const lastYr = getLastYearRangeWib();
      setDateFrom(lastYr.start);
      setDateTo(lastYr.end);
    }
    if (switchToRecords) {
      setActiveTab('records');
    }
  };

  const handleToggleStatus = async (visit: VisitRecord) => {
    if (!canModifyStatus) return;
    const nextStatus: VisitStatus =
      visit.status === 'Sedang Berkunjung' ? 'Selesai' : 'Sedang Berkunjung';
    setUpdatingId(visit.id);
    setError('');
    try {
      const res = await fetch(`/api/admin/visits/${encodeURIComponent(visit.id)}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Gagal memperbarui status kunjungan.');
        return;
      }
      await fetchDashboard();
    } catch {
      setError('Gagal terhubung ke server saat memperbarui status.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDeleteVisit = async (visitId: string) => {
    if (!canDelete) return;
    setUpdatingId(visitId);
    setError('');
    try {
      const res = await fetch(`/api/admin/visits/${encodeURIComponent(visitId)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Gagal menghapus data kunjungan.');
        return;
      }
      setConfirmDeleteId(null);
      await fetchDashboard();
    } catch {
      setError('Gagal terhubung ke server saat menghapus data.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleExportCsv = async () => {
    if (!canExport) return;
    setExportingCsv(true);
    setError('');
    try {
      const qs = buildQueryString();
      const res = await fetch(`/api/admin/export${qs ? `?${qs}` : ''}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      if (!res.ok) {
        setError('Gagal mengunduh file Excel (CSV).');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `laporan-buku-tamu-bpbd-sidoarjo-${getTodayWib()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Gagal terhubung ke server saat ekspor CSV.');
    } finally {
      setExportingCsv(false);
    }
  };

  const handlePrintReport = async () => {
    if (!canExport) return;
    setError('');
    setPrintingPdf(true);
    setPrintMode('report');
    try {
      await downloadVisitReportPdf({
        visits,
        stats,
        dateFrom,
        dateTo,
        departmentFilter: effectiveDepartmentLabel,
      });
    } catch {
      setError('Gagal membuat file laporan PDF.');
    } finally {
      setPrintingPdf(false);
    }
  };

  const handlePrintPoster = async (qrDataUrl: string, targetUrl: string, deskLabel: string) => {
    setError('');
    setPosterPrintData({ qrDataUrl, targetUrl, deskLabel });
    setPrintMode('poster');
    try {
      await downloadDeskPosterPdf({ qrDataUrl, targetUrl, deskLabel });
    } catch {
      setError('Gagal membuat file PDF poster meja resepsionis.');
    }
  };

  const effectiveDepartmentLabel =
    isPimpinan && authUser.department !== 'Semua Bidang'
      ? authUser.department
      : departmentFilter;

  return (
    <>
      <main className="no-print max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-7">
        {/* Page Header + Authenticated Role Identity */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#FDBA74]">
              <span>{authUser.fullName}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{authUser.username}</span>
              <span aria-hidden="true">·</span>
              <span>{ROLE_LABELS[authUser.role]}</span>
              {isPimpinan && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{authUser.department}</span>
                </>
              )}
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight">
              Dashboard Monitoring SI-TAMU BPBD
            </h1>
          </div>

          {/* RBAC-Scoped Tab Switcher */}
          <div className="flex flex-wrap items-center gap-1 p-1 bg-white/10 border border-white/15 rounded-xl self-start">
            <button
              type="button"
              onClick={() => setActiveTab('records')}
              className={`inline-flex items-center gap-2 px-3.5 py-2 min-h-[40px] text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'records'
                  ? 'bg-[#EA580C] text-white shadow-sm'
                  : 'text-slate-200 hover:text-white'
              }`}
            >
              <Users className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{isResepsionis ? 'Tamu Hari Ini' : 'Daftar Tamu'}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('recap')}
              className={`inline-flex items-center gap-2 px-3.5 py-2 min-h-[40px] text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'recap'
                  ? 'bg-[#EA580C] text-white shadow-sm'
                  : 'text-slate-200 hover:text-white'
              }`}
            >
              <BarChart3 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Rekap Laporan</span>
            </button>

            {isSuperAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab('qr')}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 min-h-[40px] text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    activeTab === 'qr'
                      ? 'bg-[#EA580C] text-white shadow-sm'
                      : 'text-slate-200 hover:text-white'
                  }`}
                >
                  <QrCode className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Poster QR</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('departments')}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 min-h-[40px] text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    activeTab === 'departments'
                      ? 'bg-[#EA580C] text-white shadow-sm'
                      : 'text-slate-200 hover:text-white'
                  }`}
                >
                  <Building2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Master Bidang</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('users')}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 min-h-[40px] text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    activeTab === 'users'
                      ? 'bg-[#EA580C] text-white shadow-sm'
                      : 'text-slate-200 hover:text-white'
                  }`}
                >
                  <Shield className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Akun & RBAC</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('audit')}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 min-h-[40px] text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    activeTab === 'audit'
                      ? 'bg-[#EA580C] text-white shadow-sm'
                      : 'text-slate-200 hover:text-white'
                  }`}
                >
                  <ClipboardList className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Log Audit</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Role Scope Notice for Resepsionis / Pimpinan */}
        {isPimpinan && (
          <div className="px-4 py-3 rounded-xl bg-white/10 border border-white/15 text-xs sm:text-sm text-slate-200 flex items-center gap-2.5">
            <Lock className="w-4 h-4 text-[#FDBA74] shrink-0" aria-hidden="true" />
            <span>
              Mode Akses Baca (Read-Only): Menampilkan statistik dan daftar kunjungan untuk{' '}
              <strong className="text-white">{authUser.department}</strong>.
            </span>
          </div>
        )}
        {isResepsionis && (
          <div className="px-4 py-3 rounded-xl bg-white/10 border border-white/15 text-xs sm:text-sm text-slate-200 flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-[#FDBA74] shrink-0" aria-hidden="true" />
            <span>
              Mode Petugas Resepsionis / Piket: Menampilkan daftar tamu hari berjalan (
              {formatShortDate(getTodayWib())}) untuk verifikasi kedatangan & Check-Out.
            </span>
          </div>
        )}

        {/* Vibrant Colorful KPI Summary Tiles (Inspired by Reference Photo) */}
        <section
          aria-label="Ringkasan Statistik Kunjungan"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          {/* 1. Tamu Hari Ini - Biru Cerah */}
          <button
            type="button"
            onClick={() => {
              if (!isResepsionis) applyQuickPreset('today', true);
              else {
                setStatusFilter('');
                setActiveTab('records');
              }
            }}
            className="text-left bg-gradient-to-br from-[#007BFF] to-[#0056CC] hover:brightness-105 text-white rounded-xl p-5 shadow-lg transition-all flex items-center justify-between gap-4 border border-white/15"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white/95">Tamu Hari Ini</p>
              <p className="mt-2 tabular-nums text-3xl sm:text-4xl font-bold leading-none">
                {stats.totalToday}
              </p>
              <p className="mt-2 text-xs text-white/85">{formatShortDate(getTodayWib())}</p>
            </div>
            <UserCheck className="w-12 h-12 text-white/85 shrink-0" aria-hidden="true" />
          </button>

          {/* 2. Tamu Sedang Berkunjung - Oranye Cerah */}
          <button
            type="button"
            onClick={() => {
              setStatusFilter('Sedang Berkunjung');
              setActiveTab('records');
            }}
            className="text-left bg-gradient-to-br from-[#EA580C] to-[#C2410C] hover:brightness-105 text-white rounded-xl p-5 shadow-lg transition-all flex items-center justify-between gap-4 border border-white/15"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white/95">Tamu Sedang Berkunjung</p>
              <p className="mt-2 tabular-nums text-3xl sm:text-4xl font-bold leading-none">
                {stats.activeNow}
              </p>
              <p className="mt-2 text-xs text-white/85">Belum Check-Out</p>
            </div>
            <Clock className="w-12 h-12 text-white/85 shrink-0" aria-hidden="true" />
          </button>

          {!isResepsionis ? (
            <>
              {/* 3. Tamu Minggu Ini - Cyan Toska */}
              <button
                type="button"
                onClick={() => applyQuickPreset('week', true)}
                className="text-left bg-gradient-to-br from-[#17A2B8] to-[#0E7490] hover:brightness-105 text-white rounded-xl p-5 shadow-lg transition-all flex items-center justify-between gap-4 border border-white/15"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white/95">Tamu Minggu Ini</p>
                  <p className="mt-2 tabular-nums text-3xl sm:text-4xl font-bold leading-none">
                    {stats.totalWeek}
                  </p>
                  <p className="mt-2 text-xs text-white/85">Senin – Hari ini</p>
                </div>
                <IdCard className="w-12 h-12 text-white/85 shrink-0" aria-hidden="true" />
              </button>

              {/* 4. Tamu Bulan Ini - Hijau Cerah */}
              <button
                type="button"
                onClick={() => applyQuickPreset('month', true)}
                className="text-left bg-gradient-to-br from-[#28A745] to-[#1E7E34] hover:brightness-105 text-white rounded-xl p-5 shadow-lg transition-all flex items-center justify-between gap-4 border border-white/15"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white/95">Tamu Bulan Ini</p>
                  <p className="mt-2 tabular-nums text-3xl sm:text-4xl font-bold leading-none">
                    {stats.totalMonth}
                  </p>
                  <p className="mt-2 text-xs text-white/85">Akumulasi bulan berjalan</p>
                </div>
                <CalendarRange className="w-12 h-12 text-white/85 shrink-0" aria-hidden="true" />
              </button>

              {/* 5. Tamu Tahun Ini - Merah Cerah */}
              <button
                type="button"
                onClick={() => applyQuickPreset('year', true)}
                className="text-left bg-gradient-to-br from-[#DC3545] to-[#B02A37] hover:brightness-105 text-white rounded-xl p-5 shadow-lg transition-all flex items-center justify-between gap-4 border border-white/15"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white/95">
                    Tamu Tahun Ini ({getTodayWib().slice(0, 4)})
                  </p>
                  <p className="mt-2 tabular-nums text-3xl sm:text-4xl font-bold leading-none">
                    {stats.totalYear}
                  </p>
                  <p className="mt-2 text-xs text-white/85">Januari – Desember</p>
                </div>
                <Calendar className="w-12 h-12 text-white/85 shrink-0" aria-hidden="true" />
              </button>

              {/* 6. Tamu Tahun Lalu - Kuning Emas */}
              <button
                type="button"
                onClick={() => applyQuickPreset('last_year', true)}
                className="text-left bg-gradient-to-br from-[#E69B00] to-[#C67C00] hover:brightness-105 text-white rounded-xl p-5 shadow-lg transition-all flex items-center justify-between gap-4 border border-white/15"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white/95">
                    Tamu Tahun Lalu ({getLastYearRangeWib().year})
                  </p>
                  <p className="mt-2 tabular-nums text-3xl sm:text-4xl font-bold leading-none">
                    {stats.totalLastYear}
                  </p>
                  <p className="mt-2 text-xs text-white/90">Arsip tahun sebelumnya</p>
                </div>
                <History className="w-12 h-12 text-white/85 shrink-0" aria-hidden="true" />
              </button>

              {/* 7. Total Semua Tamu - Abu-abu Slate */}
              <button
                type="button"
                onClick={() => applyQuickPreset('all', true)}
                className="text-left bg-gradient-to-br from-[#6C757D] to-[#495057] hover:brightness-105 text-white rounded-xl p-5 shadow-lg transition-all flex items-center justify-between gap-4 border border-white/15"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white/95">Total Tamu</p>
                  <p className="mt-2 tabular-nums text-3xl sm:text-4xl font-bold leading-none">
                    {stats.totalAll}
                  </p>
                  <p className="mt-2 text-xs text-white/85">Seluruh kunjungan tercatat</p>
                </div>
                <Users className="w-12 h-12 text-white/85 shrink-0" aria-hidden="true" />
              </button>

              {/* 8. Bidang Terbanyak Dikunjungi - Biru Indigo */}
              <div className="bg-gradient-to-br from-[#4F46E5] to-[#1E3A8A] text-white rounded-xl p-5 shadow-lg flex items-center justify-between gap-4 border border-white/15">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white/95">Bidang Terbanyak</p>
                  <p className="mt-2 text-base font-bold leading-snug line-clamp-2">
                    {stats.topDepartment ? stats.topDepartment.name : 'Belum ada data'}
                  </p>
                  <p className="mt-1.5 text-xs text-white/85 tabular-nums">
                    {stats.topDepartment
                      ? `${stats.topDepartment.count} kunjungan`
                      : '0 kunjungan'}
                  </p>
                </div>
                <Building2 className="w-11 h-11 text-white/85 shrink-0" aria-hidden="true" />
              </div>
            </>
          ) : (
            <>
              {/* 3 (Resepsionis). Sudah Check-Out Hari Ini - Hijau Cerah */}
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('Selesai');
                  setActiveTab('records');
                }}
                className="text-left bg-gradient-to-br from-[#28A745] to-[#1E7E34] hover:brightness-105 text-white rounded-xl p-5 shadow-lg transition-all flex items-center justify-between gap-4 border border-white/15"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white/95">Sudah Check-Out</p>
                  <p className="mt-2 tabular-nums text-3xl sm:text-4xl font-bold leading-none">
                    {Math.max(0, stats.totalToday - stats.activeNow)}
                  </p>
                  <p className="mt-2 text-xs text-white/85">Selesai kunjungan hari ini</p>
                </div>
                <CheckCircle2 className="w-12 h-12 text-white/85 shrink-0" aria-hidden="true" />
              </button>

              {/* 4 (Resepsionis). Bidang Terbanyak - Biru Indigo */}
              <div className="bg-gradient-to-br from-[#4F46E5] to-[#1E3A8A] text-white rounded-xl p-5 shadow-lg flex items-center justify-between gap-4 border border-white/15">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white/95">Bidang Terbanyak</p>
                  <p className="mt-2 text-base font-bold leading-snug line-clamp-2">
                    {stats.topDepartment ? stats.topDepartment.name : 'Belum ada data'}
                  </p>
                  <p className="mt-1.5 text-xs text-white/85 tabular-nums">
                    {stats.topDepartment
                      ? `${stats.topDepartment.count} kunjungan`
                      : '0 kunjungan'}
                  </p>
                </div>
                <Building2 className="w-11 h-11 text-white/85 shrink-0" aria-hidden="true" />
              </div>
            </>
          )}
        </section>

        {activeTab === 'qr' && isSuperAdmin ? (
          <QrPosterStudio onPrintPoster={handlePrintPoster} />
        ) : activeTab === 'recap' ? (
          <section className="space-y-6">
            {/* Rekapitulasi Periode */}
            <div className="bg-[#F8FAFC] border border-white/25 rounded-2xl overflow-hidden shadow-xl">
              <div className="px-6 py-5 bg-gradient-to-r from-[#0F294A] to-[#1A4275] text-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold">
                    Rekapitulasi Laporan Kunjungan Tamu
                  </h2>
                  <p className="text-xs text-slate-200 mt-0.5">
                    Ringkasan jumlah tamu berdasarkan periode Hari Ini, Minggu Ini, Bulan Ini, Tahun
                    Ini, dan Tahun Lalu
                  </p>
                </div>
                {canExport && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={exportingCsv}
                      onClick={handleExportCsv}
                      className="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] text-xs font-semibold text-[#0F294A] bg-white hover:bg-slate-100 rounded-xl transition-colors"
                    >
                      <FileSpreadsheet className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>Export CSV</span>
                    </button>
                    <button
                      type="button"
                      disabled={printingPdf}
                      onClick={handlePrintReport}
                      className="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] text-xs font-semibold text-white bg-[#EA580C] hover:bg-[#C2410C] disabled:opacity-60 rounded-xl transition-colors"
                    >
                      <Printer className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>{printingPdf ? 'Menyiapkan PDF...' : 'Cetak Rekap PDF'}</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto bg-white">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">
                      <th className="py-3.5 px-5">Periode Laporan</th>
                      <th className="py-3.5 px-5">Rentang Tanggal (WIB)</th>
                      <th className="py-3.5 px-5 text-right">Jumlah Tamu</th>
                      <th className="py-3.5 px-5 text-right">Sedang Berkunjung</th>
                      <th className="py-3.5 px-5 text-right">Selesai (Check-Out)</th>
                      {!isResepsionis && <th className="py-3.5 px-5 text-right">Aksi</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(stats.periodRecap || []).map((row) => (
                      <tr key={row.key} className="hover:bg-slate-50/80">
                        <td className="py-3.5 px-5 font-bold text-[#0F294A]">{row.label}</td>
                        <td className="py-3.5 px-5 text-xs text-slate-600 tabular-nums">
                          {row.rangeLabel}
                        </td>
                        <td className="py-3.5 px-5 text-right font-bold tabular-nums text-[#007BFF]">
                          {row.total}
                        </td>
                        <td className="py-3.5 px-5 text-right font-semibold tabular-nums text-[#EA580C]">
                          {row.active}
                        </td>
                        <td className="py-3.5 px-5 text-right font-semibold tabular-nums text-[#28A745]">
                          {row.done}
                        </td>
                        {!isResepsionis && (
                          <td className="py-3.5 px-5 text-right">
                            <button
                              type="button"
                              onClick={() => applyQuickPreset(row.key, true)}
                              className="px-3 py-1.5 text-xs font-semibold text-white bg-[#0F294A] hover:bg-[#091B33] rounded-lg transition-colors"
                            >
                              Lihat Rincian
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Breakdown Per Bidang & Kategori Pengunjung (berdasarkan filter aktif) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Per Bidang Tujuan */}
              <div className="bg-[#F8FAFC] border border-white/25 rounded-2xl overflow-hidden shadow-xl">
                <div className="px-6 py-4 bg-white border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-[#0F294A]">
                      Rekap per Bidang Tujuan
                    </h3>
                    <p className="text-xs text-slate-500">
                      Periode filter aktif ({visits.length} kunjungan)
                    </p>
                  </div>
                </div>
                <div className="p-5 bg-white space-y-3">
                  {stats.departmentBreakdown.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4 text-center">
                      Belum ada data kunjungan pada periode filter aktif.
                    </p>
                  ) : (
                    stats.departmentBreakdown.map((item) => {
                      const pct =
                        visits.length > 0 ? Math.round((item.total / visits.length) * 100) : 0;
                      return (
                        <div key={item.name} className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs sm:text-sm">
                            <span className="font-semibold text-slate-800">{item.name}</span>
                            <span className="font-bold text-[#0F294A] tabular-nums">
                              {item.total} ({pct}%)
                            </span>
                          </div>
                          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#007BFF] rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Per Kategori Pengunjung */}
              <div className="bg-[#F8FAFC] border border-white/25 rounded-2xl overflow-hidden shadow-xl">
                <div className="px-6 py-4 bg-white border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-[#0F294A]">
                      Rekap per Kategori Pengunjung
                    </h3>
                    <p className="text-xs text-slate-500">
                      Periode filter aktif ({visits.length} kunjungan)
                    </p>
                  </div>
                </div>
                <div className="p-5 bg-white space-y-3">
                  {stats.categoryBreakdown.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4 text-center">
                      Belum ada data kunjungan pada periode filter aktif.
                    </p>
                  ) : (
                    stats.categoryBreakdown.map((item) => {
                      const pct =
                        visits.length > 0 ? Math.round((item.total / visits.length) * 100) : 0;
                      return (
                        <div key={item.name} className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs sm:text-sm">
                            <span className="font-semibold text-slate-800">{item.name}</span>
                            <span className="font-bold text-[#0F294A] tabular-nums">
                              {item.total} ({pct}%)
                            </span>
                          </div>
                          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#EA580C] rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </section>
        ) : (activeTab === 'departments' || activeTab === 'users' || activeTab === 'audit') &&
          isSuperAdmin ? (
          <AdminManagementPanel
            token={token}
            currentUser={authUser}
            mode={activeTab}
            onDepartmentsUpdated={loadDepartments}
            onSessionExpired={onSessionExpired}
          />
        ) : (
          <section className="bg-[#F8FAFC] border border-white/25 rounded-2xl overflow-hidden shadow-xl">
            {/* Toolbar & Filters */}
            <div className="p-5 sm:p-6 border-b border-slate-200 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                {/* Search */}
                <div className="relative flex-1 max-w-md">
                  <Search
                    className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Cari nama tamu, instansi, HP, atau nomor urut..."
                    aria-label="Cari tamu atau instansi"
                    className="w-full min-h-[42px] pl-10 pr-4 py-2 text-sm rounded-xl border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0F294A] focus:ring-2 focus:ring-[#EA580C]/25"
                  />
                </div>

                {/* RBAC Action Buttons */}
                <div className="flex flex-wrap items-center gap-2.5">
                  {canManualInput && (
                    <button
                      type="button"
                      onClick={() => setShowManualModal(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs sm:text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#091B33] rounded-xl transition-colors whitespace-nowrap shrink-0"
                    >
                      <UserPlus className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>Input Bantuan Petugas</span>
                    </button>
                  )}

                  {canExport && (
                    <>
                      <button
                        type="button"
                        disabled={exportingCsv}
                        onClick={handleExportCsv}
                        className="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs sm:text-sm font-semibold text-[#0F294A] bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-60 rounded-xl transition-colors whitespace-nowrap shrink-0"
                      >
                        <FileSpreadsheet className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>{exportingCsv ? 'Mengunduh...' : 'Export Excel (CSV)'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={printingPdf}
                        onClick={handlePrintReport}
                        className="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] text-xs sm:text-sm font-semibold text-white bg-[#EA580C] hover:bg-[#C2410C] disabled:opacity-60 rounded-xl transition-colors whitespace-nowrap shrink-0"
                      >
                        <Printer className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>{printingPdf ? 'Menyiapkan PDF...' : 'Cetak Laporan PDF'}</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Date Presets & Dropdown Filters */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                {!isResepsionis && (
                  <>
                    <div className="inline-flex flex-wrap items-center p-1 bg-slate-200/70 rounded-lg gap-0.5">
                      {(
                        [
                          { id: 'all', label: 'Semua' },
                          { id: 'today', label: 'Hari Ini' },
                          { id: 'week', label: 'Minggu Ini' },
                          { id: 'month', label: 'Bulan Ini' },
                          { id: 'year', label: 'Tahun Ini' },
                          { id: 'last_year', label: 'Tahun Lalu' },
                        ] as const
                      ).map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => applyQuickPreset(preset.id)}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                            quickPreset === preset.id
                              ? 'bg-[#0F294A] text-white shadow-sm'
                              : 'text-slate-700 hover:text-slate-900'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      <label htmlFor="filter-date-from" className="text-slate-500 font-medium">
                        Dari:
                      </label>
                      <input
                        id="filter-date-from"
                        type="date"
                        value={dateFrom}
                        onChange={(e) => {
                          setQuickPreset('all');
                          setDateFrom(e.target.value);
                        }}
                        className="min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-mono bg-white"
                      />
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      <label htmlFor="filter-date-to" className="text-slate-500 font-medium">
                        Sampai:
                      </label>
                      <input
                        id="filter-date-to"
                        type="date"
                        value={dateTo}
                        onChange={(e) => {
                          setQuickPreset('all');
                          setDateTo(e.target.value);
                        }}
                        className="min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-mono bg-white"
                      />
                    </div>
                  </>
                )}

                {(!isPimpinan || authUser.department === 'Semua Bidang') && (
                  <select
                    aria-label="Filter Bidang Tujuan"
                    value={departmentFilter}
                    onChange={(e) => setDepartmentFilter(e.target.value)}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white text-slate-800"
                  >
                    <option value="">Semua Bidang Tujuan</option>
                    {availableDepartments.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                )}

                <select
                  aria-label="Filter Status Kunjungan"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white text-slate-800"
                >
                  <option value="">Semua Status</option>
                  {VISIT_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="m-5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700"
              >
                {error}
              </div>
            )}

            {/* Table / Loading / Empty States */}
            {loading ? (
              <div className="p-6 space-y-3 bg-white">
                {[1, 2, 3, 4].map((idx) => (
                  <div key={idx} className="h-12 bg-slate-100 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : visits.length === 0 ? (
              <div className="px-6 py-14 text-center space-y-4 bg-white">
                <div className="mx-auto w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-[#0F294A]">
                  <Users className="w-6 h-6" aria-hidden="true" />
                </div>
                <div className="max-w-md mx-auto space-y-1">
                  <h2 className="font-display text-base font-bold text-[#0F294A]">
                    Belum Ada Data Kunjungan
                  </h2>
                  <p className="text-sm text-slate-500">
                    Data tamu yang mengisi formulir setelah memindai QR Code atau melalui input
                    bantuan petugas akan tampil di sini.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                  {canManualInput && (
                    <button
                      type="button"
                      onClick={() => setShowManualModal(true)}
                      className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[42px] text-xs sm:text-sm font-semibold text-white bg-[#EA580C] hover:bg-[#C2410C] rounded-xl transition-colors"
                    >
                      <UserPlus className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>Input Bantuan Petugas</span>
                    </button>
                  )}
                  {isSuperAdmin && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('qr')}
                      className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[42px] text-xs sm:text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#091B33] rounded-xl transition-colors"
                    >
                      <QrCode className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>Buka Generator QR Meja</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onOpenGuestForm}
                    className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[42px] text-xs sm:text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                  >
                    <span>Buka Formulir Tamu</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto bg-white">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4 whitespace-nowrap">No. Urut</th>
                      <th className="py-3 px-4 whitespace-nowrap">Waktu</th>
                      <th className="py-3 px-4">Tamu & Kontak</th>
                      <th className="py-3 px-4">Instansi / Alamat</th>
                      <th className="py-3 px-4">Bidang Tujuan</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right whitespace-nowrap">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {visits.map((v) => {
                      const isDone = v.status === 'Selesai';
                      const isBusy = updatingId === v.id;
                      return (
                        <tr key={v.id} className="hover:bg-slate-50/75 transition-colors align-top">
                          <td className="py-3.5 px-4 font-mono tabular-nums font-bold text-[#0F294A] whitespace-nowrap">
                            {v.queueCode}
                          </td>
                          <td className="py-3.5 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                            <div className="font-medium text-slate-800">
                              {formatShortDate(v.visitDate)}
                            </div>
                            <div>Masuk: {formatWibTime(v.checkInAt)}</div>
                            {v.checkOutAt && <div>Keluar: {formatWibTime(v.checkOutAt)}</div>}
                          </td>
                          <td className="py-3.5 px-4 min-w-[180px]">
                            <div className="font-semibold text-slate-900">{v.fullName}</div>
                            <div className="text-xs text-slate-500 font-mono tabular-nums">
                              {v.phone}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5">{v.visitorCategory}</div>
                          </td>
                          <td className="py-3.5 px-4 min-w-[180px]">
                            <div className="text-slate-800">{v.institutionAddress}</div>
                            <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                              {v.purpose}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 min-w-[180px]">
                            <div className="font-medium text-[#0F294A]">{v.department}</div>
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {isDone ? (
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                                <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                                <span>Selesai</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#EA580C]">
                                <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
                                <span>Sedang Berkunjung</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              {canModifyStatus && (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleToggleStatus(v)}
                                  className={`px-3 py-1.5 min-h-[34px] text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                                    isDone
                                      ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                      : 'bg-[#EA580C] text-white hover:bg-[#C2410C]'
                                  }`}
                                >
                                  {isDone ? 'Buka Lagi' : 'Check-Out'}
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => setSelectedVisit(v)}
                                title="Lihat Detail & Tanda Tangan"
                                className="p-2 min-h-[34px] min-w-[34px] text-slate-600 hover:text-[#0F294A] hover:bg-slate-100 rounded-lg transition-colors"
                              >
                                <Eye className="w-4 h-4" aria-hidden="true" />
                              </button>

                              {canDelete &&
                                (confirmDeleteId === v.id ? (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => handleDeleteVisit(v.id)}
                                    className="px-2.5 py-1.5 min-h-[34px] text-xs font-semibold bg-red-600 text-white hover:bg-red-700 rounded-lg transition-colors"
                                  >
                                    Konfirmasi Hapus
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(v.id)}
                                    title="Hapus Data"
                                    className="p-2 min-h-[34px] min-w-[34px] text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                  >
                                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                                  </button>
                                ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>

      {/* Manual Staff Entry Modal */}
      {showManualModal && canManualInput && (
        <ManualVisitModal
          token={token}
          departments={availableDepartments}
          onClose={() => setShowManualModal(false)}
          onCreated={fetchDashboard}
          onSessionExpired={onSessionExpired}
        />
      )}

      {/* Visit Detail & Signature Modal */}
      {selectedVisit && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-visit-title"
          className="no-print fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full overflow-hidden shadow-xl">
            <div className="bg-[#0F294A] text-white px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-300 font-mono tabular-nums">
                  Nomor Urut {selectedVisit.queueCode}
                </p>
                <h3 id="modal-visit-title" className="font-display text-base font-bold">
                  Detail Kunjungan Tamu
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedVisit(null)}
                aria-label="Tutup modal"
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 block">Nama Lengkap</span>
                  <span className="font-semibold text-slate-900">{selectedVisit.fullName}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Nomor HP/WhatsApp</span>
                  <span className="font-mono tabular-nums font-medium text-slate-900">
                    {selectedVisit.phone}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Kategori</span>
                  <span className="text-slate-900">{selectedVisit.visitorCategory}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Bidang Tujuan</span>
                  <span className="font-semibold text-[#0F294A]">{selectedVisit.department}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 block">Instansi / Alamat</span>
                  <span className="text-slate-900">{selectedVisit.institutionAddress}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 block">Keperluan</span>
                  <span className="text-slate-800">{selectedVisit.purpose}</span>
                </div>
                <div className="col-span-2 font-mono tabular-nums text-slate-600">
                  {formatIndonesianDate(selectedVisit.visitDate)} · Masuk{' '}
                  {formatWibTime(selectedVisit.checkInAt)}
                  {selectedVisit.checkOutAt && ` · Keluar ${formatWibTime(selectedVisit.checkOutAt)}`}
                </div>
              </div>

              <div>
                <span className="text-xs text-slate-500 block mb-1.5">Tanda Tangan Digital</span>
                <div className="border border-slate-200 rounded-xl bg-slate-50 p-3 flex justify-center">
                  <img
                    src={selectedVisit.signatureData}
                    alt={`Tanda tangan ${selectedVisit.fullName}`}
                    className="max-h-28 object-contain"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <a
                  href={selectedVisit.signatureData}
                  download={`ttd-${selectedVisit.queueCode}-${selectedVisit.fullName}.png`}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Unduh TTD</span>
                </a>
                <button
                  type="button"
                  onClick={() => setSelectedVisit(null)}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#0F294A] hover:bg-[#091B33] rounded-xl"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Print Views */}
      {printMode === 'poster' && posterPrintData ? (
        <PrintPosterView
          qrDataUrl={posterPrintData.qrDataUrl}
          targetUrl={posterPrintData.targetUrl}
          deskLabel={posterPrintData.deskLabel}
        />
      ) : (
        <PrintReportView
          visits={visits}
          stats={stats}
          dateFrom={dateFrom}
          dateTo={dateTo}
          departmentFilter={effectiveDepartmentLabel}
        />
      )}
    </>
  );
}
