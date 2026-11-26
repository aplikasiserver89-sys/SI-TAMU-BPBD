-- ============================================================================
-- SI-TAMU BPBD KABUPATEN SIDOARJO
-- Skema Database Lengkap & RPC Autentikasi/RBAC untuk Supabase (PostgreSQL)
-- Jalankan seluruh skrip ini di Supabase Dashboard -> SQL Editor -> New Query
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Tabel Kunjungan Tamu
CREATE TABLE IF NOT EXISTS public.visits (
  id TEXT PRIMARY KEY,
  queue_number INTEGER NOT NULL,
  queue_code TEXT NOT NULL,
  visit_date TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  visitor_category TEXT NOT NULL,
  institution_address TEXT NOT NULL,
  department TEXT NOT NULL,
  official_name TEXT,
  purpose TEXT NOT NULL,
  signature_data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Sedang Berkunjung',
  check_in_at TEXT NOT NULL,
  check_out_at TEXT,
  checkout_token_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visits_date ON public.visits (visit_date);
CREATE INDEX IF NOT EXISTS idx_visits_department ON public.visits (department);
CREATE INDEX IF NOT EXISTS idx_visits_status ON public.visits (status);
CREATE INDEX IF NOT EXISTS idx_visits_check_in ON public.visits (check_in_at DESC);

-- 2. Tabel Counter Nomor Urut Harian (WIB)
CREATE TABLE IF NOT EXISTS public.daily_counters (
  visit_date TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL
);

-- 3. Tabel Konfigurasi Admin Legacy
CREATE TABLE IF NOT EXISTS public.admin_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- 4. Tabel Pengguna Internal & Hak Akses RBAC
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'resepsionis', 'pimpinan')),
  department TEXT NOT NULL DEFAULT 'Semua Bidang',
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON public.users (LOWER(username));

-- 5. Tabel Sesi Login Internal (Token disimpan dalam bentuk hash SHA-256)
CREATE TABLE IF NOT EXISTS public.app_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_sessions_expires ON public.app_sessions (expires_at);

-- 6. Tabel Master Bidang Tujuan BPBD Kabupaten Sidoarjo
CREATE TABLE IF NOT EXISTS public.departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

-- 7. Tabel Log Audit Aktivitas Internal
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id TEXT PRIMARY KEY,
  actor_username TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs (created_at DESC);

-- 8. Tabel Permintaan Reset Kata Sandi
CREATE TABLE IF NOT EXISTS public.password_reset_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  token_hash TEXT,
  token_expires_at BIGINT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'token_issued', 'completed', 'rejected')),
  created_at BIGINT NOT NULL,
  resolved_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_pwd_reset_status ON public.password_reset_requests (status, created_at DESC);

-- ============================================================================
-- DATA AWAL (SEED): MASTER BIDANG & AKUN DEFAULT SUPERADMIN
-- ============================================================================

INSERT INTO public.departments (id, name, is_active, sort_order, created_at)
VALUES
  ('dept-kepala-pelaksana', 'Kepala Pelaksana', 1, 1, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),
  ('dept-sekretariat', 'Sekretariat', 1, 2, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),
  ('dept-pencegahan-kesiapsiagaan', 'Bidang Pencegahan & Kesiapsiagaan', 1, 3, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),
  ('dept-kedaruratan-logistik', 'Bidang Kedaruratan & Logistik', 1, 4, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),
  ('dept-rehabilitasi-rekonstruksi', 'Bidang Rehabilitasi & Rekonstruksi', 1, 5, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT)
ON CONFLICT (name) DO NOTHING;

-- Akun Default Super Admin:
-- Username : superadmin
-- Password : AdminBpbd123! (segera ganti setelah login pertama via menu Akun & RBAC)
INSERT INTO public.users (
  id, username, full_name, role, department, password_hash, is_active, created_at, updated_at
)
VALUES (
  'user-default-superadmin',
  'superadmin',
  'Super Admin BPBD Sidoarjo',
  'super_admin',
  'Semua Bidang',
  crypt('AdminBpbd123!', gen_salt('bf', 10)),
  1,
  (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
)
ON CONFLICT (username) DO NOTHING;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- Semua tabel dilindungi RLS; akses dilakukan aman melalui fungsi RPC terverifikasi.
-- ============================================================================
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- FUNGSI HELPER INTERNAL
-- ============================================================================

CREATE OR REPLACE FUNCTION public.next_visit_queue_number(p_visit_date TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_next INTEGER;
BEGIN
  INSERT INTO public.daily_counters (visit_date, last_number)
  VALUES (p_visit_date, 1)
  ON CONFLICT (visit_date)
  DO UPDATE SET last_number = public.daily_counters.last_number + 1
  RETURNING last_number INTO v_next;

  RETURN v_next;
END;
$$;

REVOKE ALL ON FUNCTION public.next_visit_queue_number(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_visit_queue_number(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.verify_user_bcrypt(p_user_id TEXT, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  SELECT password_hash INTO v_hash
  FROM public.users
  WHERE id = p_user_id AND is_active = 1;

  IF v_hash IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN (crypt(p_password, v_hash) = v_hash);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_user_bcrypt(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_user_bcrypt(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public._map_visit_json(v public.visits)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'id', v.id,
    'queueNumber', v.queue_number,
    'queueCode', v.queue_code,
    'visitDate', v.visit_date,
    'fullName', v.full_name,
    'phone', v.phone,
    'visitorCategory', v.visitor_category,
    'institutionAddress', v.institution_address,
    'department', v.department,
    'purpose', v.purpose,
    'signatureData', v.signature_data,
    'status', v.status,
    'checkInAt', v.check_in_at,
    'checkOutAt', v.check_out_at
  );
$$;

CREATE OR REPLACE FUNCTION public._verify_app_session(p_token TEXT)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_now BIGINT := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
  v_hash TEXT;
  v_user public.users;
BEGIN
  IF p_token IS NULL OR LENGTH(TRIM(p_token)) < 16 THEN
    RETURN NULL;
  END IF;

  v_hash := encode(digest(TRIM(p_token), 'sha256'), 'hex');

  SELECT u.* INTO v_user
  FROM public.app_sessions s
  JOIN public.users u ON u.id = s.user_id
  WHERE s.token_hash = v_hash
    AND s.expires_at > v_now
    AND u.is_active = 1
  LIMIT 1;

  IF v_user.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v_user;
END;
$$;

REVOKE ALL ON FUNCTION public._verify_app_session(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._record_audit(
  p_actor_username TEXT,
  p_actor_role TEXT,
  p_action TEXT,
  p_target TEXT,
  p_details TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  INSERT INTO public.audit_logs (id, actor_username, actor_role, action, target, details, created_at)
  VALUES (
    gen_random_uuid()::TEXT,
    COALESCE(p_actor_username, 'system'),
    COALESCE(p_actor_role, 'system'),
    COALESCE(p_action, ''),
    COALESCE(p_target, ''),
    LEFT(COALESCE(p_details, ''), 300),
    (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
  );
END;
$$;

REVOKE ALL ON FUNCTION public._record_audit(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- RPC PUBLIK: FORMULIR TAMU & BUKTI KUNJUNGAN
-- ============================================================================

CREATE OR REPLACE FUNCTION public.api_get_public_departments()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_items JSONB;
BEGIN
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'name', d.name,
        'isActive', (d.is_active = 1),
        'sortOrder', d.sort_order
      )
      ORDER BY d.sort_order ASC, d.name ASC
    ),
    '[]'::JSONB
  )
  INTO v_items
  FROM public.departments d
  WHERE d.is_active = 1;

  RETURN jsonb_build_object('ok', TRUE, 'departments', v_items);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_submit_visit(
  p_full_name TEXT,
  p_phone TEXT,
  p_visitor_category TEXT,
  p_institution_address TEXT,
  p_department TEXT,
  p_purpose TEXT,
  p_signature_data TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_full_name TEXT := LEFT(TRIM(COALESCE(p_full_name, '')), 120);
  v_phone TEXT := LEFT(TRIM(COALESCE(p_phone, '')), 24);
  v_category TEXT := LEFT(TRIM(COALESCE(p_visitor_category, '')), 60);
  v_inst TEXT := LEFT(TRIM(COALESCE(p_institution_address, '')), 200);
  v_dept TEXT := LEFT(TRIM(COALESCE(p_department, '')), 80);
  v_purpose TEXT := LEFT(TRIM(COALESCE(p_purpose, '')), 500);
  v_sig TEXT := TRIM(COALESCE(p_signature_data, ''));
  v_dept_exists BOOLEAN;
  v_visit_date TEXT := to_char(NOW() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD');
  v_check_in_at TEXT := to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_now BIGINT := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
  v_next_num INTEGER;
  v_queue_code TEXT;
  v_id TEXT := gen_random_uuid()::TEXT;
  v_checkout_token TEXT := encode(gen_random_bytes(24), 'hex');
  v_token_hash TEXT := encode(digest(v_checkout_token, 'sha256'), 'hex');
  v_visit public.visits;
BEGIN
  IF LENGTH(v_full_name) < 2 THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'Nama lengkap wajib diisi (minimal 2 karakter).');
  END IF;
  IF v_phone !~ '^[0-9+\-\s()]{8,24}$' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'Nomor HP/WhatsApp wajib diisi dengan format yang benar.');
  END IF;
  IF v_category NOT IN ('Masyarakat Umum', 'Instansi Pemerintah/OPD', 'TNI/Polri', 'Relawan/Komunitas', 'Swasta/Media') THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'Kategori pengunjung tidak valid.');
  END IF;
  IF LENGTH(v_inst) < 2 THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'Nama instansi/alamat wajib diisi.');
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.departments WHERE name = v_dept AND is_active = 1) INTO v_dept_exists;
  IF NOT v_dept_exists THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'Bidang tujuan tidak valid atau sedang tidak aktif.');
  END IF;

  IF LENGTH(v_purpose) < 3 THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'Keperluan kunjungan wajib diisi.');
  END IF;
  IF LEFT(v_sig, 22) <> 'data:image/png;base64,' OR LENGTH(v_sig) < 150 OR LENGTH(v_sig) > 350000 THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'Tanda tangan digital wajib diisi pada kotak tanda tangan.');
  END IF;

  v_next_num := public.next_visit_queue_number(v_visit_date);
  v_queue_code := 'T-' || LPAD(v_next_num::TEXT, 3, '0');

  INSERT INTO public.visits (
    id, queue_number, queue_code, visit_date, full_name, phone,
    visitor_category, institution_address, department, official_name,
    purpose, signature_data, status, check_in_at, check_out_at,
    checkout_token_hash, created_at
  )
  VALUES (
    v_id, v_next_num, v_queue_code, v_visit_date, v_full_name, v_phone,
    v_category, v_inst, v_dept, NULL,
    v_purpose, v_sig, 'Sedang Berkunjung', v_check_in_at, NULL,
    v_token_hash, v_now
  )
  RETURNING * INTO v_visit;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'visit', public._map_visit_json(v_visit),
    'checkoutToken', v_checkout_token
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_get_visit_receipt(p_visit_id TEXT, p_checkout_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_visit public.visits;
  v_token_hash TEXT;
BEGIN
  IF p_visit_id IS NULL OR p_checkout_token IS NULL OR TRIM(p_checkout_token) = '' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'Token bukti kunjungan tidak ditemukan.');
  END IF;

  v_token_hash := encode(digest(TRIM(p_checkout_token), 'sha256'), 'hex');
  SELECT * INTO v_visit FROM public.visits WHERE id = p_visit_id;

  IF v_visit.id IS NULL OR v_visit.checkout_token_hash <> v_token_hash THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 404, 'error', 'Bukti kunjungan tidak ditemukan atau token tidak cocok.');
  END IF;

  RETURN jsonb_build_object('ok', TRUE, 'visit', public._map_visit_json(v_visit));
