import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Building2,
  CheckCircle2,
  ClipboardList,
  Clock,
  Download,
  Eye,
  FileSpreadsheet,
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
  type VisitRecord,
  type VisitStatus,
} from '../types';
import {
  ApiError,
  deleteVisitRecord,
  exportVisitsCsvBlob,
  fetchDashboardData,
  fetchPublicDepartments,
  updateVisitStatus,
} from '../lib/api';
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
type BreakdownTab = 'department' | 'category';

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

  // Filters — default strictly to Today ("Hanya Tamu Hari Ini")
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState(() => getTodayWib());
  const [dateTo, setDateTo] = useState(() => getTodayWib());
  const [quickPreset, setQuickPreset] = useState<QuickPreset>('today');
  const [selectedRecapKey, setSelectedRecapKey] = useState<QuickPreset>('today');
  const [breakdownTab, setBreakdownTab] = useState<BreakdownTab>('department');

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
      const depts = await fetchPublicDepartments();
      if (depts.length) {
        setAvailableDepartments(depts.map((d) => d.name));
      }
    } catch {
      // fallback to default list
    }
  }, []);

  useEffect(() => {
    loadDepartments();
  }, [loadDepartments]);

  const fetchDashboard = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const data = await fetchDashboardData(token, {
        search: search.trim(),
        department: departmentFilter,
        status: statusFilter,
        dateFrom,
        dateTo,
      });
      setStats(data.stats);
      setVisits(data.visits);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired();
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : 'Gagal terhubung ke server untuk memuat data tamu.',
      );
    } finally {
      setLoading(false);
    }
  }, [search, departmentFilter, statusFilter, dateFrom, dateTo, token, onSessionExpired]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchDashboard();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [fetchDashboard]);

  const applyQuickPreset = (preset: QuickPreset, switchToRecords = false) => {
    if (isResepsionis && preset !== 'today') return;
    setQuickPreset(preset);
    setSelectedRecapKey(preset);
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
      await updateVisitStatus(token, visit.id, nextStatus);
      await fetchDashboard();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired();
        return;
      }
      setError(err instanceof Error ? err.message : 'Gagal memperbarui status kunjungan.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDeleteVisit = async (visitId: string) => {
    if (!canDelete) return;
    setUpdatingId(visitId);
    setError('');
    try {
      await deleteVisitRecord(token, visitId);
      setConfirmDeleteId(null);
      await fetchDashboard();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired();
        return;
      }
      setError(err instanceof Error ? err.message : 'Gagal menghapus data kunjungan.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleExportCsv = async () => {
    if (!canExport) return;
    setExportingCsv(true);
    setError('');
    try {
      const { blob, filename } = await exportVisitsCsvBlob(token, {
        search: search.trim(),
        department: departmentFilter,
        status: statusFilter,
        dateFrom,
        dateTo,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired();
        return;
      }
      setError(err instanceof Error ? err.message : 'Gagal mengunduh file Excel (CSV).');
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
              onClick={() => applyQuickPreset('today', true)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 min-h-[40px] text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'records'
                  ? 'bg-[#EA580C] text-white shadow-sm'
                  : 'text-slate-200 hover:text-white'
              }`}
            >
              <Users className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Tamu Hari Ini</span>
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

        {/* Dashboard KPI Tiles: Hanya Tamu Hari Ini */}
        {activeTab === 'records' &&
          (() => {
            const todayRecap = stats.periodRecap?.find((item) => item.key === 'today');
            const todayActive = todayRecap?.active ?? stats.activeNow;
            const todayDone =
              todayRecap?.done ?? Math.max(0, stats.totalToday - todayActive);
            return (
              <section
                aria-label="Ringkasan Tamu Hari Ini"
                className="grid grid-cols-1 sm:grid-cols-3 gap-3.5"
              >
                {/* 1. Tamu Hari Ini - Biru Cerah */}
                <button
                  type="button"
                  onClick={() => applyQuickPreset('today', true)}
                  className="text-left bg-gradient-to-br from-[#007BFF] to-[#0056CC] hover:brightness-105 text-white rounded-xl p-4 sm:p-5 shadow-lg transition-all flex items-center justify-between gap-4 border border-white/15"
                >
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-semibold text-white/95">
                      Tamu Hari Ini
                    </p>
                    <p className="mt-1.5 tabular-nums text-3xl font-bold leading-none">
                      {stats.totalToday}
                    </p>
                    <p className="mt-1.5 text-xs text-white/85">
                      {formatShortDate(getTodayWib())}
                    </p>
                  </div>
                  <UserCheck className="w-10 h-10 sm:w-11 sm:h-11 text-white/85 shrink-0" aria-hidden="true" />
                </button>

                {/* 2. Tamu Sedang Berkunjung Hari Ini - Oranye Cerah */}
                <button
                  type="button"
                  onClick={() => {
                    if (quickPreset !== 'today') {
                      applyQuickPreset('today', true);
                    }
                    setStatusFilter('Sedang Berkunjung');
                  }}
                  className="text-left bg-gradient-to-br from-[#EA580C] to-[#C2410C] hover:brightness-105 text-white rounded-xl p-4 sm:p-5 shadow-lg transition-all flex items-center justify-between gap-4 border border-white/15"
                >
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-semibold text-white/95">
                      Sedang Berkunjung
                    </p>
                    <p className="mt-1.5 tabular-nums text-3xl font-bold leading-none">
                      {todayActive}
                    </p>
                    <p className="mt-1.5 text-xs text-white/85">Belum Check-Out hari ini</p>
                  </div>
                  <Clock className="w-10 h-10 sm:w-11 sm:h-11 text-white/85 shrink-0" aria-hidden="true" />
                </button>

                {/* 3. Sudah Check-Out Hari Ini - Hijau Cerah */}
                <button
                  type="button"
                  onClick={() => {
                    if (quickPreset !== 'today') {
                      applyQuickPreset('today', true);
                    }
                    setStatusFilter('Selesai');
                  }}
                  className="text-left bg-gradient-to-br from-[#28A745] to-[#1E7E34] hover:brightness-105 text-white rounded-xl p-4 sm:p-5 shadow-lg transition-all flex items-center justify-between gap-4 border border-white/15"
                >
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-semibold text-white/95">
                      Sudah Check-Out
                    </p>
                    <p className="mt-1.5 tabular-nums text-3xl font-bold leading-none">
                      {todayDone}
                    </p>
                    <p className="mt-1.5 text-xs text-white/85">Selesai kunjungan hari ini</p>
                  </div>
                  <CheckCircle2 className="w-10 h-10 sm:w-11 sm:h-11 text-white/85 shrink-0" aria-hidden="true" />
                </button>
              </section>
            );
          })()}

        {activeTab === 'qr' && isSuperAdmin ? (
          <QrPosterStudio onPrintPoster={handlePrintPoster} />
        ) : activeTab === 'recap' ? (
          (() => {
            const recapList = stats.periodRecap || [];
            const activeRecapItem =
              recapList.find((item) => item.key === selectedRecapKey) ||
              recapList[0] || {
                key: 'today' as QuickPreset,
                label: 'Hari Ini',
                rangeLabel: getTodayWib(),
                total: stats.totalToday,
                active: stats.activeNow,
                done: Math.max(0, stats.totalToday - stats.activeNow),
              };
            const availableRecapOptions = isResepsionis
              ? recapList.filter((item) => item.key === 'today')
              : recapList;
            const breakdownItems =
              breakdownTab === 'department' ? stats.departmentBreakdown : stats.categoryBreakdown;

            return (
              <section className="space-y-5">
                {/* Item Rekapan Pilihan — Simpel & Praktis */}
                <div className="bg-[#F8FAFC] border border-white/25 rounded-2xl overflow-hidden shadow-xl">
                  <div className="px-5 py-4 bg-gradient-to-r from-[#0F294A] to-[#1A4275] text-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <h2 className="text-base sm:text-lg font-bold">
                        Rekapitulasi Laporan Kunjungan
                      </h2>
                      <p className="text-xs text-slate-200 mt-0.5">
                        Pilih item periode rekapan untuk melihat ringkasan & mencetak laporan.
                      </p>
                    </div>
                    {canExport && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={exportingCsv}
                          onClick={handleExportCsv}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] text-xs font-semibold text-[#0F294A] bg-white hover:bg-slate-100 rounded-xl transition-colors"
                        >
                          <FileSpreadsheet className="w-4 h-4 shrink-0" aria-hidden="true" />
                          <span>Export CSV</span>
                        </button>
                        <button
                          type="button"
                          disabled={printingPdf}
                          onClick={handlePrintReport}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] text-xs font-semibold text-white bg-[#EA580C] hover:bg-[#C2410C] disabled:opacity-60 rounded-xl transition-colors"
                        >
                          <Printer className="w-4 h-4 shrink-0" aria-hidden="true" />
                          <span>{printingPdf ? 'Menyiapkan PDF...' : 'Cetak Rekap PDF'}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="p-4 sm:p-5 bg-white space-y-4">
                    {/* Compact Period Dropdown Selector */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 flex-1">
                        <label
                          htmlFor="recap-period-select"
                          className="text-xs sm:text-sm font-bold text-[#0F294A] whitespace-nowrap"
                        >
                          Pilih Item Rekapan:
                        </label>
                        <select
                          id="recap-period-select"
                          value={selectedRecapKey}
                          disabled={isResepsionis}
                          onChange={(e) => applyQuickPreset(e.target.value as QuickPreset, false)}
                          className="min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-300 bg-slate-50 text-sm font-semibold text-[#0F294A] focus:outline-none focus:border-[#0F294A] focus:ring-2 focus:ring-[#EA580C]/25 sm:min-w-[230px]"
                        >
                          {availableRecapOptions.length > 0 ? (
                            availableRecapOptions.map((item) => (
                              <option key={item.key} value={item.key}>
                                {item.label} ({item.total} tamu)
                              </option>
                            ))
                          ) : (
                            <option value="today">Hari Ini</option>
                          )}
                        </select>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 text-xs text-slate-500">
                        <span className="font-mono tabular-nums bg-slate-100 px-2.5 py-1.5 rounded-lg text-slate-700">
                          {activeRecapItem.rangeLabel}
                        </span>
                        {!isResepsionis && (
                          <button
                            type="button"
                            onClick={() => applyQuickPreset(activeRecapItem.key, true)}
                            className="px-3 py-1.5 min-h-[34px] text-xs font-semibold text-white bg-[#0F294A] hover:bg-[#091B33] rounded-lg transition-colors whitespace-nowrap"
                          >
                            Lihat Tamu
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 3-Column Compact Metric Strip for Selected Recap Period */}
                    <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
                      <div className="rounded-xl bg-gradient-to-br from-[#007BFF] to-[#0056CC] text-white p-3 sm:p-4 shadow-sm">
                        <p className="text-[11px] sm:text-xs font-semibold text-white/90">
                          Jumlah Tamu
                        </p>
                        <p className="mt-1 text-2xl sm:text-3xl font-bold tabular-nums leading-none">
                          {activeRecapItem.total}
                        </p>
                      </div>
                      <div className="rounded-xl bg-gradient-to-br from-[#EA580C] to-[#C2410C] text-white p-3 sm:p-4 shadow-sm">
                        <p className="text-[11px] sm:text-xs font-semibold text-white/90">
                          Berkunjung
                        </p>
                        <p className="mt-1 text-2xl sm:text-3xl font-bold tabular-nums leading-none">
                          {activeRecapItem.active}
                        </p>
                      </div>
                      <div className="rounded-xl bg-gradient-to-br from-[#28A745] to-[#1E7E34] text-white p-3 sm:p-4 shadow-sm">
                        <p className="text-[11px] sm:text-xs font-semibold text-white/90">
                          Selesai
                        </p>
                        <p className="mt-1 text-2xl sm:text-3xl font-bold tabular-nums leading-none">
                          {activeRecapItem.done}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Single Compact Tabbed Breakdown Card (Bidang / Kategori) */}
                <div className="bg-[#F8FAFC] border border-white/25 rounded-2xl overflow-hidden shadow-xl">
                  <div className="px-5 py-3.5 bg-white border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <h3 className="text-sm sm:text-base font-bold text-[#0F294A]">
                        Rincian Kunjungan — {activeRecapItem.label}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {visits.length} kunjungan tercatat pada periode pilihan
                      </p>
                    </div>
                    <div className="inline-flex p-1 bg-slate-100 rounded-xl self-start">
                      <button
                        type="button"
                        onClick={() => setBreakdownTab('department')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                          breakdownTab === 'department'
                            ? 'bg-[#0F294A] text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Per Bidang Tujuan
                      </button>
                      <button
                        type="button"
                        onClick={() => setBreakdownTab('category')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                          breakdownTab === 'category'
                            ? 'bg-[#EA580C] text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Per Kategori Tamu
                      </button>
                    </div>
                  </div>

                  <div className="p-4 sm:p-5 bg-white space-y-3">
                    {breakdownItems.length === 0 ? (
                      <p className="text-sm text-slate-500 py-4 text-center">
                        Belum ada data kunjungan pada periode {activeRecapItem.label.toLowerCase()}.
                      </p>
                    ) : (
                      breakdownItems.map((item) => {
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
                                className={`h-full rounded-full ${
                                  breakdownTab === 'department' ? 'bg-[#007BFF]' : 'bg-[#EA580C]'
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </section>
            );
          })()
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
            {/* Toolbar & Filters — Focused on Tamu Hari Ini */}
            <div className="p-4 sm:p-6 border-b border-slate-200 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-slate-200/80">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-[#0F294A]">
                    {quickPreset === 'today'
                      ? `Daftar Tamu Hari Ini (${formatShortDate(getTodayWib())})`
                      : `Daftar Tamu — ${
                          stats.periodRecap?.find((p) => p.key === quickPreset)?.label || 'Periode Pilihan'
                        }`}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {quickPreset === 'today'
                      ? 'Menampilkan seluruh tamu yang berkunjung pada hari ini.'
                      : 'Menampilkan daftar kunjungan sesuai item rekapan yang dipilih.'}
                  </p>
                </div>

                {quickPreset !== 'today' && (
                  <button
                    type="button"
                    onClick={() => applyQuickPreset('today', true)}
                    className="self-start sm:self-auto px-3 py-1.5 text-xs font-semibold text-white bg-[#0F294A] hover:bg-[#091B33] rounded-lg transition-colors whitespace-nowrap"
                  >
                    Kembali ke Tamu Hari Ini
                  </button>
                )}
              </div>

              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
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
                <div className="flex flex-wrap items-center gap-2">
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
                        className="inline-flex items-center gap-2 px-3.5 py-2 min-h-[42px] text-xs sm:text-sm font-semibold text-[#0F294A] bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-60 rounded-xl transition-colors whitespace-nowrap shrink-0"
                      >
                        <FileSpreadsheet className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>{exportingCsv ? 'Mengunduh...' : 'Export CSV'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={printingPdf}
                        onClick={handlePrintReport}
                        className="inline-flex items-center gap-2 px-3.5 py-2 min-h-[42px] text-xs sm:text-sm font-semibold text-white bg-[#EA580C] hover:bg-[#C2410C] disabled:opacity-60 rounded-xl transition-colors whitespace-nowrap shrink-0"
                      >
                        <Printer className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>{printingPdf ? 'Menyiapkan PDF...' : 'Cetak PDF'}</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Compact Department & Status Filters */}
              <div className="flex flex-wrap items-center gap-2.5">
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
