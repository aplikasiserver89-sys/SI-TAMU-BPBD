import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download, Printer, QrCode } from 'lucide-react';
import { BPBD_EMBLEM_SRC, BpbdEmblem, SIDOARJO_LOGO_SRC, SidoarjoLogo } from './BpbdEmblem';

interface QrPosterStudioProps {
  onPrintPoster: (qrDataUrl: string, targetUrl: string, deskLabel: string) => Promise<void> | void;
}

export function QrPosterStudio({ onPrintPoster }: QrPosterStudioProps) {
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const publicSharedOrigin = currentOrigin.includes('//ais-dev-')
    ? currentOrigin.replace('//ais-dev-', '//ais-pre-')
    : currentOrigin;
  const defaultPublicUrl = publicSharedOrigin ? `${publicSharedOrigin}/?mode=tamu` : '';
  const currentPreviewUrl = currentOrigin ? `${currentOrigin}/?mode=tamu` : '';

  const [targetUrl, setTargetUrl] = useState(defaultPublicUrl);
  const [deskLabel, setDeskLabel] = useState('Meja Resepsionis Utama · Lobi Kantor');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [downloadingPoster, setDownloadingPoster] = useState(false);
  const [printingPosterPdf, setPrintingPosterPdf] = useState(false);
  const [posterNotice, setPosterNotice] = useState('');
  const [posterError, setPosterError] = useState('');

  useEffect(() => {
    let active = true;
    const urlToEncode = targetUrl.trim() || defaultPublicUrl;
    QRCode.toDataURL(urlToEncode, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 640,
      color: {
        dark: '#0F294A',
        light: '#FFFFFF',
      },
    })
      .then((dataUrl) => {
        if (active) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [targetUrl, defaultPublicUrl]);

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const handleDownloadQrOnly = async () => {
    if (!qrDataUrl) return;
    setPosterError('');
    setPosterNotice('');
    try {
      const response = await fetch(qrDataUrl);
      const blob = await response.blob();
      triggerBlobDownload(blob, 'qr-si-tamu-bpbd-sidoarjo.png');
      setPosterNotice('Gambar QR Code (PNG) berhasil diunduh.');
    } catch {
      setPosterError('Gagal mengunduh gambar QR Code.');
    }
  };

  const handleDownloadFullPosterPng = async () => {
    if (!qrDataUrl) return;
    setPosterError('');
    setPosterNotice('');
    setDownloadingPoster(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1240;
      canvas.height = 1754;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setPosterError('Browser tidak mendukung pembuatan kanvas gambar.');
        return;
      }

      // White background
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Top Navy Header
      ctx.fillStyle = '#0F294A';
      ctx.fillRect(0, 0, canvas.width, 310);

      // Orange accent divider
      ctx.fillStyle = '#EA580C';
      ctx.fillRect(0, 310, canvas.width, 16);

      const loadImg = (src: string, draw: (img: HTMLImageElement) => void) =>
        new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          };
          const timer = window.setTimeout(finish, 2500);
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            window.clearTimeout(timer);
            try {
              draw(img);
            } catch {
              // ignore draw error
            }
            finish();
          };
          img.onerror = () => {
            window.clearTimeout(timer);
            finish();
          };
          img.src = src;
        });

      // Left Logo: Kabupaten Sidoarjo
      await loadImg(SIDOARJO_LOGO_SRC, (sidoarjoImg) => {
        ctx.drawImage(sidoarjoImg, 68, 68, 174, 174);
      });

      // Right Logo: BPBD Kabupaten Sidoarjo
      await loadImg(BPBD_EMBLEM_SRC, (bpbdImg) => {
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(1086, 155, 90, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.arc(1086, 155, 82, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(bpbdImg, 1004, 73, 164, 164);
        ctx.restore();
      });

      // Centered Header text
      ctx.textAlign = 'center';
      ctx.fillStyle = '#CBD5E1';
      ctx.font = 'bold 24px Arial, Helvetica, sans-serif';
      ctx.fillText('PEMERINTAH KABUPATEN SIDOARJO', 620, 112);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 38px Arial, Helvetica, sans-serif';
      ctx.fillText('BPBD KABUPATEN SIDOARJO', 620, 170);

      ctx.fillStyle = '#FB923C';
      ctx.font = 'bold 24px Arial, Helvetica, sans-serif';
      ctx.fillText('SI-TAMU BPBD · SISTEM BUKU TAMU DIGITAL', 620, 222);

      // Poster Main Title
      ctx.fillStyle = '#0F294A';
      ctx.font = 'bold 54px Arial, Helvetica, sans-serif';
      ctx.fillText('SELAMAT DATANG', 620, 440);

      ctx.fillStyle = '#334155';
      ctx.font = 'bold 32px Arial, Helvetica, sans-serif';
      ctx.fillText('Pindai QR Code di bawah ini untuk mengisi', 620, 502);
      ctx.fillText('Buku Tamu Digital sebelum memasuki ruang layanan', 620, 548);

      // QR Frame
      ctx.strokeStyle = '#0F294A';
      ctx.lineWidth = 8;
      ctx.fillStyle = '#F8FAFC';
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(270, 610, 700, 700, 32);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(270, 610, 700, 700);
        ctx.strokeRect(270, 610, 700, 700);
      }

      await loadImg(qrDataUrl, (qrImg) => {
        ctx.drawImage(qrImg, 320, 660, 600, 600);
      });

      // Step Instructions
      ctx.fillStyle = '#0F294A';
      ctx.font = 'bold 30px Arial, Helvetica, sans-serif';
      ctx.fillText('CARA PENGISIAN BUKU TAMU', 620, 1390);

      ctx.fillStyle = '#334155';
      ctx.font = '26px Arial, Helvetica, sans-serif';
      ctx.fillText('1. Buka kamera ponsel atau pemindai QR Code', 620, 1445);
      ctx.fillText('2. Lengkapi data kunjungan & tanda tangan digital', 620, 1490);
      ctx.fillText('3. Simpan bukti nomor urut & tekan Check-Out saat selesai', 620, 1535);

      // Footer bar
      ctx.fillStyle = '#0F294A';
      ctx.fillRect(0, 1620, canvas.width, 134);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 26px Arial, Helvetica, sans-serif';
      ctx.fillText(deskLabel || 'Meja Resepsionis BPBD Kabupaten Sidoarjo', 620, 1680);
      ctx.fillStyle = '#CBD5E1';
      ctx.font = '20px Arial, Helvetica, sans-serif';
      ctx.fillText(targetUrl.trim() || defaultPublicUrl, 620, 1720);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((result) => resolve(result), 'image/png'),
      );
      if (blob) {
        triggerBlobDownload(blob, 'poster-resepsionis-si-tamu-bpbd-sidoarjo.png');
      } else {
        const posterUrl = canvas.toDataURL('image/png');
        const res = await fetch(posterUrl);
        triggerBlobDownload(await res.blob(), 'poster-resepsionis-si-tamu-bpbd-sidoarjo.png');
      }
      setPosterNotice('Poster PNG siap cetak berhasil diunduh.');
    } catch {
      setPosterError('Gagal membuat file Poster PNG. Silakan coba kembali.');
    } finally {
      setDownloadingPoster(false);
    }
  };

  const handlePrintPosterPdfClick = async () => {
    if (!qrDataUrl) return;
    setPosterError('');
    setPosterNotice('');
    setPrintingPosterPdf(true);
    try {
      await onPrintPoster(qrDataUrl, targetUrl.trim() || defaultPublicUrl, deskLabel);
      setPosterNotice('Poster Meja Resepsionis (PDF) berhasil dibuat dan diunduh.');
    } catch {
      setPosterError('Gagal membuat file Poster PDF. Silakan coba kembali.');
    } finally {
      setPrintingPosterPdf(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Configuration Controls */}
      <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
          <div className="w-10 h-10 rounded-xl bg-[#0F294A] text-white flex items-center justify-center shrink-0">
            <QrCode className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-[#0F294A]">
              Generator QR Code Resepsionis
            </h2>
            <p className="text-xs text-slate-500">
              Cetak atau unduh poster meja resepsionis untuk pemindaian tamu.
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="qr-target-url" className="block text-sm font-semibold text-slate-800 mb-1.5">
            Tautan Halaman Pengisian Tamu
          </label>
          <input
            id="qr-target-url"
            type="url"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            className="w-full min-h-[44px] px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-slate-300 bg-white text-slate-800 focus:outline-none focus:border-[#0F294A] focus:ring-2 focus:ring-[#EA580C]/25"
          />
          {currentOrigin.includes('//ais-dev-') && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTargetUrl(defaultPublicUrl)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                  targetUrl === defaultPublicUrl
                    ? 'bg-[#0F294A] text-white border-[#0F294A]'
                    : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                Gunakan Link Publik (Shared App)
              </button>
              <button
                type="button"
                onClick={() => setTargetUrl(currentPreviewUrl)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                  targetUrl === currentPreviewUrl
                    ? 'bg-[#0F294A] text-white border-[#0F294A]'
                    : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                Gunakan Link Pratinjau (Dev)
              </button>
            </div>
          )}
          <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">
            Pastikan tautan di atas memakai link aplikasi yang sudah dipublikasikan/dibagikan (Shared
            App URL) atau domain kantor agar bisa langsung dibuka dari kamera HP tamu.
          </p>
        </div>

        <div>
          <label htmlFor="qr-desk-label" className="block text-sm font-semibold text-slate-800 mb-1.5">
            Keterangan Lokasi Meja / Loket
          </label>
          <input
            id="qr-desk-label"
            type="text"
            maxLength={80}
            value={deskLabel}
            onChange={(e) => setDeskLabel(e.target.value)}
            className="w-full min-h-[44px] px-3.5 py-2 text-sm rounded-xl border border-slate-300 bg-white text-slate-800 focus:outline-none focus:border-[#0F294A] focus:ring-2 focus:ring-[#EA580C]/25"
          />
        </div>

        <div className="pt-2 space-y-3">
          {posterError && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-red-700"
            >
              {posterError}
            </div>
          )}
          {posterNotice && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800">
              {posterNotice}
            </div>
          )}

          <button
            type="button"
            disabled={!qrDataUrl || printingPosterPdf}
            onClick={handlePrintPosterPdfClick}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[46px] text-sm font-semibold text-white bg-[#EA580C] hover:bg-[#C2410C] disabled:opacity-50 rounded-xl transition-colors"
          >
            <Printer className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              {printingPosterPdf
                ? 'Menyiapkan Poster PDF...'
                : 'Cetak Poster Meja Resepsionis (PDF)'}
            </span>
          </button>

          <button
            type="button"
            disabled={!qrDataUrl || downloadingPoster}
            onClick={handleDownloadFullPosterPng}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[46px] text-sm font-semibold text-white bg-[#0F294A] hover:bg-[#091B33] disabled:opacity-50 rounded-xl transition-colors"
          >
            <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              {downloadingPoster ? 'Menyiapkan Poster PNG...' : 'Unduh Poster Siap Cetak (PNG)'}
            </span>
          </button>

          <button
            type="button"
            disabled={!qrDataUrl}
            onClick={handleDownloadQrOnly}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[42px] text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-xl transition-colors"
          >
            <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Unduh Gambar QR Saja (PNG)</span>
          </button>
        </div>
      </div>

      {/* Live Reception Desk Poster Preview */}
      <div className="lg:col-span-7 flex justify-center">
        <div className="w-full max-w-[460px] bg-white border border-slate-300 rounded-2xl overflow-hidden shadow-sm">
          {/* Poster Top Navy Header with Dual Logos */}
          <div className="bg-[#0F294A] px-5 py-5 text-white border-b-4 border-[#EA580C]">
            <div className="flex items-center justify-between gap-3">
              <SidoarjoLogo className="w-12 h-12" />
              <div className="text-center flex-1 min-w-0">
                <p className="text-[10px] font-medium text-slate-300 tracking-wide">
                  PEMERINTAH KABUPATEN SIDOARJO
                </p>
                <p className="font-display text-sm font-bold text-white leading-tight">
                  BPBD KABUPATEN SIDOARJO
                </p>
                <p className="text-[11px] font-semibold text-[#FB923C] mt-0.5">
                  SI-TAMU BPBD · BUKU TAMU DIGITAL
                </p>
              </div>
              <BpbdEmblem className="w-12 h-12" />
            </div>
          </div>

          {/* Poster Body */}
          <div className="px-6 py-7 text-center space-y-5">
            <div>
              <h3 className="font-display text-2xl font-extrabold text-[#0F294A] tracking-tight">
                SELAMAT DATANG
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Pindai QR Code untuk mengisi Buku Tamu Digital sebelum memasuki area layanan
              </p>
            </div>

            <div className="mx-auto w-56 h-56 p-3 bg-slate-50 border-2 border-[#0F294A] rounded-2xl flex items-center justify-center">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="QR Code Buku Tamu Digital BPBD Kabupaten Sidoarjo"
                  className="w-full h-full object-contain"
                />
              ) : (
                <span className="text-xs text-slate-400">Menghasilkan QR...</span>
              )}
            </div>

            <ol className="text-left text-xs sm:text-sm text-slate-700 space-y-1.5 bg-slate-50 border border-slate-200 rounded-xl p-4">
              <li>1. Arahkan kamera ponsel atau aplikasi pemindai ke QR Code.</li>
              <li>2. Lengkapi data diri, bidang tujuan, dan tanda tangan digital.</li>
              <li>3. Simpan nomor urut kunjungan & tekan Check-Out saat selesai.</li>
            </ol>
          </div>

          {/* Poster Footer */}
          <div className="bg-[#0F294A] px-5 py-3 text-center text-white">
            <p className="text-xs font-semibold">{deskLabel || 'Meja Resepsionis Utama'}</p>
            <p className="text-[10px] text-slate-300 font-mono truncate mt-0.5">
              {targetUrl.trim() || defaultPublicUrl}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
