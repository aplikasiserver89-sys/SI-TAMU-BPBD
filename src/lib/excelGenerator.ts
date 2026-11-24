import * as XLSX from 'xlsx';
import type { DashboardStats, VisitRecord } from '../types';
import { formatIndonesianDate, formatShortDate, formatWibTime, getTodayWib } from './format';

function safeExcelText(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  return /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
}

function triggerExcelDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

interface ExportRecapExcelParams {
  visits: VisitRecord[];
  stats: DashboardStats;
  periodLabel: string;
  periodRangeLabel: string;
  departmentFilter: string;
}

export function downloadRecapExcel({
  visits,
  stats,
  periodLabel,
  periodRangeLabel,
  departmentFilter,
}: ExportRecapExcelParams): void {
  const wb = XLSX.utils.book_new();
  const todayWib = getTodayWib();

  // Sheet 1: Ringkasan Rekapitulasi (Periode, Bidang, Kategori)
  const summaryRows: (string | number)[][] = [
    ['PEMERINTAH KABUPATEN SIDOARJO'],
    ['BADAN PENANGGULANGAN BENCANA DAERAH (BPBD)'],
    ['REKAPITULASI LAPORAN BUKU TAMU DIGITAL (SI-TAMU BPBD)'],
    [],
    ['Periode Pilihan', safeExcelText(periodLabel)],
    ['Rentang Tanggal (WIB)', safeExcelText(periodRangeLabel || '-')],
    ['Filter Bidang Tujuan', safeExcelText(departmentFilter || 'Semua Bidang')],
    ['Tanggal Ekspor', formatIndonesianDate(todayWib)],
    ['Jumlah Kunjungan Periode Pilihan', visits.length],
    [],
    ['RINGKASAN PER PERIODE'],
    [
      'Periode Laporan',
      'Rentang Tanggal (WIB)',
      'Jumlah Tamu',
      'Sedang Berkunjung',
      'Selesai (Check-Out)',
    ],
  ];

  for (const row of stats.periodRecap || []) {
    summaryRows.push([
      safeExcelText(row.label),
      safeExcelText(row.rangeLabel),
      row.total,
      row.active,
      row.done,
    ]);
  }

  summaryRows.push([]);
  summaryRows.push([`RINCIAN PER BIDANG TUJUAN (${safeExcelText(periodLabel).toUpperCase()})`]);
  summaryRows.push(['Bidang Tujuan', 'Jumlah Kunjungan', 'Persentase (%)']);

  if (stats.departmentBreakdown.length === 0) {
    summaryRows.push(['Belum ada data kunjungan pada periode ini', 0, '0%']);
  } else {
    for (const item of stats.departmentBreakdown) {
      const pct = visits.length > 0 ? Math.round((item.total / visits.length) * 100) : 0;
      summaryRows.push([safeExcelText(item.name), item.total, `${pct}%`]);
    }
  }

  summaryRows.push([]);
  summaryRows.push([`RINCIAN PER KATEGORI TAMU (${safeExcelText(periodLabel).toUpperCase()})`]);
  summaryRows.push(['Kategori Pengunjung', 'Jumlah Kunjungan', 'Persentase (%)']);

  if (stats.categoryBreakdown.length === 0) {
    summaryRows.push(['Belum ada data kunjungan pada periode ini', 0, '0%']);
  } else {
    for (const item of stats.categoryBreakdown) {
      const pct = visits.length > 0 ? Math.round((item.total / visits.length) * 100) : 0;
      summaryRows.push([safeExcelText(item.name), item.total, `${pct}%`]);
    }
  }

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [
    { wch: 36 },
    { wch: 28 },
    { wch: 16 },
    { wch: 20 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Rekapitulasi');

  // Sheet 2: Daftar Lengkap Kunjungan Tamu sesuai filter/periode pilihan
  const visitHeader = [
    'No. Urut',
    'Tanggal Kunjungan',
    'Jam Masuk (WIB)',
    'Jam Keluar (WIB)',
    'Nama Lengkap',
    'Nomor HP / WhatsApp',
    'Kategori Pengunjung',
    'Instansi / Alamat',
    'Bidang Tujuan',
    'Keperluan Kunjungan',
    'Status',
  ];

  const visitRows: (string | number)[][] = [visitHeader];
  if (visits.length === 0) {
    visitRows.push([
      '-',
      '-',
      '-',
      '-',
      'Belum ada data kunjungan pada periode yang dipilih.',
      '-',
      '-',
      '-',
      '-',
      '-',
      '-',
    ]);
  } else {
    for (const v of visits) {
      visitRows.push([
        safeExcelText(v.queueCode),
        formatShortDate(v.visitDate),
        formatWibTime(v.checkInAt),
        v.checkOutAt ? formatWibTime(v.checkOutAt) : '-',
        safeExcelText(v.fullName),
        safeExcelText(v.phone),
        safeExcelText(v.visitorCategory),
        safeExcelText(v.institutionAddress),
        safeExcelText(v.department),
        safeExcelText(v.purpose),
        safeExcelText(v.status),
      ]);
    }
  }

  const wsVisits = XLSX.utils.aoa_to_sheet(visitRows);
  wsVisits['!cols'] = [
    { wch: 10 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
    { wch: 26 },
    { wch: 18 },
    { wch: 24 },
    { wch: 30 },
    { wch: 32 },
    { wch: 38 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, wsVisits, 'Daftar Tamu');

  const outBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const blob = new Blob([outBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerExcelDownload(blob, `rekap-laporan-bpbd-sidoarjo-${todayWib}.xlsx`);
}
