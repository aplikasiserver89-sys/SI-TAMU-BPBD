import { useState } from 'react';
import { CheckCircle2, Clock, Printer, RotateCcw } from 'lucide-react';
import type { VisitRecord } from '../types';
import { formatIndonesianDate, formatWibTime } from '../lib/format';
import { downloadVisitReceiptPdf } from '../lib/pdfGenerator';
import { BpbdEmblem, SidoarjoLogo } from './BpbdEmblem';

interface VisitReceiptCardProps {
  visit: VisitRecord;
  checkoutToken: string;
  onCheckedOut: (updatedVisit: VisitRecord) => void;
  onStartNewVisit: () => void;
}

export function VisitReceiptCard({
  visit,
  checkoutToken,
  onCheckedOut,
  onStartNewVisit,
}: VisitReceiptCardProps) {
  const [submitting, setSubmitting] = useState(false);
  const [printingPdf, setPrintingPdf] = useState(false);
  const [printNotice, setPrintNotice] = useState('');
  const [error, setError] = useState('');

  const isCompleted = visit.status === 'Selesai';

  const handleDownloadReceiptPdf = async () => {
    setError('');
    setPrintNotice('');
    setPrintingPdf(true);
    try {
      await downloadVisitReceiptPdf(visit);
      setPrintNotice(`Bukti kunjungan ${visit.queueCode} berhasil diunduh dalam format PDF.`);
    } catch {
      setError('Gagal membuat file PDF bukti kunjungan.');
    } finally {
      setPrintingPdf(false);
    }
  };

  const handleCheckOut = async () => {
    setError('');
    setSubmitting(true);
    try {
      const response = await fetch(`/api/visits/${encodeURIComponent(visit.id)}/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Checkout-Token': checkoutToken,
        },
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Gagal memproses check-out.');
        return;
      }
      onCheckedOut(data.visit);
    } catch {
      setError('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        {/* Header Navy Banner with Dual Logos */}
        <div className="bg-[#0F294A] text-white px-6 py-6 sm:px-8 border-b-4 border-[#EA580C]">
          <div className="flex items-center justify-between gap-4 mb-4">
            <SidoarjoLogo className="w-12 h-12" />
            <div className="text-center flex-1">
              <p className="text-[11px] font-medium text-slate-300 tracking-wide">
                PEMERINTAH KABUPATEN SIDOARJO
              </p>
              <h2 className="font-display text-base sm:text-lg font-bold text-white">
                KARTU BUKTI REGISTRASI KUNJUNGAN
              </h2>
              <p className="text-xs text-slate-300">BPBD Kabupaten Sidoarjo</p>
            </div>
            <BpbdEmblem className="w-12 h-12" />
          </div>

          <div className="pt-4 border-t border-white/15 flex items-center justify-between gap-4">
            <span className="text-xs font-medium text-slate-300">
              Nomor Urut Kunjungan Hari Ini
            </span>
            <span className="font-mono tabular-nums text-3xl sm:text-4xl font-extrabold tracking-tight text-[#FB923C]">
              {visit.queueCode}
            </span>
          </div>
        </div>

        {/* Status & Timestamp Bar */}
        <div className="px-6 py-4 sm:px-8 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {isCompleted ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
                <span className="text-emerald-800">Status: Selesai Kunjungan</span>
              </>
            ) : (
              <>
                <Clock className="w-4 h-4 text-[#EA580C] shrink-0" aria-hidden="true" />
                <span className="text-[#0F294A]">Status: Sedang Berkunjung</span>
              </>
            )}
          </div>

          <div className="text-xs sm:text-sm text-slate-600 font-mono tabular-nums">
            <span>{formatIndonesianDate(visit.visitDate)}</span>
            <span className="mx-2 text-slate-300" aria-hidden="true">
              ·
            </span>
            <span>Masuk {formatWibTime(visit.checkInAt)}</span>
            {visit.checkOutAt && (
              <>
                <span className="mx-2 text-slate-300" aria-hidden="true">
                  ·
                </span>
                <span>Keluar {formatWibTime(visit.checkOutAt)}</span>
              </>
            )}
          </div>
        </div>

        {/* Details Body */}
        <div className="px-6 py-6 sm:px-8 space-y-5">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
            <div className="border-b border-slate-100 pb-3">
              <dt className="text-xs font-medium text-slate-500">Nama Lengkap</dt>
              <dd className="mt-1 font-semibold text-slate-900">{visit.fullName}</dd>
            </div>

            <div className="border-b border-slate-100 pb-3">
              <dt className="text-xs font-medium text-slate-500">Nomor HP / WhatsApp</dt>
              <dd className="mt-1 font-mono tabular-nums font-medium text-slate-900">
                {visit.phone}
              </dd>
            </div>

            <div className="border-b border-slate-100 pb-3">
              <dt className="text-xs font-medium text-slate-500">Kategori Pengunjung</dt>
              <dd className="mt-1 text-slate-900">{visit.visitorCategory}</dd>
            </div>

            <div className="border-b border-slate-100 pb-3">
              <dt className="text-xs font-medium text-slate-500">Bidang Tujuan</dt>
              <dd className="mt-1 font-semibold text-[#0F294A]">{visit.department}</dd>
            </div>

            <div className="sm:col-span-2 border-b border-slate-100 pb-3">
              <dt className="text-xs font-medium text-slate-500">Nama Instansi / Alamat</dt>
              <dd className="mt-1 text-slate-900">{visit.institutionAddress}</dd>
            </div>

            <div className="sm:col-span-2 border-b border-slate-100 pb-3">
              <dt className="text-xs font-medium text-slate-500">Keperluan Kunjungan</dt>
              <dd className="mt-1 text-slate-800 leading-relaxed">{visit.purpose}</dd>
            </div>
          </dl>

          {/* Digital Signature Preview */}
          <div>
            <p className="text-xs font-medium text-slate-500 mb-2">Tanda Tangan Digital</p>
            <div className="border border-slate-200 rounded-xl bg-slate-50/50 p-3 flex items-center justify-center">
              <img
                src={visit.signatureData}
                alt={`Tanda tangan ${visit.fullName}`}
                referrerPolicy="no-referrer"
                className="max-h-24 w-auto object-contain"
              />
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          {printNotice && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
              {printNotice}
            </div>
          )}

          {/* Submission Confirmation & New Form Button Banner */}
          <div className="no-print p-4 rounded-xl bg-blue-50 border border-blue-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-xs sm:text-sm text-[#0F294A]">
              <p className="font-bold">
                {isCompleted
                  ? 'Kunjungan Anda telah selesai tercatat.'
                  : 'Data kunjungan Anda berhasil terkirim!'}
              </p>
              <p className="text-slate-600 mt-0.5">
                Ingin mencatat kunjungan tamu berikutnya? Tekan tombol pengisian form lagi.
              </p>
            </div>
            <button
              type="button"
              onClick={onStartNewVisit}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[40px] text-xs sm:text-sm font-bold text-white bg-[#0F294A] hover:bg-[#091B33] rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Isi Form Kunjungan Lagi</span>
            </button>
          </div>

          {/* Action Buttons */}
          <div className="no-print pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {!isCompleted ? (
              <button
                type="button"
                disabled={submitting}
                onClick={handleCheckOut}
                className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[46px] text-sm font-semibold text-white bg-[#EA580C] hover:bg-[#C2410C] disabled:opacity-60 rounded-xl transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F294A]"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  {submitting ? 'Memproses Check-Out...' : 'Selesai Kunjungan (Check-Out)'}
                </span>
              </button>
            ) : (
              <div className="flex-1 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm font-medium text-emerald-800 text-center">
                Kunjungan selesai tercatat pada {formatWibTime(visit.checkOutAt)}
              </div>
            )}

            <button
              type="button"
              disabled={printingPdf}
              onClick={handleDownloadReceiptPdf}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 min-h-[46px] text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-xl transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA580C]"
            >
              <Printer className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{printingPdf ? 'Menyiapkan PDF...' : 'Cetak Bukti (PDF)'}</span>
            </button>

            <button
              type="button"
              onClick={onStartNewVisit}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 min-h-[46px] text-sm font-bold text-white bg-[#0F294A] hover:bg-[#091B33] rounded-xl transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA580C]"
            >
              <RotateCcw className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Isi Form Kunjungan Lagi</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