END;
$$;

CREATE OR REPLACE FUNCTION public.api_checkout_visit(p_visit_id TEXT, p_checkout_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_visit public.visits;
  v_token_hash TEXT;
  v_checkout_at TEXT := to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  IF p_visit_id IS NULL OR p_checkout_token IS NULL OR TRIM(p_checkout_token) = '' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'Token bukti kunjungan tidak valid.');
  END IF;

  v_token_hash := encode(digest(TRIM(p_checkout_token), 'sha256'), 'hex');
  SELECT * INTO v_visit FROM public.visits WHERE id = p_visit_id;

  IF v_visit.id IS NULL OR v_visit.checkout_token_hash <> v_token_hash THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 404, 'error', 'Bukti kunjungan tidak ditemukan atau token tidak cocok.');
  END IF;

  IF v_visit.status = 'Selesai' THEN
    RETURN jsonb_build_object('ok', TRUE, 'visit', public._map_visit_json(v_visit));
  END IF;

  UPDATE public.visits
  SET status = 'Selesai', check_out_at = v_checkout_at
  WHERE id = p_visit_id
  RETURNING * INTO v_visit;

  RETURN jsonb_build_object('ok', TRUE, 'visit', public._map_visit_json(v_visit));
END;
$$;

-- ============================================================================
-- RPC AUTENTIKASI & PEMULIHAN KATA SANDI
-- ============================================================================

