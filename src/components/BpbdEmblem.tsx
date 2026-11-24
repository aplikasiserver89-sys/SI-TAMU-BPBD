import { useState } from 'react';

export const SIDOARJO_LOGO_SRC =
  '/assets/aistudio/Coat_of_Arms_of_Sidoarjo_Regency-removebg-preview_e40aa75c.png';
export const BPBD_EMBLEM_SRC = '/assets/aistudio/images_45c2959d.jfif';

interface LogoProps {
  className?: string;
}

export function SidoarjoLogo({ className = 'w-14 h-14' }: LogoProps) {
  const [imgError, setImgError] = useState(false);

  if (imgError) {
    return (
      <div
        className={`${className} flex items-center justify-center shrink-0`}
        aria-label="Logo Pemerintah Kabupaten Sidoarjo"
      >
        <svg viewBox="0 0 40 40" className="w-full h-full drop-shadow-sm" aria-hidden="true">
          <path
            d="M20 4L7 9v10c0 9 5.5 15 13 17 7.5-2 13-8 13-17V9L20 4z"
            fill="#15803D"
            stroke="#0284C7"
            strokeWidth="2"
          />
          <circle cx="20" cy="20" r="6" fill="#FACC15" />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={SIDOARJO_LOGO_SRC}
      alt="Lambang Kabupaten Sidoarjo"
      referrerPolicy="no-referrer"
      onError={() => setImgError(true)}
      className={`${className} object-contain shrink-0 drop-shadow-[0_3px_10px_rgba(0,0,0,0.35)]`}
    />
  );
}

export function BpbdEmblem({ className = 'w-14 h-14' }: LogoProps) {
  const [imgError, setImgError] = useState(false);

  if (imgError) {
    return (
      <div
        className={`${className} rounded-full bg-white flex items-center justify-center shrink-0 border-2 border-white/40 p-1`}
        aria-label="Logo BPBD Kabupaten Sidoarjo"
      >
        <svg viewBox="0 0 40 40" className="w-full h-full" aria-hidden="true">
          <circle cx="20" cy="20" r="18" fill="#EA580C" stroke="#0F294A" strokeWidth="2" />
          <polygon points="20,8 31,28 9,28" fill="#0F294A" />
        </svg>
      </div>
    );
  }

  return (
    <div
      className={`${className} rounded-full bg-white border-2 border-white/40 p-0.5 flex items-center justify-center shrink-0 shadow-md overflow-hidden`}
    >
      <img
        src={BPBD_EMBLEM_SRC}
        alt="Lambang BPBD Kabupaten Sidoarjo"
        referrerPolicy="no-referrer"
        onError={() => setImgError(true)}
        className="w-full h-full object-contain rounded-full"
      />
    </div>
  );
}
