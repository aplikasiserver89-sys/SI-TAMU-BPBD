const WIB_TZ = 'Asia/Jakarta';

export function getTodayWib(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: WIB_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function getMonthStartWib(): string {
  return `${getTodayWib().slice(0, 7)}-01`;
}

export function getWeekStartWib(): string {
  const todayStr = getTodayWib();
  const date = new Date(`${todayStr}T12:00:00+07:00`);
  const day = date.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const diffToMonday = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - diffToMonday);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: WIB_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function getYearStartWib(): string {
  return `${getTodayWib().slice(0, 4)}-01-01`;
}

export function getLastYearRangeWib(): { start: string; end: string; year: string } {
  const currentYear = Number(getTodayWib().slice(0, 4));
  const lastYear = String(currentYear - 1);
  return {
    year: lastYear,
    start: `${lastYear}-01-01`,
    end: `${lastYear}-12-31`,
  };
}

export function formatIndonesianDate(isoOrDate: string): string {
  const date = isoOrDate.length === 10 ? new Date(`${isoOrDate}T00:00:00+07:00`) : new Date(isoOrDate);
  if (Number.isNaN(date.getTime())) return isoOrDate;
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: WIB_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function formatShortDate(isoOrDate: string): string {
  const date = isoOrDate.length === 10 ? new Date(`${isoOrDate}T00:00:00+07:00`) : new Date(isoOrDate);
  if (Number.isNaN(date.getTime())) return isoOrDate;
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: WIB_TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatWibTime(isoString: string | null): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  const formatted = new Intl.DateTimeFormat('id-ID', {
    timeZone: WIB_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${formatted} WIB`;
}