CREATE OR REPLACE FUNCTION public.api_auth_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.users;
  RETURN jsonb_build_object(
    'ok', TRUE,
    'configured', (v_count > 0),
    'source', CASE WHEN v_count > 0 THEN 'database' ELSE 'unconfigured' END,
    'authenticated', FALSE,
    'user', NULL,
    'supportEmail', 'aplikasiserver89@gmail.com',
    'smtpConfigured', FALSE
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_bootstrap_super_admin(
  p_username TEXT,
  p_full_name TEXT,
  p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_username TEXT := LEFT(TRIM(COALESCE(p_username, '')), 60);
  v_full_name TEXT := LEFT(TRIM(COALESCE(p_full_name, '')), 120);
  v_count INTEGER;
  v_id TEXT := gen_random_uuid()::TEXT;
  v_now BIGINT := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
  v_token TEXT := encode(gen_random_bytes(32), 'hex');
  v_token_hash TEXT := encode(digest(v_token, 'sha256'), 'hex');
BEGIN
  IF v_username !~ '^[a-zA-Z0-9._-]{3,60}$' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'NIP / Username wajib diisi (3-60 karakter, huruf, angka, titik, atau garis bawah).');
  END IF;
  IF LENGTH(v_full_name) < 2 THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'Nama lengkap Super Admin wajib diisi.');
  END IF;
  IF p_password IS NULL OR LENGTH(p_password) < 8 OR LENGTH(p_password) > 128 THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'Kata sandi harus 8 sampai 128 karakter.');
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.users;
  IF v_count > 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 409, 'error', 'Akun internal sudah dikonfigurasi. Silakan masuk melalui halaman login.');
  END IF;

  INSERT INTO public.users (id, username, full_name, role, department, password_hash, is_active, created_at, updated_at)
  VALUES (v_id, v_username, v_full_name, 'super_admin', 'Semua Bidang', crypt(p_password, gen_salt('bf', 10)), 1, v_now, v_now);

  INSERT INTO public.app_sessions (token_hash, user_id, expires_at, created_at)
  VALUES (v_token_hash, v_id, v_now + 43200000, v_now);

  PERFORM public._record_audit(v_username, 'super_admin', 'BOOTSTRAP_SUPER_ADMIN', v_username, 'Aktivasi akun Super Admin pertama');

  RETURN jsonb_build_object(
    'ok', TRUE,
    'token', v_token,
    'user', jsonb_build_object(
      'id', v_id,
      'username', v_username,
      'fullName', v_full_name,
      'role', 'super_admin',
      'department', 'Semua Bidang'
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_login(p_username TEXT, p_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_username TEXT := TRIM(COALESCE(p_username, ''));
  v_user public.users;
  v_now BIGINT := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
  v_token TEXT;
  v_token_hash TEXT;
BEGIN
  IF v_username = '' OR p_password IS NULL OR p_password = '' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'NIP / Username dan kata sandi wajib diisi.');
  END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE LOWER(username) = LOWER(v_username)
  LIMIT 1;

  IF v_user.id IS NULL OR v_user.is_active <> 1 OR v_user.password_hash <> crypt(p_password, v_user.password_hash) THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'NIP / Username atau kata sandi salah, atau akun tidak aktif.');
  END IF;

  DELETE FROM public.app_sessions WHERE expires_at < v_now;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

  INSERT INTO public.app_sessions (token_hash, user_id, expires_at, created_at)
  VALUES (v_token_hash, v_user.id, v_now + 43200000, v_now);

  PERFORM public._record_audit(v_user.username, v_user.role, 'LOGIN', v_user.username, 'Berhasil masuk ke sistem');

  RETURN jsonb_build_object(
    'ok', TRUE,
    'token', v_token,
    'user', jsonb_build_object(
      'id', v_user.id,
      'username', v_user.username,
      'fullName', v_user.full_name,
      'role', v_user.role,
      'department', COALESCE(NULLIF(v_user.department, ''), 'Semua Bidang')
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_logout(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
  v_hash TEXT;
BEGIN
  v_user := public._verify_app_session(p_token);
  IF v_user.id IS NOT NULL THEN
    PERFORM public._record_audit(v_user.username, v_user.role, 'LOGOUT', v_user.username, 'Keluar dari sistem');
  END IF;

  IF p_token IS NOT NULL AND TRIM(p_token) <> '' THEN
    v_hash := encode(digest(TRIM(p_token), 'sha256'), 'hex');
    DELETE FROM public.app_sessions WHERE token_hash = v_hash;
  END IF;

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_request_password_reset(p_username TEXT, p_note TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_username TEXT := LEFT(TRIM(COALESCE(p_username, '')), 60);
  v_note TEXT := LEFT(TRIM(COALESCE(p_note, '')), 200);
  v_user public.users;
  v_now BIGINT := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
  v_recent BOOLEAN;
  v_support_email TEXT := 'aplikasiserver89@gmail.com';
BEGIN
  IF v_username !~ '^[a-zA-Z0-9._-]{3,60}$' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'NIP / Username wajib diisi (minimal 3 karakter).');
  END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE LOWER(username) = LOWER(v_username) AND is_active = 1
  LIMIT 1;

  IF v_user.id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.password_reset_requests
      WHERE user_id = v_user.id
        AND status IN ('pending', 'token_issued')
        AND created_at > (v_now - 120000)
    ) INTO v_recent;

    IF NOT v_recent THEN
      INSERT INTO public.password_reset_requests (
        id, user_id, username, full_name, role, note, status, created_at
      )
      VALUES (
        gen_random_uuid()::TEXT, v_user.id, v_user.username, v_user.full_name, v_user.role, v_note, 'pending', v_now
      );

      PERFORM public._record_audit(
        v_user.username,
        v_user.role,
        'REQUEST_PASSWORD_RESET',
        v_user.username,
        CASE WHEN v_note <> '' THEN 'Pengajuan lupa password (bantuan email ' || v_support_email || '): ' || v_note
             ELSE 'Mengajukan reset kata sandi (bantuan email ' || v_support_email || ')' END
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'supportEmail', v_support_email,
    'emailSent', FALSE,
    'message', 'Permintaan reset kata sandi telah dicatat untuk Super Admin. Gunakan tombol "Kirim via Email" di bawah untuk meneruskan permintaan langsung ke ' || v_support_email || '.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_complete_password_reset(
  p_username TEXT,
  p_recovery_code TEXT,
  p_new_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_username TEXT := LEFT(TRIM(COALESCE(p_username, '')), 60);
  v_code_norm TEXT := UPPER(regexp_replace(COALESCE(p_recovery_code, ''), '[\s-]+', '', 'g'));
  v_code_hash TEXT;
  v_user public.users;
  v_req_id TEXT;
  v_now BIGINT := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
BEGIN
  IF v_username = '' OR v_code_norm = '' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'NIP / Username dan Kode Pemulihan wajib diisi.');
  END IF;
  IF p_new_password IS NULL OR LENGTH(p_new_password) < 8 OR LENGTH(p_new_password) > 128 THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'Kata sandi baru wajib 8 sampai 128 karakter.');
  END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE LOWER(username) = LOWER(v_username) AND is_active = 1
  LIMIT 1;

  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'NIP / Username atau kode pemulihan tidak valid atau sudah kedaluwarsa.');
  END IF;

  v_code_hash := encode(digest(v_code_norm, 'sha256'), 'hex');

  SELECT id INTO v_req_id
  FROM public.password_reset_requests
  WHERE user_id = v_user.id
    AND status = 'token_issued'
    AND token_hash = v_code_hash
    AND token_expires_at > v_now
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_req_id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'NIP / Username atau kode pemulihan tidak valid atau sudah kedaluwarsa.');
  END IF;

  UPDATE public.users
  SET password_hash = crypt(p_new_password, gen_salt('bf', 10)),
      updated_at = v_now
  WHERE id = v_user.id;

  UPDATE public.password_reset_requests
  SET status = 'completed', token_hash = NULL, resolved_at = v_now
  WHERE user_id = v_user.id AND status IN ('pending', 'token_issued');

  PERFORM public._record_audit(
    v_user.username,
    v_user.role,
    'PASSWORD_RESET_COMPLETED',
    v_user.username,
    'Reset sandi menggunakan kode pemulihan 1x pakai'
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'message', 'Kata sandi berhasil diperbarui. Silakan masuk menggunakan kata sandi baru Anda.'
  );
END;
$$;

