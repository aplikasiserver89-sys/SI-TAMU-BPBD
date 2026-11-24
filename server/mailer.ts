import nodemailer from 'nodemailer';

export function getSupportResetEmail(): string {
  const configured = process.env.RESET_NOTIFY_EMAIL?.trim();
  return configured && configured.includes('@') ? configured : 'aplikasiserver89@gmail.com';
}

export function isSmtpConfigured(): boolean {
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  return Boolean(user && pass);
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendPasswordResetEmail(params: {
  username: string;
  fullName: string;
  role: string;
  note: string;
  recoveryCode: string;
  requestedAtWib: string;
}): Promise<{ sent: boolean; recipient: string }> {
  const recipient = getSupportResetEmail();
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.trim();
  const smtpHost = process.env.SMTP_HOST?.trim() || 'smtp.gmail.com';
  const smtpPort = Number(process.env.SMTP_PORT || '465') || 465;

  if (!smtpUser || !smtpPass) {
    return { sent: false, recipient };
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  const safeUsername = escapeHtml(params.username);
  const safeFullName = escapeHtml(params.fullName);
  const safeRole = escapeHtml(params.role);
  const safeNote = escapeHtml(params.note || '-');
  const safeCode = escapeHtml(params.recoveryCode);
  const safeTime = escapeHtml(params.requestedAtWib);

  const textBody = [
    'SI-TAMU BPBD KABUPATEN SIDOARJO',
    'Permintaan Reset Kata Sandi Internal',
    '----------------------------------------',
    `NIP / Username : ${params.username}`,
    `Nama Lengkap   : ${params.fullName}`,
    `Peran RBAC     : ${params.role}`,
    `Keterangan     : ${params.note || '-'}`,
    `Waktu Pengajuan: ${params.requestedAtWib}`,
    '',
    `Kode Pemulihan 1x Pakai (Berlaku 15 Menit): ${params.recoveryCode}`,
    '',
    'Berikan kode ini kepada pegawai terkait atau gunakan pada tab "2. Pakai Kode Pemulihan" di Portal Masuk Internal.',
  ].join('\n');

  const htmlBody = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #0F172A; max-width: 560px; margin: 0 auto; border: 1px solid #CBD5E1; border-radius: 12px; overflow: hidden;">
      <div style="background: #0F294A; color: #FFFFFF; padding: 18px 22px; border-bottom: 4px solid #EA580C;">
        <div style="font-size: 11px; color: #FDBA74; font-weight: bold;">BPBD KABUPATEN SIDOARJO</div>
        <div style="font-size: 17px; font-weight: bold; margin-top: 4px;">Permintaan Reset Kata Sandi SI-TAMU BPBD</div>
      </div>
      <div style="padding: 20px 22px; background: #FFFFFF; font-size: 14px; line-height: 1.6;">
        <p style="margin-top: 0;">Terdapat pengajuan lupa kata sandi akun internal:</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin: 12px 0;">
          <tr><td style="padding: 6px 0; color: #64748B; width: 140px;">NIP / Username</td><td style="padding: 6px 0; font-weight: bold;">${safeUsername}</td></tr>
          <tr><td style="padding: 6px 0; color: #64748B;">Nama Pegawai</td><td style="padding: 6px 0; font-weight: bold;">${safeFullName}</td></tr>
          <tr><td style="padding: 6px 0; color: #64748B;">Peran RBAC</td><td style="padding: 6px 0;">${safeRole}</td></tr>
          <tr><td style="padding: 6px 0; color: #64748B;">Keterangan</td><td style="padding: 6px 0;">${safeNote}</td></tr>
          <tr><td style="padding: 6px 0; color: #64748B;">Waktu Pengajuan</td><td style="padding: 6px 0;">${safeTime}</td></tr>
        </table>
        <div style="margin: 18px 0; padding: 14px 16px; background: #FFF7ED; border: 1px solid #FDBA74; border-radius: 10px; text-align: center;">
          <div style="font-size: 12px; color: #9A3412; font-weight: bold;">Kode Pemulihan 1x Pakai (Berlaku 15 Menit)</div>
          <div style="font-size: 24px; font-weight: bold; letter-spacing: 3px; color: #EA580C; margin-top: 6px;">${safeCode}</div>
        </div>
        <p style="font-size: 12px; color: #475569; margin-bottom: 0;">
          Masukkan kode di atas pada menu <strong>Lupa Kata Sandi? &rarr; 2. Pakai Kode Pemulihan</strong> di Portal Masuk Internal, atau kelola permintaan melalui tab <strong>Akun &amp; RBAC</strong>.
        </p>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"SI-TAMU BPBD Sidoarjo" <${smtpUser}>`,
      to: recipient,
      subject: `[SI-TAMU BPBD] Permintaan Reset Kata Sandi - ${params.username}`,
      text: textBody,
      html: htmlBody,
    });
    return { sent: true, recipient };
  } catch (err) {
    console.error('Failed to send password reset email:', err);
    return { sent: false, recipient };
  }
}
