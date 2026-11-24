import { LogIn, LogOut } from 'lucide-react';
import type { AuthUser } from '../types';
import { BpbdEmblem, SidoarjoLogo } from './BpbdEmblem';

export type AppView = 'public' | 'admin';

interface TopBarProps {
  activeView: AppView;
  authUser: AuthUser | null;
  onNavigate: (view: AppView, adminTab?: 'records' | 'qr') => void;
  onLogout: () => void;
}

export function TopBar({ activeView, authUser, onNavigate, onLogout }: TopBarProps) {
  const canAccessQr = !authUser || authUser.role === 'super_admin';

  return (
    <header className="no-print sticky top-0 z-30 bg-[#08172C]/90 backdrop-blur-md border-b border-white/15 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => onNavigate('public')}
          className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA580C] rounded-lg py-1"
        >
          <SidoarjoLogo className="w-8 h-8" />
          <BpbdEmblem className="w-8 h-8" />
          <span className="font-display text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 ml-1">
            SI-TAMU BPBD
          </span>
        </button>

        {/* Zone 2: Clean single-line text navigation links */}
        <nav
          aria-label="Navigasi Utama"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-300"
        >
          <button
            type="button"
            onClick={() => onNavigate('public')}
            className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeView === 'public'
                ? 'border-[#EA580C] text-white font-semibold'
                : 'border-transparent hover:text-white'
            }`}
          >
            Form Buku Tamu
          </button>
          <button
            type="button"
            onClick={() => onNavigate('admin', 'records')}
            className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeView === 'admin'
                ? 'border-[#EA580C] text-white font-semibold'
                : 'border-transparent hover:text-white'
            }`}
          >
            Dashboard Internal
          </button>
          {canAccessQr && (
            <button
              type="button"
              onClick={() => onNavigate('admin', 'qr')}
              className="py-1.5 border-b-2 border-transparent hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Poster QR Meja
            </button>
          )}
        </nav>

        {/* Zone 3: Single primary action button */}
        <div className="flex items-center gap-2 shrink-0">
          {authUser ? (
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] text-xs sm:text-sm font-semibold text-white bg-[#EA580C] hover:bg-[#C2410C] rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Keluar Sistem</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate(activeView === 'admin' ? 'public' : 'admin', 'records')}
              className="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] text-xs sm:text-sm font-semibold text-white bg-[#EA580C] hover:bg-[#C2410C] rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <LogIn className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{activeView === 'admin' ? 'Form Tamu' : 'Portal Internal'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Compact mobile navigation strip */}
      <div className="md:hidden border-t border-white/10 bg-[#0B1E38]/95 px-4 py-1.5 flex items-center justify-around text-xs font-medium">
        <button
          type="button"
          onClick={() => onNavigate('public')}
          className={`px-3 py-1.5 rounded-md whitespace-nowrap shrink-0 ${
            activeView === 'public' ? 'bg-[#EA580C] text-white font-semibold' : 'text-slate-300'
          }`}
        >
          Form Tamu
        </button>
        <button
          type="button"
          onClick={() => onNavigate('admin', 'records')}
          className={`px-3 py-1.5 rounded-md whitespace-nowrap shrink-0 ${
            activeView === 'admin' ? 'bg-[#EA580C] text-white font-semibold' : 'text-slate-300'
          }`}
        >
          Dashboard
        </button>
        {canAccessQr && (
          <button
            type="button"
            onClick={() => onNavigate('admin', 'qr')}
            className="px-3 py-1.5 rounded-md text-slate-300 whitespace-nowrap shrink-0"
          >
            Poster QR
          </button>
        )}
      </div>
    </header>
  );
}