-- ============================================================================
-- RPC DASHBOARD & MANAJEMEN KUNJUNGAN (RBAC)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.api_admin_dashboard(
  p_token TEXT,
  p_search TEXT DEFAULT '',
  p_department TEXT DEFAULT '',
  p_status TEXT DEFAULT '',
  p_date_from TEXT DEFAULT '',
  p_date_to TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
  v_now_wib TIMESTAMP := NOW() AT TIME ZONE 'Asia/Jakarta';
  v_today_wib TEXT := to_char(v_now_wib, 'YYYY-MM-DD');
  v_month_prefix TEXT := to_char(v_now_wib, 'YYYY-MM');
  v_month_start TEXT := to_char(v_now_wib, 'YYYY-MM') || '-01';
  v_curr_year TEXT := to_char(v_now_wib, 'YYYY');
  v_year_start TEXT := to_char(v_now_wib, 'YYYY') || '-01-01';
  v_last_year TEXT := (to_char(v_now_wib, 'YYYY')::INTEGER - 1)::TEXT;
  v_last_year_start TEXT := (to_char(v_now_wib, 'YYYY')::INTEGER - 1)::TEXT || '-01-01';
  v_last_year_end TEXT := (to_char(v_now_wib, 'YYYY')::INTEGER - 1)::TEXT || '-12-31';
  v_week_start TEXT := to_char(date_trunc('week', v_now_wib)::DATE, 'YYYY-MM-DD');
  v_scoped_dept TEXT := NULL;
  v_scoped_date TEXT := NULL;
  v_search TEXT := TRIM(COALESCE(p_search, ''));
  v_dept TEXT := TRIM(COALESCE(p_department, ''));
  v_status TEXT := TRIM(COALESCE(p_status, ''));
  v_date_from TEXT := TRIM(COALESCE(p_date_from, ''));
  v_date_to TEXT := TRIM(COALESCE(p_date_to, ''));

  v_today_total INT := 0; v_today_active INT := 0; v_today_done INT := 0;
  v_week_total INT := 0; v_week_active INT := 0; v_week_done INT := 0;
  v_month_total INT := 0; v_month_active INT := 0; v_month_done INT := 0;
  v_year_total INT := 0; v_year_active INT := 0; v_year_done INT := 0;
  v_last_year_total INT := 0; v_last_year_active INT := 0; v_last_year_done INT := 0;
  v_all_total INT := 0; v_all_active INT := 0; v_all_done INT := 0;
  v_active_now INT := 0;
  v_top_dept JSONB := NULL;
  v_visits JSONB;
  v_dept_breakdown JSONB;
  v_cat_breakdown JSONB;
BEGIN
  v_user := public._verify_app_session(p_token);
  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'Sesi login tidak valid atau telah berakhir. Silakan masuk kembali.');
  END IF;
  IF v_user.role NOT IN ('super_admin', 'resepsionis', 'pimpinan') THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 403, 'error', 'Akses ditolak.');
  END IF;

  IF v_user.role = 'pimpinan' AND COALESCE(v_user.department, '') <> '' AND v_user.department <> 'Semua Bidang' THEN
    v_scoped_dept := v_user.department;
  END IF;
  IF v_user.role = 'resepsionis' THEN
    v_scoped_date := v_today_wib;
  END IF;

  -- Hitung statistik periode
  SELECT
    COUNT(*) FILTER (WHERE visit_date = v_today_wib),
    COUNT(*) FILTER (WHERE visit_date = v_today_wib AND status = 'Sedang Berkunjung'),
    COUNT(*) FILTER (WHERE visit_date = v_today_wib AND status = 'Selesai'),
    COUNT(*) FILTER (WHERE visit_date >= v_week_start AND visit_date <= v_today_wib),
    COUNT(*) FILTER (WHERE visit_date >= v_week_start AND visit_date <= v_today_wib AND status = 'Sedang Berkunjung'),
    COUNT(*) FILTER (WHERE visit_date >= v_week_start AND visit_date <= v_today_wib AND status = 'Selesai'),
    COUNT(*) FILTER (WHERE visit_date LIKE v_month_prefix || '%'),
    COUNT(*) FILTER (WHERE visit_date LIKE v_month_prefix || '%' AND status = 'Sedang Berkunjung'),
    COUNT(*) FILTER (WHERE visit_date LIKE v_month_prefix || '%' AND status = 'Selesai'),
    COUNT(*) FILTER (WHERE visit_date >= v_year_start AND visit_date <= v_today_wib),
    COUNT(*) FILTER (WHERE visit_date >= v_year_start AND visit_date <= v_today_wib AND status = 'Sedang Berkunjung'),
    COUNT(*) FILTER (WHERE visit_date >= v_year_start AND visit_date <= v_today_wib AND status = 'Selesai'),
    COUNT(*) FILTER (WHERE visit_date >= v_last_year_start AND visit_date <= v_last_year_end),
    COUNT(*) FILTER (WHERE visit_date >= v_last_year_start AND visit_date <= v_last_year_end AND status = 'Sedang Berkunjung'),
    COUNT(*) FILTER (WHERE visit_date >= v_last_year_start AND visit_date <= v_last_year_end AND status = 'Selesai'),
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'Sedang Berkunjung'),
    COUNT(*) FILTER (WHERE status = 'Selesai')
  INTO
    v_today_total, v_today_active, v_today_done,
    v_week_total, v_week_active, v_week_done,
    v_month_total, v_month_active, v_month_done,
    v_year_total, v_year_active, v_year_done,
    v_last_year_total, v_last_year_active, v_last_year_done,
    v_all_total, v_all_active, v_all_done
  FROM public.visits
  WHERE (v_scoped_dept IS NULL OR department = v_scoped_dept)
    AND (v_scoped_date IS NULL OR visit_date = v_scoped_date);

  IF v_scoped_date IS NOT NULL THEN
    v_week_total := v_today_total; v_week_active := v_today_active; v_week_done := v_today_done;
    v_month_total := v_today_total; v_month_active := v_today_active; v_month_done := v_today_done;
    v_year_total := v_today_total; v_year_active := v_today_active; v_year_done := v_today_done;
    v_last_year_total := 0; v_last_year_active := 0; v_last_year_done := 0;
    v_all_total := v_today_total; v_all_active := v_today_active; v_all_done := v_today_done;
  END IF;

  v_active_now := v_all_active;

  SELECT jsonb_build_object('name', sub.department, 'count', sub.cnt)
  INTO v_top_dept
  FROM (
    SELECT department, COUNT(*)::INT AS cnt
    FROM public.visits
    WHERE visit_date LIKE v_month_prefix || '%'
      AND (v_scoped_dept IS NULL OR department = v_scoped_dept)
    GROUP BY department
    ORDER BY cnt DESC, department ASC
    LIMIT 1
  ) sub;

  IF v_top_dept IS NULL THEN
    SELECT jsonb_build_object('name', sub.department, 'count', sub.cnt)
    INTO v_top_dept
    FROM (
      SELECT department, COUNT(*)::INT AS cnt
      FROM public.visits
      WHERE (v_scoped_dept IS NULL OR department = v_scoped_dept)
      GROUP BY department
      ORDER BY cnt DESC, department ASC
      LIMIT 1
    ) sub;
  END IF;

  -- Daftar kunjungan terfilter
  WITH filtered AS (
    SELECT *
    FROM public.visits
    WHERE (v_search = '' OR (
        full_name ILIKE '%' || v_search || '%'
        OR institution_address ILIKE '%' || v_search || '%'
        OR phone ILIKE '%' || v_search || '%'
        OR queue_code ILIKE '%' || v_search || '%'
      ))
      AND (
        (v_scoped_dept IS NOT NULL AND department = v_scoped_dept)
        OR (v_scoped_dept IS NULL AND (v_dept = '' OR department = v_dept))
      )
      AND (v_status NOT IN ('Sedang Berkunjung', 'Selesai') OR status = v_status)
      AND (
        (v_scoped_date IS NOT NULL AND visit_date = v_scoped_date)
        OR (
          v_scoped_date IS NULL
          AND (v_date_from !~ '^\d{4}-\d{2}-\d{2}$' OR visit_date >= v_date_from)
          AND (v_date_to !~ '^\d{4}-\d{2}-\d{2}$' OR visit_date <= v_date_to)
        )
      )
    ORDER BY check_in_at DESC
    LIMIT 1000
  )
  SELECT
    COALESCE((SELECT jsonb_agg(public._map_visit_json(f) ORDER BY f.check_in_at DESC) FROM filtered f), '[]'::JSONB),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', d.department, 'total', d.cnt) ORDER BY d.cnt DESC, d.department ASC)
      FROM (SELECT department, COUNT(*)::INT AS cnt FROM filtered GROUP BY department) d
    ), '[]'::JSONB),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', c.visitor_category, 'total', c.cnt) ORDER BY c.cnt DESC, c.visitor_category ASC)
      FROM (SELECT visitor_category, COUNT(*)::INT AS cnt FROM filtered GROUP BY visitor_category) c
    ), '[]'::JSONB)
  INTO v_visits, v_dept_breakdown, v_cat_breakdown;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'stats', jsonb_build_object(
      'totalToday', v_today_total,
      'activeNow', v_active_now,
      'totalWeek', v_week_total,
      'totalMonth', v_month_total,
      'totalYear', v_year_total,
      'totalLastYear', v_last_year_total,
      'totalAll', v_all_total,
      'topDepartment', v_top_dept,
      'periodRecap', jsonb_build_array(
        jsonb_build_object('key', 'today', 'label', 'Hari Ini', 'rangeLabel', v_today_wib, 'total', v_today_total, 'active', v_today_active, 'done', v_today_done),
        jsonb_build_object('key', 'week', 'label', 'Minggu Ini', 'rangeLabel', v_week_start || ' s.d. ' || v_today_wib, 'total', v_week_total, 'active', v_week_active, 'done', v_week_done),
        jsonb_build_object('key', 'month', 'label', 'Bulan Ini', 'rangeLabel', v_month_start || ' s.d. ' || v_today_wib, 'total', v_month_total, 'active', v_month_active, 'done', v_month_done),
        jsonb_build_object('key', 'year', 'label', 'Tahun Ini (' || v_curr_year || ')', 'rangeLabel', v_year_start || ' s.d. ' || v_today_wib, 'total', v_year_total, 'active', v_year_active, 'done', v_year_done),
        jsonb_build_object('key', 'last_year', 'label', 'Tahun Lalu (' || v_last_year || ')', 'rangeLabel', v_last_year_start || ' s.d. ' || v_last_year_end, 'total', v_last_year_total, 'active', v_last_year_active, 'done', v_last_year_done),
        jsonb_build_object('key', 'all', 'label', 'Total Keseluruhan', 'rangeLabel', 'Semua Riwayat Tercatat', 'total', v_all_total, 'active', v_all_active, 'done', v_all_done)
      ),
      'departmentBreakdown', v_dept_breakdown,
      'categoryBreakdown', v_cat_breakdown
    ),
    'visits', v_visits
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_admin_manual_visit(
  p_token TEXT,
  p_full_name TEXT,
  p_phone TEXT,
  p_visitor_category TEXT,
  p_institution_address TEXT,
  p_department TEXT,
  p_purpose TEXT,
  p_signature_data TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
  v_res JSONB;
BEGIN
  v_user := public._verify_app_session(p_token);
  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'Sesi login tidak valid atau telah berakhir.');
  END IF;
  IF v_user.role NOT IN ('super_admin', 'resepsionis') THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 403, 'error', 'Akses ditolak.');
  END IF;

  v_res := public.api_submit_visit(
    p_full_name, p_phone, p_visitor_category, p_institution_address, p_department, p_purpose, p_signature_data
  );

  IF COALESCE((v_res->>'ok')::BOOLEAN, FALSE) THEN
    PERFORM public._record_audit(
      v_user.username,
      v_user.role,
      'MANUAL_CHECKIN',
      v_res->'visit'->>'queueCode',
      'Input bantuan petugas untuk ' || TRIM(p_full_name) || ' (' || TRIM(p_department) || ')'
    );
  END IF;

  RETURN v_res;
