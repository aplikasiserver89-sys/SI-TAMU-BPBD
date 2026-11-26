import { useEffect, useState } from 'react';
import { ExternalLink, MessageSquareHeart, Star, X } from 'lucide-react';
import { BpbdEmblem, SidoarjoLogo } from './BpbdEmblem';

export const IKM_SURVEY_URL = 'https://ikm.sidoarjokab.go.id/opd/128';

interface IkmSurveyPopupProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function IkmSurveyPopup({ open, onOpenChange }: IkmSurveyPopupProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = typeof open === 'boolean';
  const isOpen = isControlled ? open : internalOpen;

  const setOpen = (next: boolean) => {
    if (!isControlled) {
      setInternalOpen(next);
    }
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <>
      {/* Floating Action Button (Bottom-Right) - BPBD Orange Accent */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Buka Penilaian IKM BPBD Kabupaten Sidoarjo"
        className="no-print fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 inline-flex items-center gap-2.5 px-5 py-3.5 min-h-[48px] rounded-full bg-gradient-to-r from-[#C84604] via-[#EA580C] to-[#F97316] hover:-translate-y-0.5 hover:brightness-105 text-white text-sm font-semibold shadow-[0_12px_28px_-6px_rgba(234,88,12,0.55)] border border-white/25 transition-all duration-200 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B1E38]"
      >
        <MessageSquareHeart className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>Penilaian IKM</span>
      </button>

      {/* Pop-up Modal Penilaian IKM */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ikm-popup-title"
          className="no-print fixed inset-0 z-50 bg-[#08172C]/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Navy Banner with Dual Logos */}
            <div className="bg-gradient-to-r from-[#08172C] via-[#0F294A] to-[#153E75] text-white px-5 py-4 border-b-4 border-[#EA580C] flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex items-center gap-1.5 shrink-0">
                  <SidoarjoLogo className="w-9 h-9" />
                  <BpbdEmblem className="w-9 h-9" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="ikm-popup-title"
                    className="font-display text-base font-bold text-white leading-tight truncate"
                  >
                    Penilaian IKM Layanan
                  </h2>
                  <p className="text-xs text-slate-200 truncate">
                    BPBD Kabupaten Sidoarjo
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Tutup pop-up penilaian IKM"
                className="p-2 min-h-[36px] min-w-[36px] rounded-lg text-slate-200 hover:text-white hover:bg-white/10 transition-colors shrink-0"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 sm:p-6 space-y-5 bg-white">
              <div className="flex items-center justify-center gap-1.5 py-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    className="w-6 h-6 text-[#EA580C] fill-[#EA580C]"
                    aria-hidden="true"
                  />
                ))}
              </div>

              <div className="text-center space-y-2">
                <h3 className="font-display text-lg font-bold text-[#0F294A]">
                  Survei Kepuasan Masyarakat
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Terima kasih telah berkunjung ke BPBD Kabupaten Sidoarjo. Mohon kesediaan Anda
                  memberikan penilaian Indeks Kepuasan Masyarakat (IKM) untuk peningkatan mutu
                  pelayanan kami.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
                <p className="font-semibold text-[#0F294A]">Tujuan Tautan Resmi:</p>
                <p className="break-all text-[#1354B2] font-medium">{IKM_SURVEY_URL}</p>
              </div>

              <div className="flex flex-col gap-2.5 pt-1">
                <a
                  href={IKM_SURVEY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 min-h-[48px] text-sm font-bold text-white bg-gradient-to-r from-[#0B3B82] via-[#0F294A] to-[#1554B2] hover:brightness-110 rounded-xl shadow-[0_10px_22px_-8px_rgba(15,41,74,0.55)] transition-all whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA580C]"
                >
                  <span>Menuju Dashboard Penilaian IKM</span>
                  <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
                </a>

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="w-full inline-flex items-center justify-center px-5 py-2.5 min-h-[42px] text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
