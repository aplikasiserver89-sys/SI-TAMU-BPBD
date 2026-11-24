import { useCallback, useEffect, useState } from 'react';
import type { AuthUser, VisitRecord } from './types';
import { TopBar, type AppView } from './components/TopBar';
import { PublicGuestPage } from './components/PublicGuestPage';
import { AdminLoginView } from './components/AdminLoginView';
import { AdminDashboard } from './components/AdminDashboard';
import { QrPosterStudio } from './components/QrPosterStudio';
import { downloadDeskPosterPdf } from './lib/pdfGenerator';
import { ApiError, fetchVisitReceipt, logoutInternalUser } from './lib/api';

const RECEIPT_STORAGE_KEY = 'sitamu_bpbd_active_receipt';
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes inactivity auto-logout

interface StoredReceiptRef {
  visitId: string;
  checkoutToken: string;
}

interface AuthSession {
  token: string;
  user: AuthUser;
}

export default function App() {
  const [activeView, setActiveView] = useState<AppView>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('view') === 'admin') return 'admin';
      if (params.get('view') === 'qr') return 'qr';
    }
    return 'public';
  });
  const [adminTab, setAdminTab] = useState<'records' | 'qr'>('records');

  // Auth session held strictly in React memory (never persisted in localStorage/sessionStorage)
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);

  // Guest active receipt state
  const [activeReceipt, setActiveReceipt] = useState<{
    visit: VisitRecord;
    checkoutToken: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const isFreshQrScan = params.get('mode') === 'tamu';
    const raw = sessionStorage.getItem(RECEIPT_STORAGE_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as StoredReceiptRef;
      if (!parsed.visitId || !parsed.checkoutToken) return;

      fetchVisitReceipt(parsed.visitId, parsed.checkoutToken)
        .then((visit) => {
          if (visit.status === 'Selesai' || isFreshQrScan) {
            sessionStorage.removeItem(RECEIPT_STORAGE_KEY);
            return;
          }
          if (active && visit) {
            setActiveReceipt({
              visit,
              checkoutToken: parsed.checkoutToken,
            });
          }
        })
        .catch((err) => {
          if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
            sessionStorage.removeItem(RECEIPT_STORAGE_KEY);
          }
        });
    } catch {
      sessionStorage.removeItem(RECEIPT_STORAGE_KEY);
    }

    return () => {
      active = false;
    };
  }, []);

  const handleLogout = useCallback(async () => {
    if (authSession?.token) {
      try {
        await logoutInternalUser(authSession.token);
      } catch {
        // ignore network error on logout
      }
    }
    setAuthSession(null);
    setActiveView('public');
  }, [authSession?.token]);

  // Automatic idle logout for authenticated internal users (30 mins inactivity)
  useEffect(() => {
    if (!authSession) return;
    let timerId = window.setTimeout(() => {
      handleLogout();
    }, IDLE_TIMEOUT_MS);

    const resetIdleTimer = () => {
      window.clearTimeout(timerId);
      timerId = window.setTimeout(() => {
        handleLogout();
      }, IDLE_TIMEOUT_MS);
    };

    const events = ['mousemove', 'keydown', 'click', 'touchstart'] as const;
    events.forEach((ev) => window.addEventListener(ev, resetIdleTimer, { passive: true }));

    return () => {
      window.clearTimeout(timerId);
      events.forEach((ev) => window.removeEventListener(ev, resetIdleTimer));
    };
  }, [authSession, handleLogout]);

  const handleNavigate = (view: AppView, tab?: 'records' | 'qr') => {
    setActiveView(view);
    if (tab) setAdminTab(tab);
  };

  const handleReceiptCreated = (visit: VisitRecord, checkoutToken: string) => {
    setActiveReceipt({ visit, checkoutToken });
    sessionStorage.setItem(
      RECEIPT_STORAGE_KEY,
      JSON.stringify({ visitId: visit.id, checkoutToken } satisfies StoredReceiptRef),
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleReceiptUpdated = (updatedVisit: VisitRecord) => {
    setActiveReceipt((prev) => (prev ? { ...prev, visit: updatedVisit } : null));
  };

  const handleClearReceipt = () => {
    setActiveReceipt(null);
    sessionStorage.removeItem(RECEIPT_STORAGE_KEY);
  };

  const handlePrintStandalonePoster = async (
    qrDataUrl: string,
    targetUrl: string,
    deskLabel: string,
  ) => {
    await downloadDeskPosterPdf({ qrDataUrl, targetUrl, deskLabel });
  };

  return (
    <div className="bpbd-canvas min-h-screen flex flex-col text-slate-900">
      <TopBar
        activeView={activeView}
        authUser={authSession?.user ?? null}
        onNavigate={handleNavigate}
        onLogout={handleLogout}
      />

      <div className="flex-1">
        {activeView === 'public' ? (
          <PublicGuestPage
            activeReceipt={activeReceipt}
            onReceiptCreated={handleReceiptCreated}
            onReceiptUpdated={handleReceiptUpdated}
            onClearReceipt={handleClearReceipt}
          />
        ) : activeView === 'qr' ? (
          <main className="no-print max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-[#FDBA74]">
                BPBD Kabupaten Sidoarjo · Layanan Pemindaian Tamu
              </p>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight">
                Poster QR Code Meja Resepsionis
              </h1>
            </div>
            <QrPosterStudio onPrintPoster={handlePrintStandalonePoster} />
          </main>
        ) : authSession ? (
          <AdminDashboard
            token={authSession.token}
            authUser={authSession.user}
            initialTab={adminTab}
            onSessionExpired={() => setAuthSession(null)}
            onOpenGuestForm={() => setActiveView('public')}
          />
        ) : (
          <AdminLoginView
            onAuthenticated={(token, user) => {
              setAuthSession({ token, user });
              if (user.role !== 'super_admin') {
                setAdminTab('records');
              }
            }}
            onBackToPublic={() => setActiveView('public')}
          />
        )}
      </div>

      <footer className="no-print border-t border-white/10 bg-[#08172C]/90 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-300">
          <span>
            SI-TAMU BPBD · Sistem Buku Tamu Digital Badan Penanggulangan Bencana Daerah Kabupaten
            Sidoarjo
          </span>
          <span className="font-mono tabular-nums text-slate-400">
            © {new Date().getFullYear()} BPBD Kabupaten Sidoarjo
          </span>
        </div>
      </footer>
    </div>
  );
}