END;
$$;

CREATE OR REPLACE FUNCTION public.api_admin_update_visit_status(
  p_token TEXT,
  p_visit_id TEXT,
  p_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
  v_visit public.visits;
  v_today_wib TEXT := to_char(NOW() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD');
  v_checkout_at TEXT;
BEGIN
  v_user := public._verify_app_session(p_token);
  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'Sesi login tidak valid atau telah berakhir.');
  END IF;
  IF v_user.role NOT IN ('super_admin', 'resepsionis') THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 403, 'error', 'Akses ditolak.');
  END IF;
  IF p_status NOT IN ('Selesai', 'Sedang Berkunjung') THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'Status kunjungan tidak valid.');
  END IF;

  SELECT * INTO v_visit FROM public.visits WHERE id = p_visit_id;
  IF v_visit.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 404, 'error', 'Data kunjungan tidak ditemukan.');
  END IF;

  IF v_user.role = 'resepsionis' AND v_visit.visit_date <> v_today_wib THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 403, 'error', 'Petugas Resepsionis hanya dapat mengubah status kunjungan hari berjalan.');
  END IF;

  v_checkout_at := CASE WHEN p_status = 'Selesai'
    THEN to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ELSE NULL END;

  UPDATE public.visits
  SET status = p_status, check_out_at = v_checkout_at
  WHERE id = p_visit_id
  RETURNING * INTO v_visit;

  PERFORM public._record_audit(
    v_user.username, v_user.role, 'UPDATE_VISIT_STATUS', v_visit.queue_code,
    'Status ' || v_visit.full_name || ' diubah menjadi ' || p_status
  );

  RETURN jsonb_build_object('ok', TRUE, 'visit', public._map_visit_json(v_visit));
END;
$$;

CREATE OR REPLACE FUNCTION public.api_admin_delete_visit(p_token TEXT, p_visit_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
  v_visit public.visits;
BEGIN
  v_user := public._verify_app_session(p_token);
  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'Sesi login tidak valid atau telah berakhir.');
  END IF;
  IF v_user.role <> 'super_admin' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 403, 'error', 'Akses ditolak. Hanya Super Admin yang dapat menghapus data.');
  END IF;

  SELECT * INTO v_visit FROM public.visits WHERE id = p_visit_id;
  IF v_visit.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 404, 'error', 'Data kunjungan tidak ditemukan.');
  END IF;

  DELETE FROM public.visits WHERE id = p_visit_id;
  PERFORM public._record_audit(v_user.username, v_user.role, 'DELETE_VISIT', v_visit.queue_code, 'Menghapus data kunjungan ' || v_visit.full_name);

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_admin_export_visits(
  p_token TEXT,
  p_search TEXT DEFAULT '',
  p_department TEXT DEFAULT '',
  p_status TEXT DEFAULT '',
  p_date_from TEXT DEFAULT '',
  p_date_to TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
  v_search TEXT := TRIM(COALESCE(p_search, ''));
  v_dept TEXT := TRIM(COALESCE(p_department, ''));
  v_status TEXT := TRIM(COALESCE(p_status, ''));
  v_date_from TEXT := TRIM(COALESCE(p_date_from, ''));
  v_date_to TEXT := TRIM(COALESCE(p_date_to, ''));
  v_rows JSONB;
  v_count INT;
BEGIN
  v_user := public._verify_app_session(p_token);
  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'Sesi login tidak valid atau telah berakhir.');
  END IF;
  IF v_user.role <> 'super_admin' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 403, 'error', 'Akses ditolak.');
  END IF;

  SELECT
    COALESCE(jsonb_agg(public._map_visit_json(v) ORDER BY v.check_in_at DESC), '[]'::JSONB),
    COUNT(*)::INT
  INTO v_rows, v_count
  FROM public.visits v
  WHERE (v_search = '' OR (
      v.full_name ILIKE '%' || v_search || '%'
      OR v.institution_address ILIKE '%' || v_search || '%'
      OR v.phone ILIKE '%' || v_search || '%'
      OR v.queue_code ILIKE '%' || v_search || '%'
    ))
    AND (v_dept = '' OR v.department = v_dept)
    AND (v_status NOT IN ('Sedang Berkunjung', 'Selesai') OR v.status = v_status)
    AND (v_date_from !~ '^\d{4}-\d{2}-\d{2}$' OR v.visit_date >= v_date_from)
    AND (v_date_to !~ '^\d{4}-\d{2}-\d{2}$' OR v.visit_date <= v_date_to);

  PERFORM public._record_audit(
    v_user.username, v_user.role, 'EXPORT_CSV', 'laporan-buku-tamu',
    'Mengunduh ' || v_count || ' baris rekap CSV'
  );

  RETURN jsonb_build_object('ok', TRUE, 'visits', v_rows);
END;
$$;

-- ============================================================================
-- RPC MASTER BIDANG, AKUN RBAC, RESET PASSWORD & LOG AUDIT (SUPER ADMIN)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.api_admin_list_departments(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
  v_items JSONB;
BEGIN
  v_user := public._verify_app_session(p_token);
  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'Sesi login tidak valid atau telah berakhir.');
  END IF;
  IF v_user.role <> 'super_admin' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 403, 'error', 'Akses ditolak.');
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('id', d.id, 'name', d.name, 'isActive', (d.is_active = 1), 'sortOrder', d.sort_order)
      ORDER BY d.sort_order ASC, d.name ASC
    ),
    '[]'::JSONB
  )
  INTO v_items
  FROM public.departments d;

  RETURN jsonb_build_object('ok', TRUE, 'departments', v_items);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_admin_create_department(p_token TEXT, p_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
  v_name TEXT := LEFT(TRIM(COALESCE(p_name, '')), 100);
  v_exists BOOLEAN;
  v_max_sort INT;
  v_id TEXT := gen_random_uuid()::TEXT;
BEGIN
  v_user := public._verify_app_session(p_token);
  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'Sesi login tidak valid atau telah berakhir.');
  END IF;
  IF v_user.role <> 'super_admin' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 403, 'error', 'Akses ditolak.');
  END IF;
  IF LENGTH(v_name) < 3 THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'Nama bidang minimal 3 karakter.');
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.departments WHERE LOWER(name) = LOWER(v_name)) INTO v_exists;
  IF v_exists THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 409, 'error', 'Nama bidang tersebut sudah ada.');
  END IF;

  SELECT COALESCE(MAX(sort_order), 0) INTO v_max_sort FROM public.departments;
  INSERT INTO public.departments (id, name, is_active, sort_order, created_at)
  VALUES (v_id, v_name, 1, v_max_sort + 1, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT);

  PERFORM public._record_audit(v_user.username, v_user.role, 'ADD_DEPARTMENT', v_name, 'Menambahkan master bidang baru');

  RETURN jsonb_build_object('ok', TRUE, 'department', jsonb_build_object('id', v_id, 'name', v_name, 'isActive', TRUE, 'sortOrder', v_max_sort + 1));
END;
$$;

