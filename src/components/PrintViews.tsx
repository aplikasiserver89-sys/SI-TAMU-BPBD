import type { DashboardStats, VisitRecord } from '../types';
import { formatIndonesianDate, formatShortDate, formatWibTime, getTodayWib } from '../lib/format';
import { BpbdEmblem, SidoarjoLogo } from './BpbdEmblem';

interface PrintReportProps {
  visits: VisitRecord[];
  stats: DashboardStats;
  dateFrom: string;
  dateTo: string;
  departmentFilter: string;
}

export function PrintReportView({
  visits,
  stats,
  dateFrom,
  dateTo,
  departmentFilter,
}: PrintReportProps) {
  const periodLabel =
    dateFrom && dateTo
      ? `${formatShortDate(dateFrom)} – ${formatShortDate(dateTo)}`
      : dateFrom
        ? `Mulai ${formatShortDate(dateFrom)}`
        : dateTo
          ? `Sampai ${formatShortDate(dateTo)}`
          : 'Semua Periode';

  return (
    <div className="print-only bg-white text-slate-900">
      {/* Kop Surat Resmi dengan Logo Kiri & Kanan */}
      <div className="flex items-center justify-between gap-4 pb-4 border-b-4 border-[#0F294A]">
        <SidoarjoLogo className="w-16 h-16" />
        <div className="flex-1 text-center">
          <p className="text-xs font-semibold tracking-wider text-slate-700">
            PEMERINTAH KABUPATEN SIDOARJO
          </p>
          <h1 className="font-display text-lg font-extrabold text-[#0F294A]">
            BADAN PENANGGULANGAN BENCANA DAERAH (BPBD)
          </h1>
          <p className="text-xs text-slate-600">
            Laporan Resmi Rekapitulasi Buku Tamu Digital (SI-TAMU BPBD)
          </p>
        </div>
        <BpbdEmblem className="w-16 h-16" />
      </div>

      {/* Filter & Summary Info */}
      <div className="my-4 flex flex-wrap justify-between gap-4 text-xs border-b border-slate-200 pb-3">
        <div>
          <p>
            <span className="font-semibold">Periode Data:</span> {periodLabel}
          </p>
          <p>
            <span className="font-semibold">Bidang Tujuan:</span>{' '}
            {departmentFilter || 'Semua Bidang'}
          </p>
        </div>
        <div className="text-right font-mono tabular-nums">
          <p>
            <span className="font-sans font-semibold">Dicetak:</span>{' '}
            {formatIndonesianDate(getTodayWib())}
          </p>
          <p>
            <span className="font-sans font-semibold">Jumlah Baris Filter:</span> {visits.length}{' '}
            tamu
          </p>
        </div>
      </div>

      {/* Ringkasan Rekapitulasi Periode */}
      {stats.periodRecap && stats.periodRecap.length > 0 && (
        <div className="mb-4 break-inside-avoid">
          <p className="text-[11px] font-bold text-[#0F294A] mb-1.5">
            REKAPITULASI KUNJUNGAN TAMU (HARI, MINGGU, BULAN, TAHUN INI, TAHUN LALU)
          </p>
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="bg-slate-100 text-[#0F294A]">
                {stats.periodRecap.map((item) => (
                  <th
                    key={item.key}
                    className="border border-slate-300 px-2 py-1 text-center font-bold"
                  >
                    {item.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {stats.periodRecap.map((item) => (
                  <td
                    key={item.key}
                    className="border border-slate-300 px-2 py-1.5 text-center font-bold text-xs tabular-nums"
                  >
                    {item.total} tamu
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Table */}
      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr className="bg-[#0F294A] text-white">
            <th className="border border-slate-300 px-2 py-1.5 text-left">No. Urut</th>
            <th className="border border-slate-300 px-2 py-1.5 text-left">Tanggal & Jam</th>
            <th className="border border-slate-300 px-2 py-1.5 text-left">Nama & Kontak</th>
            <th className="border border-slate-300 px-2 py-1.5 text-left">Kategori & Instansi</th>
            <th className="border border-slate-300 px-2 py-1.5 text-left">Bidang Tujuan</th>
            <th className="border border-slate-300 px-2 py-1.5 text-left">Keperluan</th>
            <th className="border border-slate-300 px-2 py-1.5 text-center">TTD</th>
            <th className="border border-slate-300 px-2 py-1.5 text-left">Status</th>
          </tr>
        </thead>
        <tbody>
          {visits.length === 0 ? (
            <tr>
              <td colSpan={8} className="border border-slate-300 px-3 py-6 text-center text-slate-500">
                Tidak ada data kunjungan pada filter yang dipilih.
              </td>
            </tr>
          ) : (
            visits.map((v) => (
              <tr key={v.id} className="break-inside-avoid">
                <td className="border border-slate-300 px-2 py-1.5 font-mono tabular-nums font-bold">
                  {v.queueCode}
                </td>
                <td className="border border-slate-300 px-2 py-1.5 font-mono tabular-nums">
                  <div>{formatShortDate(v.visitDate)}</div>
                  <div>Masuk: {formatWibTime(v.checkInAt)}</div>
                  {v.checkOutAt && <div>Keluar: {formatWibTime(v.checkOutAt)}</div>}
                </td>
                <td className="border border-slate-300 px-2 py-1.5">
                  <div className="font-semibold">{v.fullName}</div>
                  <div className="font-mono tabular-nums text-slate-600">{v.phone}</div>
                </td>
                <td className="border border-slate-300 px-2 py-1.5">
                  <div className="font-medium">{v.visitorCategory}</div>
                  <div className="text-slate-600">{v.institutionAddress}</div>
                </td>
                <td className="border border-slate-300 px-2 py-1.5 font-medium">{v.department}</td>
                <td className="border border-slate-300 px-2 py-1.5">{v.purpose}</td>
                <td className="border border-slate-300 px-1 py-1 text-center">
                  <img
                    src={v.signatureData}
                    alt={`TTD ${v.fullName}`}
                    className="h-8 w-16 object-contain mx-auto"
                  />
                </td>
                <td className="border border-slate-300 px-2 py-1.5 font-semibold">{v.status}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Official Sign-Off */}
      <div className="mt-10 flex justify-end break-inside-avoid">
        <div className="w-64 text-center text-xs space-y-14">
          <div>
            <p>Sidoarjo, {formatIndonesianDate(getTodayWib())}</p>
            <p className="font-semibold">Petugas Resepsionis / Sekretariat</p>
            <p>BPBD Kabupaten Sidoarjo</p>
          </div>
          <div className="border-t border-slate-400 pt-1 text-slate-600">
            ( ................................................. )
          </div>
        </div>
      </div>
    </div>
  );
}

interface PrintPosterProps {
  qrDataUrl: string;
  targetUrl: string;
  deskLabel: string;
}

export function PrintPosterView({ qrDataUrl, targetUrl, deskLabel }: PrintPosterProps) {
  return (
    <div className="print-only bg-white text-slate-900">
      <div className="border-2 border-[#0F294A] rounded-2xl overflow-hidden max-w-[660px] mx-auto">
        <div className="bg-[#0F294A] text-white p-8 border-b-8 border-[#EA580C] flex items-center justify-between gap-5">
          <SidoarjoLogo className="w-20 h-20" />
          <div className="text-center flex-1">
            <p className="text-sm font-medium text-slate-300">PEMERINTAH KABUPATEN SIDOARJO</p>
            <h1 className="font-display text-2xl font-extrabold">BPBD KABUPATEN SIDOARJO</h1>
            <p className="text-sm font-semibold text-[#FB923C] mt-0.5">
              SI-TAMU BPBD · SISTEM BUKU TAMU DIGITAL
            </p>
          </div>
          <BpbdEmblem className="w-20 h-20" />
        </div>

        <div className="px-10 py-10 text-center space-y-7">
          <div>
            <h2 className="font-display text-4xl font-extrabold text-[#0F294A]">SELAMAT DATANG</h2>
            <p className="mt-2 text-lg text-slate-700">
              Pindai QR Code di bawah ini untuk mengisi Buku Tamu Digital sebelum memasuki area
              layanan BPBD Kabupaten Sidoarjo
            </p>
          </div>

          <div className="mx-auto w-80 h-80 p-4 border-4 border-[#0F294A] rounded-3xl bg-slate-50 flex items-center justify-center">
            {qrDataUrl && (
              <img
                src={qrDataUrl}
                alt="QR Code Buku Tamu Digital"
                className="w-full h-full object-contain"
              />
            )}
          </div>

          <div className="text-left bg-slate-50 border border-slate-200 rounded-2xl p-6 space-y-2 text-base text-slate-800">
            <p className="font-bold text-[#0F294A] mb-2">LANGKAH PENGISIAN:</p>
            <p>1. Buka kamera ponsel atau aplikasi QR Scanner Anda.</p>
            <p>2. Arahkan ke QR Code dan buka tautan halaman Buku Tamu Digital.</p>
            <p>3. Lengkapi formulir kunjungan beserta tanda tangan digital.</p>
            <p>4. Simpan nomor urut kunjungan & tekan Check-Out saat selesai.</p>
          </div>
        </div>

        <div className="bg-[#0F294A] text-white px-8 py-5 text-center">
          <p className="text-base font-bold">{deskLabel}</p>
          <p className="text-xs font-mono text-slate-300 mt-1">{targetUrl}</p>
        </div>
      </div>
    </div>
  );
}
