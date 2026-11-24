import { useCallback, useEffect, useState } from 'react';
import { Building2, Clock, FileCheck2, MapPin, PhoneCall, Send, UserCheck } from 'lucide-react';
import {
  DEPARTMENTS,
  VISITOR_CATEGORIES,
  type Department,
  type DepartmentRecord,
  type VisitRecord,
  type VisitorCategory,
} from '../types';
import { BpbdEmblem, SidoarjoLogo } from './BpbdEmblem';
import { SignatureCanvas } from './SignatureCanvas';
import { VisitReceiptCard } from './VisitReceiptCard';

interface PublicGuestPageProps {
  activeReceipt: { visit: VisitRecord; checkoutToken: string } | null;
  onReceiptCreated: (visit: VisitRecord, checkoutToken: string) => void;
  onReceiptUpdated: (visit: VisitRecord) => void;
  onClearReceipt: () => void;
}

interface FormErrors {
  fullName?: string;
  phone?: string;
  institutionAddress?: string;
  purpose?: string;
  signatureData?: string;
}

export function PublicGuestPage({
  activeReceipt,
  onReceiptCreated,
  onReceiptUpdated,
  onClearReceipt,
}: PublicGuestPageProps) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [visitorCategory, setVisitorCategory] = useState<VisitorCategory>('Masyarakat Umum');
  const [institutionAddress, setInstitutionAddress] = useState('');
  const [availableDepartments, setAvailableDepartments] = useState<string[]>([...DEPARTMENTS]);
  const [department, setDepartment] = useState<Department>('Sekretariat');
  const [purpose, setPurpose] = useState('');
  const [signatureData, setSignatureData] = useState('');
  const [resetSignal, setResetSignal] = useState(0);

  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/departments')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { departments?: DepartmentRecord[] } | null) => {
        if (!active || !data?.departments?.length) return;
        const names = data.departments.map((d) => d.name);
        setAvailableDepartments(names);
        setDepartment((prev) => (names.includes(prev) ? prev : names[0]));
      })
      .catch(() => {
        // fallback to default DEPARTMENTS list
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSignatureChange = useCallback((dataUrl: string) => {
    setSignatureData(dataUrl);
    if (dataUrl) {
      setErrors((prev) => ({ ...prev, signatureData: undefined }));
    }
  }, []);

  const validate = (): boolean => {
    const next: FormErrors = {};
    if (fullName.trim().length < 2) {
      next.fullName = 'Nama lengkap wajib diisi (minimal 2 karakter).';
    }
    if (!/^[0-9+\-\s()]{8,24}$/.test(phone.trim())) {
      next.phone = 'Masukkan nomor HP/WhatsApp yang valid (minimal 8 digit).';
    }
    if (institutionAddress.trim().length < 2) {
      next.institutionAddress = 'Nama instansi atau alamat wajib diisi.';
    }
    if (purpose.trim().length < 3) {
      next.purpose = 'Keperluan kunjungan wajib diisi.';
    }
    if (!signatureData.startsWith('data:image/png;base64,')) {
      next.signatureData = 'Silakan bubuhkan tanda tangan digital Anda terlebih dahulu.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');
    if (!validate()) return;

    setSubmitting(true);
    try {
      const response = await fetch('/api/visits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phone.trim(),
          visitorCategory,
          institutionAddress: institutionAddress.trim(),
          department,
          purpose: purpose.trim(),
          signatureData,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setSubmitError(data.error || 'Terjadi kesalahan saat menyimpan data kunjungan.');
        return;
      }

      setFullName('');
      setPhone('');
      setVisitorCategory('Masyarakat Umum');
      setInstitutionAddress('');
      setDepartment('Sekretariat');
      setPurpose('');
      setSignatureData('');
      setResetSignal((s) => s + 1);
      setErrors({});

      onReceiptCreated(data.visit, data.checkoutToken);
    } catch {
      setSubmitError('Gagal terhubung ke server. Periksa koneksi jaringan Anda.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-9">
      {/* Institutional Dual-Logo Header Banner */}
      <section className="no-print mb-8 rounded-2xl overflow-hidden shadow-xl border border-white/15 bg-gradient-to-r from-[#091D38] via-[#133663] to-[#091D38] text-white">
        <div
          className="px-5 py-6 sm:px-8 sm:py-8"
          style={{
            backgroundImage:
              'radial-gradient(circle at 18% 20%, rgba(56,189,248,0.12) 0%, transparent 45%), radial-gradient(circle at 84% 75%, rgba(234,88,12,0.22) 0%, transparent 45%)',
          }}
        >
          <div className="flex flex-col sm:flex-row items-center justify-between gap-5 sm:gap-6">
            <div className="flex items-center justify-center gap-6 sm:contents">
              {/* Left: Logo Kabupaten Sidoarjo (Transparent PNG) */}
              <div className="sm:order-1 flex flex-col items-center shrink-0">
                <SidoarjoLogo className="w-16 h-16 sm:w-20 sm:h-20" />
              </div>

              {/* Right: Logo BPBD Kabupaten Sidoarjo */}
              <div className="sm:order-3 flex flex-col items-center shrink-0">
                <BpbdEmblem className="w-16 h-16 sm:w-20 sm:h-20" />
              </div>
            </div>

            {/* Center Title Block */}
            <div className="sm:order-2 flex-1 text-center space-y-1.5">
              <p className="text-xs sm:text-sm font-semibold text-[#FDBA74] tracking-wide">
                PEMERINTAH KABUPATEN SIDOARJO · BADAN PENANGGULANGAN BENCANA DAERAH
              </p>
              <h1 className="font-display text-xl sm:text-2xl lg:text-[1.8rem] font-extrabold tracking-tight text-white [text-wrap:balance]">
                BUKU TAMU DIGITAL - BPBD KABUPATEN SIDOARJO
              </h1>
              <p className="text-sm sm:text-base text-slate-200 font-normal">
                Silakan lengkapi data kunjungan Anda
              </p>
            </div>
          </div>
        </div>
        <div className="h-1.5 bg-gradient-to-r from-[#EA580C] via-[#F97316] to-[#EA580C]" aria-hidden="true" />
      </section>

      {activeReceipt ? (
        <VisitReceiptCard
          visit={activeReceipt.visit}
          checkoutToken={activeReceipt.checkoutToken}
          onCheckedOut={onReceiptUpdated}
          onStartNewVisit={onClearReceipt}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
          {/* Primary Form Container (8 cols on desktop) */}
          <form
            onSubmit={handleSubmit}
            noValidate
            className="lg:col-span-8 bg-[#F4F7FC] border border-white/25 rounded-2xl shadow-xl overflow-hidden"
          >
            {/* Form Top Strip */}
            <div className="px-6 py-5 sm:px-8 bg-gradient-to-r from-[#0F294A] to-[#1A4275] text-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-bold text-white">
                  Formulir Registrasi Tamu
                </h2>
                <p className="text-xs sm:text-sm text-slate-200 mt-0.5">
                  Kolom bertanda <span className="text-[#FB923C] font-semibold">*</span> wajib
                  dilengkapi sebelum mengirim data.
                </p>
              </div>
              <span className="text-xs text-[#FDBA74] font-mono tabular-nums">
                Waktu Tercatat Otomatis · WIB
              </span>
            </div>

            <div className="p-6 sm:p-8 space-y-7">
              {submitError && (
                <div
                  role="alert"
                  className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700"
                >
                  {submitError}
                </div>
              )}

              {/* Section 01: Identitas Pengunjung */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 space-y-5 shadow-xs">
                <div className="flex items-baseline justify-between border-b border-slate-100 pb-3">
                  <h3 className="font-display text-sm font-bold text-[#0F294A]">
                    01. Identitas Pengunjung
                  </h3>
                  <span className="text-xs font-medium text-[#EA580C]">Data Diri & Instansi</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Nama Lengkap */}
                  <div>
                    <label
                      htmlFor="fullName"
                      className="block text-sm font-semibold text-slate-800 mb-1.5"
                    >
                      Nama Lengkap <span className="text-[#EA580C]">*</span>
                    </label>
                    <input
                      id="fullName"
                      type="text"
                      required
                      maxLength={120}
                      value={fullName}
                      onChange={(e) => {
                        setFullName(e.target.value);
                        if (errors.fullName) setErrors((p) => ({ ...p, fullName: undefined }));
                      }}
                      placeholder="Contoh: Budi Santoso"
                      className={`w-full min-h-[46px] px-3.5 py-2.5 text-sm rounded-xl border bg-slate-50/70 text-slate-900 placeholder:text-slate-400 transition-colors focus:bg-white focus:outline-none focus:ring-2 ${
                        errors.fullName
                          ? 'border-red-500 focus:ring-red-200'
                          : 'border-slate-300 focus:border-[#0F294A] focus:ring-[#EA580C]/25'
                      }`}
                    />
                    {errors.fullName && (
                      <p className="mt-1.5 text-xs text-red-600">{errors.fullName}</p>
                    )}
                  </div>

                  {/* Nomor HP/WhatsApp */}
                  <div>
                    <label
                      htmlFor="phone"
                      className="block text-sm font-semibold text-slate-800 mb-1.5"
                    >
                      Nomor HP / WhatsApp <span className="text-[#EA580C]">*</span>
                    </label>
                    <input
                      id="phone"
                      type="tel"
                      inputMode="tel"
                      required
                      maxLength={24}
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        if (errors.phone) setErrors((p) => ({ ...p, phone: undefined }));
                      }}
                      placeholder="Contoh: 081234567890"
                      className={`w-full min-h-[46px] px-3.5 py-2.5 text-sm font-mono tabular-nums rounded-xl border bg-slate-50/70 text-slate-900 placeholder:text-slate-400 transition-colors focus:bg-white focus:outline-none focus:ring-2 ${
                        errors.phone
                          ? 'border-red-500 focus:ring-red-200'
                          : 'border-slate-300 focus:border-[#0F294A] focus:ring-[#EA580C]/25'
                      }`}
                    />
                    {errors.phone && <p className="mt-1.5 text-xs text-red-600">{errors.phone}</p>}
                  </div>

                  {/* Kategori Pengunjung */}
                  <div className="md:col-span-2">
                    <span className="block text-sm font-semibold text-slate-800 mb-2">
                      Kategori Pengunjung <span className="text-[#EA580C]">*</span>
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
                      {VISITOR_CATEGORIES.map((category) => {
                        const isActive = visitorCategory === category;
                        return (
                          <button
                            key={category}
                            type="button"
                            onClick={() => setVisitorCategory(category)}
                            className={`px-3 py-2.5 min-h-[52px] rounded-xl text-xs font-semibold border flex items-center justify-center text-center leading-snug transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA580C] ${
                              isActive
                                ? 'bg-[#0F294A] text-white border-[#0F294A] shadow-xs ring-2 ring-[#EA580C]/40'
                                : 'bg-blue-50/50 text-slate-700 border-slate-200 hover:bg-blue-50 hover:border-[#0F294A]/40'
                            }`}
                          >
                            {category}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Nama Instansi / Alamat */}
                  <div className="md:col-span-2">
                    <label
                      htmlFor="institutionAddress"
                      className="block text-sm font-semibold text-slate-800 mb-1.5"
                    >
                      Nama Instansi / Alamat <span className="text-[#EA580C]">*</span>
                    </label>
                    <input
                      id="institutionAddress"
                      type="text"
                      required
                      maxLength={200}
                      value={institutionAddress}
                      onChange={(e) => {
                        setInstitutionAddress(e.target.value);
                        if (errors.institutionAddress) {
                          setErrors((p) => ({ ...p, institutionAddress: undefined }));
                        }
                      }}
                      placeholder="Contoh: Dinas Kominfo Kab. Sidoarjo / Jl. Pahlawan No. 1 Sidoarjo"
                      className={`w-full min-h-[46px] px-3.5 py-2.5 text-sm rounded-xl border bg-slate-50/70 text-slate-900 placeholder:text-slate-400 transition-colors focus:bg-white focus:outline-none focus:ring-2 ${
                        errors.institutionAddress
                          ? 'border-red-500 focus:ring-red-200'
                          : 'border-slate-300 focus:border-[#0F294A] focus:ring-[#EA580C]/25'
                      }`}
                    />
                    {errors.institutionAddress && (
                      <p className="mt-1.5 text-xs text-red-600">{errors.institutionAddress}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Section 02: Bidang Tujuan & Keperluan */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 space-y-5 shadow-xs">
                <div className="flex items-baseline justify-between border-b border-slate-100 pb-3">
                  <h3 className="font-display text-sm font-bold text-[#0F294A]">
                    02. Bidang Tujuan & Keperluan Kunjungan
                  </h3>
                  <span className="text-xs font-medium text-[#EA580C]">Unit Layanan Tujuan</span>
                </div>

                <div className="space-y-5">
                  {/* Bidang Tujuan */}
                  <div>
                    <label
                      htmlFor="department"
                      className="block text-sm font-semibold text-slate-800 mb-1.5"
                    >
                      Bidang Tujuan <span className="text-[#EA580C]">*</span>
                    </label>
                    <select
                      id="department"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value as Department)}
                      className="w-full min-h-[46px] px-3.5 py-2.5 text-sm font-medium rounded-xl border border-slate-300 bg-slate-50/70 text-slate-900 transition-colors focus:bg-white focus:outline-none focus:border-[#0F294A] focus:ring-2 focus:ring-[#EA580C]/25"
                    >
                      {availableDepartments.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Keperluan Kunjungan */}
                  <div>
                    <label
                      htmlFor="purpose"
                      className="block text-sm font-semibold text-slate-800 mb-1.5"
                    >
                      Keperluan Kunjungan <span className="text-[#EA580C]">*</span>
                    </label>
                    <textarea
                      id="purpose"
                      rows={3}
                      required
                      maxLength={500}
                      value={purpose}
                      onChange={(e) => {
                        setPurpose(e.target.value);
                        if (errors.purpose) setErrors((p) => ({ ...p, purpose: undefined }));
                      }}
                      placeholder="Jelaskan secara singkat maksud dan tujuan kunjungan Anda..."
                      className={`w-full px-3.5 py-2.5 text-sm rounded-xl border bg-slate-50/70 text-slate-900 placeholder:text-slate-400 transition-colors focus:bg-white focus:outline-none focus:ring-2 ${
                        errors.purpose
                          ? 'border-red-500 focus:ring-red-200'
                          : 'border-slate-300 focus:border-[#0F294A] focus:ring-[#EA580C]/25'
                      }`}
                    />
                    {errors.purpose && (
                      <p className="mt-1.5 text-xs text-red-600">{errors.purpose}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Section 03: Tanda Tangan Digital */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 space-y-4 shadow-xs">
                <div className="flex items-baseline justify-between border-b border-slate-100 pb-3">
                  <h3 className="font-display text-sm font-bold text-[#0F294A]">
                    03. Tanda Tangan Digital <span className="text-[#EA580C]">*</span>
                  </h3>
                  <span className="text-xs font-medium text-[#EA580C]">Verifikasi Pengunjung</span>
                </div>

                <SignatureCanvas
                  onSignatureChange={handleSignatureChange}
                  hasError={Boolean(errors.signatureData)}
                  resetSignal={resetSignal}
                />
                {errors.signatureData && (
                  <p className="mt-1.5 text-xs text-red-600">{errors.signatureData}</p>
                )}
              </div>

              {/* Submit Action Bar */}
              <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Setelah dikirim, Anda akan memperoleh nomor urut kunjungan dan tombol Check-Out.
                </p>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center justify-center gap-2.5 px-6 py-3 min-h-[48px] text-sm font-semibold text-white bg-gradient-to-r from-[#EA580C] to-[#C2410C] hover:from-[#C2410C] hover:to-[#9A3412] disabled:opacity-60 rounded-xl shadow-md transition-all whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F294A]"
                >
                  <Send className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>
                    {submitting ? 'Menyimpan Registrasi...' : 'Kirim & Dapatkan Nomor Urut'}
                  </span>
                </button>
              </div>
            </div>
          </form>

          {/* Right Column: Institutional Guidance & Service Info (4 cols on desktop) */}
          <aside className="lg:col-span-4 space-y-5">
            <div className="bg-[#F4F7FC] border border-white/25 rounded-2xl overflow-hidden shadow-xl">
              <div className="px-6 py-4 bg-gradient-to-r from-[#0F294A] to-[#1A4275] text-white">
                <h2 className="font-display text-base font-bold text-white">
                  Alur Kunjungan Tamu
                </h2>
                <p className="text-xs text-slate-200 mt-0.5">
                  Tata cara layanan tamu kantor BPBD Kabupaten Sidoarjo
                </p>
              </div>

              <ol className="p-6 space-y-4 text-sm">
                <li className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#0F294A] text-white font-mono tabular-nums text-xs font-bold flex items-center justify-center shrink-0">
                    01
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Lengkapi Data & TTD</p>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                      Isi identitas, pilih bidang tujuan, tuliskan keperluan, dan bubuhkan tanda
                      tangan digital.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#0F294A] text-white font-mono tabular-nums text-xs font-bold flex items-center justify-center shrink-0">
                    02
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Dapatkan Nomor Urut</p>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                      Tunjukkan kartu bukti registrasi kepada petugas resepsionis sebelum menuju
                      ruang bidang.
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#EA580C] text-white font-mono tabular-nums text-xs font-bold flex items-center justify-center shrink-0">
                    03
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Tekan Selesai Kunjungan</p>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                      Saat kunjungan berakhir, klik tombol Check-Out pada kartu bukti untuk mencatat
                      jam keluar.
                    </p>
                  </div>
                </li>
              </ol>
            </div>

            <div className="bg-[#F4F7FC] border border-white/25 rounded-2xl p-6 shadow-xl space-y-4">
              <h2 className="font-display text-base font-bold text-[#0F294A] pb-2.5 border-b border-slate-200">
                Informasi Layanan Kantor
              </h2>

              <div className="space-y-3 text-xs sm:text-sm text-slate-700">
                <div className="flex items-start gap-3">
                  <Clock className="w-4 h-4 text-[#EA580C] mt-0.5 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-slate-900">Jam Pelayanan Administrasi</p>
                    <p className="text-xs text-slate-600 font-mono tabular-nums">
                      Senin – Jumat · 08.00 – 16.00 WIB
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <PhoneCall className="w-4 h-4 text-[#EA580C] mt-0.5 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-slate-900">Pusdalops-PB Siaga</p>
                    <p className="text-xs text-slate-600">
                      Siaga Kebencanaan 24 Jam Non-Stop
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Building2 className="w-4 h-4 text-[#0F294A] mt-0.5 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-slate-900">Unit Kerja BPBD</p>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Kepala Pelaksana, Sekretariat, Pencegahan & Kesiapsiagaan, Kedaruratan &
                      Logistik, Rehabilitasi & Rekonstruksi.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 pt-2.5 border-t border-slate-200">
                  <MapPin className="w-4 h-4 text-[#0F294A] mt-0.5 shrink-0" aria-hidden="true" />
                  <p className="text-xs text-slate-600">
                    BPBD Kabupaten Sidoarjo · Pemerintah Kabupaten Sidoarjo, Jawa Timur
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-gradient-to-br from-[#EA580C] to-[#C2410C] text-white p-5 space-y-2 shadow-xl border border-white/15">
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <UserCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Layanan Publik Transparan</span>
              </div>
              <p className="text-xs text-orange-50 leading-relaxed">
                Seluruh pencatatan tamu terintegrasi secara digital untuk mempercepat koordinasi
                dan pelayanan masyarakat di lingkungan BPBD Kabupaten Sidoarjo.
              </p>
              <div className="pt-1 flex items-center gap-2 text-[11px] text-orange-100">
                <FileCheck2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Privasi data kunjungan terjaga</span>
              </div>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
