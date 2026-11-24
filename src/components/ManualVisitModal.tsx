import { useCallback, useState } from 'react';
import { Send, UserPlus, X } from 'lucide-react';
import { VISITOR_CATEGORIES, type VisitorCategory } from '../types';
import { ApiError, createManualVisit } from '../lib/api';
import { SignatureCanvas } from './SignatureCanvas';

interface ManualVisitModalProps {
  token: string;
  departments: string[];
  onClose: () => void;
  onCreated: () => void;
  onSessionExpired: () => void;
}

export function ManualVisitModal({
  token,
  departments,
  onClose,
  onCreated,
  onSessionExpired,
}: ManualVisitModalProps) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [visitorCategory, setVisitorCategory] = useState<VisitorCategory>('Masyarakat Umum');
  const [institutionAddress, setInstitutionAddress] = useState('');
  const [department, setDepartment] = useState(departments[0] || 'Sekretariat');
  const [purpose, setPurpose] = useState('');
  const [signatureData, setSignatureData] = useState('');
  const [resetSignal, setResetSignal] = useState(0);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSignatureChange = useCallback((dataUrl: string) => {
    setSignatureData(dataUrl);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (fullName.trim().length < 2) {
      setError('Nama lengkap wajib diisi.');
      return;
    }
    if (!/^[0-9+\-\s()]{8,24}$/.test(phone.trim())) {
      setError('Nomor HP/WhatsApp wajib diisi dengan format yang benar.');
      return;
    }
    if (institutionAddress.trim().length < 2) {
      setError('Nama instansi/alamat wajib diisi.');
      return;
    }
    if (purpose.trim().length < 3) {
      setError('Keperluan kunjungan wajib diisi.');
      return;
    }
    if (!signatureData.startsWith('data:image/png;base64,')) {
      setError('Tanda tangan digital tamu wajib dibubuhkan.');
      return;
    }

    setSubmitting(true);
    try {
      await createManualVisit(token, {
        fullName: fullName.trim(),
        phone: phone.trim(),
        visitorCategory,
        institutionAddress: institutionAddress.trim(),
        department,
        purpose: purpose.trim(),
        signatureData,
      });
      setResetSignal((s) => s + 1);
      onCreated();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired();
        return;
      }
      setError(err instanceof Error ? err.message : 'Gagal menyimpan input manual tamu.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-visit-title"
      className="no-print fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl my-6">
        <div className="bg-[#0F294A] text-white px-6 py-4 border-b-4 border-[#EA580C] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <UserPlus className="w-5 h-5 text-[#FB923C]" aria-hidden="true" />
            <div>
              <h2 id="manual-visit-title" className="font-display text-base font-bold">
                Input Bantuan Petugas (Tamu Tanpa Ponsel / Lansia)
              </h2>
              <p className="text-xs text-slate-300">
                Catat kedatangan tamu secara langsung melalui meja resepsionis
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal"
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="m-fullname" className="block text-xs font-semibold text-slate-800 mb-1">
                Nama Lengkap *
              </label>
              <input
                id="m-fullname"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 text-sm rounded-xl border border-slate-300"
              />
            </div>

            <div>
              <label htmlFor="m-phone" className="block text-xs font-semibold text-slate-800 mb-1">
                Nomor HP / WhatsApp *
              </label>
              <input
                id="m-phone"
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 text-sm font-mono rounded-xl border border-slate-300"
              />
            </div>

            <div>
              <label htmlFor="m-category" className="block text-xs font-semibold text-slate-800 mb-1">
                Kategori Pengunjung *
              </label>
              <select
                id="m-category"
                value={visitorCategory}
                onChange={(e) => setVisitorCategory(e.target.value as VisitorCategory)}
                className="w-full min-h-[42px] px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white"
              >
                {VISITOR_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="m-dept" className="block text-xs font-semibold text-slate-800 mb-1">
                Bidang Tujuan *
              </label>
              <select
                id="m-dept"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white"
              >
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="m-inst" className="block text-xs font-semibold text-slate-800 mb-1">
                Nama Instansi / Alamat *
              </label>
              <input
                id="m-inst"
                type="text"
                required
                value={institutionAddress}
                onChange={(e) => setInstitutionAddress(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 text-sm rounded-xl border border-slate-300"
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="m-purpose" className="block text-xs font-semibold text-slate-800 mb-1">
                Keperluan Kunjungan *
              </label>
              <textarea
                id="m-purpose"
                rows={2}
                required
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300"
              />
            </div>

            <div className="sm:col-span-2">
              <span className="block text-xs font-semibold text-slate-800 mb-1">
                Tanda Tangan Digital *
              </span>
              <SignatureCanvas onSignatureChange={handleSignatureChange} resetSignal={resetSignal} />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-xs sm:text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs sm:text-sm font-semibold text-white bg-[#EA580C] hover:bg-[#C2410C] disabled:opacity-60 rounded-xl"
            >
              <Send className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{submitting ? 'Menyimpan...' : 'Simpan Kunjungan Tamu'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