CREATE OR REPLACE FUNCTION public.api_admin_update_department(
  p_token TEXT,
  p_id TEXT,
  p_name TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
  v_dept public.departments;
  v_next_name TEXT;
  v_next_active INT;
  v_other_active INT;
BEGIN
  v_user := public._verify_app_session(p_token);
  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'Sesi login tidak valid atau telah berakhir.');
  END IF;
  IF v_user.role <> 'super_admin' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 403, 'error', 'Akses ditolak.');
  END IF;

  SELECT * INTO v_dept FROM public.departments WHERE id = p_id;
  IF v_dept.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 404, 'error', 'Bidang tidak ditemukan.');
  END IF;

  v_next_name := CASE WHEN p_name IS NOT NULL AND LENGTH(TRIM(p_name)) >= 3 THEN LEFT(TRIM(p_name), 100) ELSE v_dept.name END;
  v_next_active := CASE WHEN p_is_active IS NOT NULL THEN (CASE WHEN p_is_active THEN 1 ELSE 0 END) ELSE v_dept.is_active END;

  IF v_next_active = 0 THEN
    SELECT COUNT(*) INTO v_other_active FROM public.departments WHERE is_active = 1 AND id <> p_id;
    IF v_other_active = 0 THEN
      RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'Minimal harus ada 1 bidang yang tetap aktif.');
    END IF;
  END IF;

  UPDATE public.departments SET name = v_next_name, is_active = v_next_active WHERE id = p_id;
  PERFORM public._record_audit(
    v_user.username, v_user.role, 'UPDATE_DEPARTMENT', v_next_name,
    'Status aktif: ' || CASE WHEN v_next_active = 1 THEN 'Aktif' ELSE 'Nonaktif' END
  );

  RETURN jsonb_build_object('ok', TRUE, 'department', jsonb_build_object('id', p_id, 'name', v_next_name, 'isActive', (v_next_active = 1), 'sortOrder', v_dept.sort_order));
END;
$$;

CREATE OR REPLACE FUNCTION public.api_admin_list_users(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
  v_items JSONB;
BEGIN
  v_user := public._verify_app_session(p_token);
  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'Sesi login tidak valid atau telah berakhir.');
  END IF;
  IF v_user.role <> 'super_admin' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 403, 'error', 'Akses ditolak.');
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', u.id,
        'username', u.username,
        'fullName', u.full_name,
        'role', u.role,
        'department', u.department,
        'isActive', (u.is_active = 1),
        'createdAt', u.created_at
      )
      ORDER BY u.created_at DESC
    ),
    '[]'::JSONB
  )
  INTO v_items
  FROM public.users u;

  RETURN jsonb_build_object('ok', TRUE, 'users', v_items);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_admin_create_user(
  p_token TEXT,
  p_username TEXT,
  p_full_name TEXT,
  p_role TEXT,
  p_department TEXT,
  p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor public.users;
  v_username TEXT := LEFT(TRIM(COALESCE(p_username, '')), 60);
  v_full_name TEXT := LEFT(TRIM(COALESCE(p_full_name, '')), 120);
  v_role TEXT := TRIM(COALESCE(p_role, ''));
  v_dept TEXT;
  v_exists BOOLEAN;
  v_id TEXT := gen_random_uuid()::TEXT;
  v_now BIGINT := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
BEGIN
  v_actor := public._verify_app_session(p_token);
  IF v_actor.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'Sesi login tidak valid atau telah berakhir.');
  END IF;
  IF v_actor.role <> 'super_admin' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 403, 'error', 'Akses ditolak.');
  END IF;

  IF v_username !~ '^[a-zA-Z0-9._-]{3,60}$' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'NIP / Username wajib 3-60 karakter (huruf, angka, titik, atau garis bawah).');
  END IF;
  IF LENGTH(v_full_name) < 2 THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'Nama lengkap wajib diisi.');
  END IF;
  IF v_role NOT IN ('super_admin', 'resepsionis', 'pimpinan') THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'Peran RBAC tidak valid.');
  END IF;
  IF p_password IS NULL OR LENGTH(p_password) < 8 OR LENGTH(p_password) > 128 THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'Kata sandi wajib 8 sampai 128 karakter.');
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.users WHERE LOWER(username) = LOWER(v_username)) INTO v_exists;
  IF v_exists THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 409, 'error', 'NIP / Username tersebut sudah terdaftar.');
  END IF;

  v_dept := CASE WHEN v_role = 'pimpinan' THEN COALESCE(NULLIF(LEFT(TRIM(COALESCE(p_department, '')), 100), ''), 'Semua Bidang') ELSE 'Semua Bidang' END;

  INSERT INTO public.users (id, username, full_name, role, department, password_hash, is_active, created_at, updated_at)
  VALUES (v_id, v_username, v_full_name, v_role, v_dept, crypt(p_password, gen_salt('bf', 10)), 1, v_now, v_now);

  PERFORM public._record_audit(
    v_actor.username, v_actor.role, 'CREATE_USER', v_username,
    'Membuat akun ' || v_full_name || ' dengan peran ' || v_role || ' (' || v_dept || ')'
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'user', jsonb_build_object(
      'id', v_id, 'username', v_username, 'fullName', v_full_name,
      'role', v_role, 'department', v_dept, 'isActive', TRUE, 'createdAt', v_now
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_admin_update_user(
  p_token TEXT,
  p_id TEXT,
  p_role TEXT DEFAULT NULL,
  p_department TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL,
  p_new_password TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor public.users;
  v_target public.users;
  v_next_role TEXT;
  v_next_dept TEXT;
  v_next_active INT;
  v_other_admins INT;
  v_next_hash TEXT;
  v_now BIGINT := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
BEGIN
  v_actor := public._verify_app_session(p_token);
  IF v_actor.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'Sesi login tidak valid atau telah berakhir.');
  END IF;
  IF v_actor.role <> 'super_admin' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 403, 'error', 'Akses ditolak.');
  END IF;

  SELECT * INTO v_target FROM public.users WHERE id = p_id;
  IF v_target.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 404, 'error', 'Akun pengguna tidak ditemukan.');
  END IF;

  v_next_role := CASE WHEN p_role IN ('super_admin', 'resepsionis', 'pimpinan') THEN p_role ELSE v_target.role END;
  v_next_dept := CASE WHEN v_next_role = 'pimpinan'
    THEN COALESCE(NULLIF(LEFT(TRIM(COALESCE(p_department, '')), 100), ''), NULLIF(v_target.department, ''), 'Semua Bidang')
    ELSE 'Semua Bidang' END;
  v_next_active := CASE WHEN p_is_active IS NOT NULL THEN (CASE WHEN p_is_active THEN 1 ELSE 0 END) ELSE v_target.is_active END;

  IF v_target.id = v_actor.id AND (v_next_active = 0 OR v_next_role <> 'super_admin') THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'Anda tidak dapat menonaktifkan atau menurunkan peran akun Anda sendiri.');
  END IF;

  IF v_target.role = 'super_admin' AND (v_next_active = 0 OR v_next_role <> 'super_admin') THEN
    SELECT COUNT(*) INTO v_other_admins FROM public.users WHERE role = 'super_admin' AND is_active = 1 AND id <> p_id;
    IF v_other_admins = 0 THEN
      RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'Minimal harus ada 1 akun Super Admin yang tetap aktif.');
    END IF;
  END IF;

  v_next_hash := v_target.password_hash;
  IF p_new_password IS NOT NULL AND p_new_password <> '' THEN
    IF LENGTH(p_new_password) < 8 OR LENGTH(p_new_password) > 128 THEN
      RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'Kata sandi baru wajib 8 sampai 128 karakter.');
    END IF;
    v_next_hash := crypt(p_new_password, gen_salt('bf', 10));
  END IF;

  UPDATE public.users
  SET role = v_next_role, department = v_next_dept, is_active = v_next_active, password_hash = v_next_hash, updated_at = v_now
  WHERE id = p_id;

  IF p_new_password IS NOT NULL AND p_new_password <> '' THEN
    UPDATE public.password_reset_requests
    SET status = 'completed', token_hash = NULL, resolved_at = v_now
    WHERE user_id = p_id AND status IN ('pending', 'token_issued');
  END IF;

  PERFORM public._record_audit(
    v_actor.username, v_actor.role, 'UPDATE_USER', v_target.username,
    'Role: ' || v_next_role || ', Bidang: ' || v_next_dept || ', Aktif: ' || (v_next_active = 1)::TEXT ||
    CASE WHEN p_new_password IS NOT NULL AND p_new_password <> '' THEN ', Reset Sandi' ELSE '' END
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'user', jsonb_build_object(
      'id', v_target.id, 'username', v_target.username, 'fullName', v_target.full_name,
      'role', v_next_role, 'department', v_next_dept, 'isActive', (v_next_active = 1), 'createdAt', v_target.created_at
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_admin_list_reset_requests(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor public.users;
  v_items JSONB;
BEGIN
  v_actor := public._verify_app_session(p_token);
  IF v_actor.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'Sesi login tidak valid atau telah berakhir.');
  END IF;
  IF v_actor.role <> 'super_admin' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 403, 'error', 'Akses ditolak.');
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id, 'userId', r.user_id, 'username', r.username, 'fullName', r.full_name,
        'role', r.role, 'note', r.note, 'status', r.status,
        'tokenExpiresAt', r.token_expires_at, 'createdAt', r.created_at, 'resolvedAt', r.resolved_at
      )
      ORDER BY CASE WHEN r.status IN ('pending', 'token_issued') THEN 0 ELSE 1 END, r.created_at DESC
    ),
    '[]'::JSONB
  )
  INTO v_items
  FROM (SELECT * FROM public.password_reset_requests ORDER BY created_at DESC LIMIT 50) r;

  RETURN jsonb_build_object('ok', TRUE, 'requests', v_items);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_admin_issue_reset_token(p_token TEXT, p_request_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor public.users;
  v_req public.password_reset_requests;
  v_raw TEXT := UPPER(encode(gen_random_bytes(5), 'hex'));
  v_recovery_code TEXT := SUBSTR(v_raw, 1, 5) || '-' || SUBSTR(v_raw, 6, 5);
  v_token_hash TEXT := encode(digest(v_raw, 'sha256'), 'hex');
  v_expires_at BIGINT := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT + 900000;
BEGIN
  v_actor := public._verify_app_session(p_token);
  IF v_actor.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'Sesi login tidak valid atau telah berakhir.');
  END IF;
  IF v_actor.role <> 'super_admin' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 403, 'error', 'Akses ditolak.');
  END IF;

  SELECT * INTO v_req FROM public.password_reset_requests WHERE id = p_request_id;
  IF v_req.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 404, 'error', 'Permintaan reset password tidak ditemukan.');
  END IF;

  UPDATE public.password_reset_requests
  SET status = 'token_issued', token_hash = v_token_hash, token_expires_at = v_expires_at
  WHERE id = p_request_id;

  PERFORM public._record_audit(
    v_actor.username, v_actor.role, 'ISSUE_RECOVERY_TOKEN', v_req.username,
    'Menerbitkan kode pemulihan 1x pakai (berlaku 15 menit)'
  );

  RETURN jsonb_build_object('ok', TRUE, 'recoveryCode', v_recovery_code, 'expiresAt', v_expires_at, 'username', v_req.username);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_admin_dismiss_reset_request(p_token TEXT, p_request_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor public.users;
  v_req public.password_reset_requests;
  v_now BIGINT := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
BEGIN
  v_actor := public._verify_app_session(p_token);
  IF v_actor.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'Sesi login tidak valid atau telah berakhir.');
  END IF;
  IF v_actor.role <> 'super_admin' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 403, 'error', 'Akses ditolak.');
  END IF;

  SELECT * INTO v_req FROM public.password_reset_requests WHERE id = p_request_id;
  IF v_req.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 404, 'error', 'Permintaan reset password tidak ditemukan.');
  END IF;

  UPDATE public.password_reset_requests
  SET status = 'rejected', token_hash = NULL, resolved_at = v_now
  WHERE id = p_request_id;

  PERFORM public._record_audit(
    v_actor.username, v_actor.role, 'DISMISS_PASSWORD_RESET', v_req.username,
    'Menutup/menolak permintaan reset kata sandi'
  );

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_admin_list_audit_logs(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor public.users;
  v_items JSONB;
BEGIN
  v_actor := public._verify_app_session(p_token);
  IF v_actor.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'Sesi login tidak valid atau telah berakhir.');
  END IF;
  IF v_actor.role <> 'super_admin' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 403, 'error', 'Akses ditolak.');
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', l.id, 'actorUsername', l.actor_username, 'actorRole', l.actor_role,
        'action', l.action, 'target', l.target, 'details', l.details, 'createdAt', l.created_at
      )
      ORDER BY l.created_at DESC
    ),
    '[]'::JSONB
  )
  INTO v_items
  FROM (SELECT * FROM public.audit_logs ORDER BY created_at DESC LIMIT 200) l;

  RETURN jsonb_build_object('ok', TRUE, 'logs', v_items);
