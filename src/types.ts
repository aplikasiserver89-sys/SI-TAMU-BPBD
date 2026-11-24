export const VISITOR_CATEGORIES = [
  'Masyarakat Umum',
  'Instansi Pemerintah/OPD',
  'TNI/Polri',
  'Relawan/Komunitas',
  'Swasta/Media',
] as const;

export type VisitorCategory = (typeof VISITOR_CATEGORIES)[number];

export const DEPARTMENTS = [
  'Kepala Pelaksana',
  'Sekretariat',
  'Bidang Pencegahan & Kesiapsiagaan',
  'Bidang Kedaruratan & Logistik',
  'Bidang Rehabilitasi & Rekonstruksi',
] as const;

export type Department = string;

export const VISIT_STATUSES = ['Sedang Berkunjung', 'Selesai'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const USER_ROLES = ['super_admin', 'resepsionis', 'pimpinan'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin (Pengadministrasi Umum)',
  resepsionis: 'Petugas Resepsionis / Piket',
  pimpinan: 'Pimpinan / Kepala Bidang',
};

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  department: string;
}

export interface ManagedUser extends AuthUser {
  isActive: boolean;
  createdAt: number;
}

export interface DepartmentRecord {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

export interface AuditLogRecord {
  id: string;
  actorUsername: string;
  actorRole: string;
  action: string;
  target: string;
  details: string;
  createdAt: number;
}

export interface PasswordResetRequestRecord {
  id: string;
  userId: string;
  username: string;
  fullName: string;
  role: UserRole | string;
  note: string;
  status: 'pending' | 'token_issued' | 'completed' | 'rejected';
  tokenExpiresAt: number | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface VisitRecord {
  id: string;
  queueNumber: number;
  queueCode: string;
  visitDate: string;
  fullName: string;
  phone: string;
  visitorCategory: VisitorCategory;
  institutionAddress: string;
  department: Department;
  purpose: string;
  signatureData: string;
  status: VisitStatus;
  checkInAt: string;
  checkOutAt: string | null;
}

export interface VisitSubmissionResponse {
  visit: VisitRecord;
  checkoutToken: string;
}

export interface PeriodRecapItem {
  key: 'today' | 'week' | 'month' | 'year' | 'last_year' | 'all';
  label: string;
  rangeLabel: string;
  total: number;
  active: number;
  done: number;
}

export interface BreakdownItem {
  name: string;
  total: number;
}

export interface DashboardStats {
  totalToday: number;
  activeNow: number;
  totalWeek: number;
  totalMonth: number;
  totalYear: number;
  totalLastYear: number;
  totalAll: number;
  topDepartment: {
    name: string;
    count: number;
  } | null;
  periodRecap: PeriodRecapItem[];
  departmentBreakdown: BreakdownItem[];
  categoryBreakdown: BreakdownItem[];
}

export interface AdminAuthStatus {
  configured: boolean;
  source: 'env' | 'database' | 'unconfigured';
  authenticated: boolean;
  user: AuthUser | null;
}