END;
$$;

-- ============================================================================
-- RPC BACKUP & IMPORT DATA (SUPER ADMIN ONLY)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.api_admin_export_backup(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor public.users;
  v_departments JSONB;
  v_visits JSONB;
  v_dept_count INT := 0;
  v_visit_count INT := 0;
BEGIN
  v_actor := public._verify_app_session(p_token);
  IF v_actor.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'Sesi login tidak valid atau telah berakhir.');
  END IF;
  IF v_actor.role <> 'super_admin' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 403, 'error', 'Akses ditolak. Hanya Super Admin yang dapat melakukan backup data.');
  END IF;

  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', d.id,
          'name', d.name,
          'isActive', (d.is_active = 1),
          'sortOrder', d.sort_order
        )
        ORDER BY d.sort_order ASC, d.name ASC
      ),
      '[]'::JSONB
    ),
    COUNT(*)::INT
  INTO v_departments, v_dept_count
  FROM public.departments d;

  SELECT
    COALESCE(
      jsonb_agg(public._map_visit_json(v) ORDER BY v.visit_date ASC, v.queue_number ASC, v.check_in_at ASC),
      '[]'::JSONB
    ),
    COUNT(*)::INT
  INTO v_visits, v_visit_count
  FROM public.visits v;

  PERFORM public._record_audit(
    v_actor.username,
    v_actor.role,
    'EXPORT_BACKUP',
    'backup-si-tamu-bpbd',
    'Mengekspor cadangan ' || v_dept_count || ' bidang dan ' || v_visit_count || ' kunjungan'
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'format', 'si-tamu-bpbd-backup',
    'version', 1,
    'exportedAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'exportedBy', v_actor.username,
    'departments', v_departments,
    'visits', v_visits
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_admin_import_backup(
  p_token TEXT,
  p_backup JSONB,
  p_conflict_mode TEXT DEFAULT 'skip'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor public.users;
  v_mode TEXT := CASE WHEN p_conflict_mode = 'overwrite' THEN 'overwrite' ELSE 'skip' END;
  v_depts JSONB;
  v_visits JSONB;
  v_item JSONB;
  v_now BIGINT := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;

  v_dept_added INT := 0;
  v_dept_updated INT := 0;
  v_dept_skipped INT := 0;
  v_visit_added INT := 0;
  v_visit_updated INT := 0;
  v_visit_skipped INT := 0;

  v_dept_id TEXT;
  v_dept_name TEXT;
  v_dept_active INT;
  v_dept_sort INT;
  v_existing_dept public.departments;
  v_name_conflict_id TEXT;

  v_visit_id TEXT;
  v_queue_num INT;
  v_queue_code TEXT;
  v_visit_date TEXT;
  v_full_name TEXT;
  v_phone TEXT;
  v_category TEXT;
  v_inst TEXT;
  v_dept TEXT;
  v_purpose TEXT;
  v_sig TEXT;
  v_status TEXT;
  v_check_in_at TEXT;
  v_check_out_at TEXT;
  v_existing_visit_id TEXT;
  v_token_hash TEXT;
BEGIN
  v_actor := public._verify_app_session(p_token);
  IF v_actor.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 401, 'error', 'Sesi login tidak valid atau telah berakhir.');
  END IF;
  IF v_actor.role <> 'super_admin' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 403, 'error', 'Akses ditolak. Hanya Super Admin yang dapat mengimpor data.');
  END IF;

  IF p_backup IS NULL OR jsonb_typeof(p_backup) <> 'object' OR COALESCE(p_backup->>'format', '') <> 'si-tamu-bpbd-backup' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'File bukan format backup resmi SI-TAMU BPBD.');
  END IF;

  v_depts := COALESCE(p_backup->'departments', '[]'::JSONB);
  v_visits := COALESCE(p_backup->'visits', '[]'::JSONB);

  IF jsonb_typeof(v_depts) <> 'array' OR jsonb_typeof(v_visits) <> 'array' THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'Struktur data departments/visits pada file backup tidak valid.');
  END IF;

  IF jsonb_array_length(v_depts) > 500 OR jsonb_array_length(v_visits) > 20000 THEN
    RETURN jsonb_build_object('ok', FALSE, 'status', 400, 'error', 'Jumlah data melebihi batas maksimal impor.');
  END IF;

  -- 1. Import Master Bidang Tujuan
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_depts)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      CONTINUE;
    END IF;

    v_dept_name := LEFT(TRIM(COALESCE(v_item->>'name', '')), 100);
    IF LENGTH(v_dept_name) < 2 THEN
      v_dept_skipped := v_dept_skipped + 1;
      CONTINUE;
    END IF;

    v_dept_id := COALESCE(NULLIF(LEFT(TRIM(COALESCE(v_item->>'id', '')), 80), ''), gen_random_uuid()::TEXT);
    v_dept_active := CASE WHEN COALESCE((v_item->>'isActive')::BOOLEAN, TRUE) THEN 1 ELSE 0 END;
    v_dept_sort := CASE WHEN COALESCE(v_item->>'sortOrder', '') ~ '^-?\d{1,5}$' THEN (v_item->>'sortOrder')::INT ELSE 1 END;

    SELECT * INTO v_existing_dept
    FROM public.departments
    WHERE id = v_dept_id OR LOWER(name) = LOWER(v_dept_name)
    ORDER BY CASE WHEN id = v_dept_id THEN 0 ELSE 1 END
    LIMIT 1;

    IF v_existing_dept.id IS NULL THEN
      INSERT INTO public.departments (id, name, is_active, sort_order, created_at)
      VALUES (v_dept_id, v_dept_name, v_dept_active, v_dept_sort, v_now);
      v_dept_added := v_dept_added + 1;
    ELSIF v_mode = 'overwrite' THEN
      SELECT id INTO v_name_conflict_id
      FROM public.departments
      WHERE LOWER(name) = LOWER(v_dept_name) AND id <> v_existing_dept.id
      LIMIT 1;

      UPDATE public.departments
      SET name = CASE WHEN v_name_conflict_id IS NULL THEN v_dept_name ELSE name END,
          is_active = v_dept_active,
          sort_order = v_dept_sort
      WHERE id = v_existing_dept.id;
      v_dept_updated := v_dept_updated + 1;
    ELSE
      v_dept_skipped := v_dept_skipped + 1;
    END IF;
  END LOOP;

  -- 2. Import Data Kunjungan Tamu
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_visits)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      CONTINUE;
    END IF;

    v_full_name := LEFT(TRIM(COALESCE(v_item->>'fullName', '')), 120);
    v_visit_date := LEFT(TRIM(COALESCE(v_item->>'visitDate', '')), 10);
    v_dept := LEFT(TRIM(COALESCE(v_item->>'department', '')), 100);
    v_sig := TRIM(COALESCE(v_item->>'signatureData', ''));

    IF LENGTH(v_full_name) < 2 OR v_visit_date !~ '^\d{4}-\d{2}-\d{2}$' OR v_dept = '' OR LEFT(v_sig, 22) <> 'data:image/png;base64,' OR LENGTH(v_sig) > 350000 THEN
      v_visit_skipped := v_visit_skipped + 1;
      CONTINUE;
    END IF;

    v_visit_id := COALESCE(NULLIF(LEFT(TRIM(COALESCE(v_item->>'id', '')), 80), ''), gen_random_uuid()::TEXT);
    v_queue_num := CASE WHEN COALESCE(v_item->>'queueNumber', '') ~ '^\d{1,6}$' THEN GREATEST((v_item->>'queueNumber')::INT, 1) ELSE 1 END;
    v_queue_code := COALESCE(NULLIF(LEFT(TRIM(COALESCE(v_item->>'queueCode', '')), 20), ''), 'T-' || LPAD(v_queue_num::TEXT, 3, '0'));
    v_phone := COALESCE(NULLIF(LEFT(TRIM(COALESCE(v_item->>'phone', '')), 24), ''), '-');
    v_category := LEFT(TRIM(COALESCE(v_item->>'visitorCategory', '')), 60);
    IF v_category NOT IN ('Masyarakat Umum', 'Instansi Pemerintah/OPD', 'TNI/Polri', 'Relawan/Komunitas', 'Swasta/Media') THEN
      v_category := 'Masyarakat Umum';
    END IF;
    v_inst := COALESCE(NULLIF(LEFT(TRIM(COALESCE(v_item->>'institutionAddress', '')), 200), ''), '-');
    v_purpose := COALESCE(NULLIF(LEFT(TRIM(COALESCE(v_item->>'purpose', '')), 500), ''), '-');
    v_status := CASE WHEN (v_item->>'status') = 'Selesai' THEN 'Selesai' ELSE 'Sedang Berkunjung' END;
    v_check_in_at := COALESCE(NULLIF(LEFT(TRIM(COALESCE(v_item->>'checkInAt', '')), 40), ''), v_visit_date || 'T08:00:00.000Z');
    v_check_out_at := CASE WHEN v_status = 'Selesai'
      THEN COALESCE(NULLIF(LEFT(TRIM(COALESCE(v_item->>'checkOutAt', '')), 40), ''), v_check_in_at)
      ELSE NULL END;

    SELECT id INTO v_existing_visit_id FROM public.visits WHERE id = v_visit_id;

    IF v_existing_visit_id IS NULL THEN
      v_token_hash := encode(digest(encode(gen_random_bytes(24), 'hex'), 'sha256'), 'hex');
      INSERT INTO public.visits (
        id, queue_number, queue_code, visit_date, full_name, phone,
        visitor_category, institution_address, department, official_name,
        purpose, signature_data, status, check_in_at, check_out_at,
        checkout_token_hash, created_at
      )
      VALUES (
        v_visit_id, v_queue_num, v_queue_code, v_visit_date, v_full_name, v_phone,
        v_category, v_inst, v_dept, NULL,
        v_purpose, v_sig, v_status, v_check_in_at, v_check_out_at,
        v_token_hash, v_now
      );
      v_visit_added := v_visit_added + 1;
    ELSIF v_mode = 'overwrite' THEN
      UPDATE public.visits
      SET queue_number = v_queue_num,
          queue_code = v_queue_code,
          visit_date = v_visit_date,
          full_name = v_full_name,
          phone = v_phone,
          visitor_category = v_category,
          institution_address = v_inst,
          department = v_dept,
          purpose = v_purpose,
          signature_data = v_sig,
          status = v_status,
          check_in_at = v_check_in_at,
          check_out_at = v_check_out_at
      WHERE id = v_visit_id;
      v_visit_updated := v_visit_updated + 1;
    ELSE
      v_visit_skipped := v_visit_skipped + 1;
    END IF;

    INSERT INTO public.daily_counters (visit_date, last_number)
    VALUES (v_visit_date, v_queue_num)
    ON CONFLICT (visit_date)
    DO UPDATE SET last_number = GREATEST(public.daily_counters.last_number, EXCLUDED.last_number);
  END LOOP;

  PERFORM public._record_audit(
    v_actor.username,
    v_actor.role,
    'IMPORT_BACKUP',
    'backup-si-tamu-bpbd',
    'Import (' || v_mode || '): +' || v_dept_added || ' bidang, +' || v_visit_added || ' kunjungan, ' || v_visit_updated || ' diperbarui'
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'summary', jsonb_build_object(
      'departmentsAdded', v_dept_added,
      'departmentsUpdated', v_dept_updated,
      'departmentsSkipped', v_dept_skipped,
      'visitsAdded', v_visit_added,
      'visitsUpdated', v_visit_updated,
      'visitsSkipped', v_visit_skipped
    )
  );
END;
$$;

-- Izinkan pemanggilan RPC aman dari klien browser (anon/authenticated) & service_role
GRANT EXECUTE ON FUNCTION public.api_get_public_departments() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_submit_visit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_get_visit_receipt(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_checkout_visit(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_auth_status() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_bootstrap_super_admin(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_login(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_logout(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_request_password_reset(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_complete_password_reset(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_admin_dashboard(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_admin_manual_visit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_admin_update_visit_status(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_admin_delete_visit(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_admin_export_visits(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_admin_list_departments(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_admin_create_department(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_admin_update_department(TEXT, TEXT, TEXT, BOOLEAN) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_admin_list_users(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_admin_create_user(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_admin_update_user(TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_admin_list_reset_requests(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_admin_issue_reset_token(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_admin_dismiss_reset_request(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_admin_list_audit_logs(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_admin_export_backup(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_admin_import_backup(TEXT, JSONB, TEXT) TO anon, authenticated, service_role;
