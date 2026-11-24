import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { DashboardStats, VisitRecord } from '../types';
import { formatIndonesianDate, formatShortDate, formatWibTime, getTodayWib } from './format';
import { BPBD_EMBLEM_SRC, SIDOARJO_LOGO_SRC } from '../components/BpbdEmblem';

async function loadImageAsPngDataUrl(src: string, circularCrop = false): Promise<string | null> {
  if (!src) return null;
  if (src.startsWith('data:image/png')) return src;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (val: string | null) => {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };
    const timer = window.setTimeout(() => finish(null), 3000);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      window.clearTimeout(timer);
      try {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          finish(null);
          return;
        }
        if (circularCrop) {
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.save();
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, size / 2 - 10, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(img, 10, 10, size - 20, size - 20);
          ctx.restore();
        } else {
          const scale = Math.min(size / img.width, size / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        }
        finish(canvas.toDataURL('image/png'));
      } catch {
        finish(null);
      }
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      finish(null);
    };
    img.src = src;
  });
}

function triggerPdfDownload(doc: jsPDF, filename: string): void {
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function downloadVisitReceiptPdf(visit: VisitRecord): Promise<void> {
  const [sidoarjoPng, bpbdPng] = await Promise.all([
    loadImageAsPngDataUrl(SIDOARJO_LOGO_SRC, false),
    loadImageAsPngDataUrl(BPBD_EMBLEM_SRC, true),
  ]);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;

  // Outer card frame
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.4);
  doc.roundedRect(margin, 14, contentWidth, 195, 4, 4, 'S');

  // Navy header block
  doc.setFillColor(15, 41, 74);
  doc.rect(margin, 14, contentWidth, 36, 'F');
  // Orange bottom border under header
  doc.setFillColor(234, 88, 12);
  doc.rect(margin, 50, contentWidth, 2, 'F');

  if (sidoarjoPng) {
    doc.addImage(sidoarjoPng, 'PNG', margin + 6, 19, 22, 22);
  }
  if (bpbdPng) {
    doc.addImage(bpbdPng, 'PNG', pageWidth - margin - 28, 19, 22, 22);
  }

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(253, 186, 116);
  doc.setFontSize(8.5);
  doc.text('PEMERINTAH KABUPATEN SIDOARJO', pageWidth / 2, 24, { align: 'center' });

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.text('KARTU BUKTI REGISTRASI KUNJUNGAN', pageWidth / 2, 32, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(203, 213, 225);
  doc.setFontSize(9.5);
  doc.text('BPBD Kabupaten Sidoarjo · SI-TAMU BPBD', pageWidth / 2, 39, { align: 'center' });

  // Queue number highlight band
  doc.setFillColor(248, 250, 252);
  doc.rect(margin + 0.5, 52, contentWidth - 1, 22, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.line(margin, 74, pageWidth - margin, 74);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 41, 74);
  doc.setFontSize(10);
  doc.text('NOMOR URUT KUNJUNGAN', margin + 8, 61);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.setFontSize(9);
  doc.text(
    `Status: ${visit.status} · ${formatIndonesianDate(visit.visitDate)}`,
    margin + 8,
    68,
  );

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(234, 88, 12);
  doc.setFontSize(22);
  doc.text(visit.queueCode, pageWidth - margin - 8, 66, { align: 'right' });

  // Detail rows
  const details: [string, string][] = [
    ['Nama Lengkap', visit.fullName],
    ['Nomor HP / WhatsApp', visit.phone],
    ['Kategori Pengunjung', visit.visitorCategory],
    ['Bidang Tujuan', visit.department],
    ['Instansi / Alamat', visit.institutionAddress],
    ['Keperluan Kunjungan', visit.purpose],
    ['Jam Masuk (WIB)', formatWibTime(visit.checkInAt)],
    ['Jam Keluar (WIB)', visit.checkOutAt ? formatWibTime(visit.checkOutAt) : '-'],
  ];

  autoTable(doc, {
    startY: 78,
    margin: { left: margin + 6, right: margin + 6 },
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 9.5,
      cellPadding: 3,
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.25,
    },
    columnStyles: {
      0: { cellWidth: 48, fontStyle: 'bold', fillColor: [248, 250, 252], textColor: [51, 65, 85] },
      1: { cellWidth: 'auto' },
    },
    body: details,
  });

  const afterTableY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 156;

  // Signature box
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);
  doc.setFontSize(9);
  doc.text('Tanda Tangan Digital Pengunjung:', margin + 8, afterTableY + 8);

  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin + 8, afterTableY + 11, 70, 28, 2, 2, 'FD');

  if (visit.signatureData && visit.signatureData.startsWith('data:image/')) {
    try {
      doc.addImage(visit.signatureData, 'PNG', margin + 12, afterTableY + 13, 62, 24);
    } catch {
      // ignore if signature fails to render
    }
  }

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(8);
  doc.text(
    'Dokumen bukti kunjungan resmi SI-TAMU BPBD Kabupaten Sidoarjo.',
    pageWidth / 2,
    afterTableY + 46,
    { align: 'center' },
  );

  triggerPdfDownload(doc, `bukti-kunjungan-${visit.queueCode}-${visit.visitDate}.pdf`);
}

interface DownloadReportPdfParams {
  visits: VisitRecord[];
  stats: DashboardStats;
  dateFrom: string;
  dateTo: string;
  departmentFilter: string;
}

export async function downloadVisitReportPdf({
  visits,
  stats,
  dateFrom,
  dateTo,
  departmentFilter,
}: DownloadReportPdfParams): Promise<void> {
  const [sidoarjoPng, bpbdPng] = await Promise.all([
    loadImageAsPngDataUrl(SIDOARJO_LOGO_SRC, false),
    loadImageAsPngDataUrl(BPBD_EMBLEM_SRC, true),
  ]);

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  // Kop Surat Resmi
  if (sidoarjoPng) {
    doc.addImage(sidoarjoPng, 'PNG', margin, 10, 20, 20);
  }
  if (bpbdPng) {
    doc.addImage(bpbdPng, 'PNG', pageWidth - margin - 20, 10, 20, 20);
  }

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(51, 65, 85);
  doc.setFontSize(9.5);
  doc.text('PEMERINTAH KABUPATEN SIDOARJO', pageWidth / 2, 14, { align: 'center' });

  doc.setTextColor(15, 41, 74);
  doc.setFontSize(14);
  doc.text('BADAN PENANGGULANGAN BENCANA DAERAH (BPBD)', pageWidth / 2, 20.5, {
    align: 'center',
  });

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.setFontSize(9.5);
  doc.text('Laporan Resmi Rekapitulasi Buku Tamu Digital (SI-TAMU BPBD)', pageWidth / 2, 26, {
    align: 'center',
  });

  doc.setDrawColor(15, 41, 74);
  doc.setLineWidth(1);
  doc.line(margin, 32, pageWidth - margin, 32);
  doc.setDrawColor(234, 88, 12);
  doc.setLineWidth(0.5);
  doc.line(margin, 33.4, pageWidth - margin, 33.4);

  const periodLabel =
    dateFrom && dateTo
      ? `${formatShortDate(dateFrom)} – ${formatShortDate(dateTo)}`
      : dateFrom
        ? `Mulai ${formatShortDate(dateFrom)}`
        : dateTo
          ? `Sampai ${formatShortDate(dateTo)}`
          : 'Semua Periode';

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(8.5);
  doc.text(`Periode Data: ${periodLabel}`, margin, 39);
  doc.text(`Bidang Tujuan: ${departmentFilter || 'Semua Bidang'}`, margin, 43.5);

  doc.text(`Dicetak: ${formatIndonesianDate(getTodayWib())}`, pageWidth - margin, 39, {
    align: 'right',
  });
  doc.text(`Jumlah Baris Filter: ${visits.length} tamu`, pageWidth - margin, 43.5, {
    align: 'right',
  });

  let nextY = 47;

  // Period Recap Table
  if (stats.periodRecap && stats.periodRecap.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 41, 74);
    doc.setFontSize(9);
    doc.text('REKAPITULASI KUNJUNGAN TAMU (HARI, MINGGU, BULAN, TAHUN INI, TAHUN LALU)', margin, nextY);

    autoTable(doc, {
      startY: nextY + 2,
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 8.5,
        halign: 'center',
        cellPadding: 2.2,
        lineColor: [203, 213, 225],
      },
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: [15, 41, 74],
        fontStyle: 'bold',
      },
      bodyStyles: {
        fontStyle: 'bold',
        textColor: [15, 23, 42],
      },
      head: [stats.periodRecap.map((p) => p.label)],
      body: [stats.periodRecap.map((p) => `${p.total} tamu`)],
    });

    nextY =
      ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? nextY + 14) +
      5;
  }

  // Main Guest Log Table
  const tableRows =
    visits.length === 0
      ? [['-', '-', 'Tidak ada data kunjungan pada filter yang dipilih.', '-', '-', '-', '', '-']]
      : visits.map((v) => [
          v.queueCode,
          `${formatShortDate(v.visitDate)}\nMasuk: ${formatWibTime(v.checkInAt)}${
            v.checkOutAt ? `\nKeluar: ${formatWibTime(v.checkOutAt)}` : ''
          }`,
          `${v.fullName}\n${v.phone}`,
          `${v.visitorCategory}\n${v.institutionAddress}`,
          v.department,
          v.purpose,
          '', // Placeholder for TTD image
          v.status,
        ]);

  autoTable(doc, {
    startY: nextY,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 2.5,
      valign: 'middle',
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      minCellHeight: 12,
    },
    headStyles: {
      fillColor: [15, 41, 74],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 18, fontStyle: 'bold', halign: 'center' },
      1: { cellWidth: 34 },
      2: { cellWidth: 40 },
      3: { cellWidth: 46 },
      4: { cellWidth: 36 },
      5: { cellWidth: 'auto' },
      6: { cellWidth: 24, halign: 'center' },
      7: { cellWidth: 26, fontStyle: 'bold' },
    },
    head: [
      [
        'No. Urut',
        'Tanggal & Jam',
        'Nama & Kontak',
        'Kategori & Instansi',
        'Bidang Tujuan',
        'Keperluan',
        'TTD',
        'Status',
      ],
    ],
    body: tableRows,
    didDrawCell: (data) => {
      if (data.section === 'body' && data.column.index === 6 && visits.length > 0) {
        const visit = visits[data.row.index];
        if (visit?.signatureData && visit.signatureData.startsWith('data:image/')) {
          try {
            doc.addImage(
              visit.signatureData,
              'PNG',
              data.cell.x + 2,
              data.cell.y + 1.5,
              data.cell.width - 4,
              data.cell.height - 3,
            );
          } catch {
            // ignore image rendering error
          }
        }
      }
    },
  });

  // Official Sign-Off block
  const finalY =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 120;
  let signY = finalY + 10;
  if (signY + 34 > pageHeight - 10) {
    doc.addPage();
    signY = 20;
  }

  const signCenterX = pageWidth - margin - 40;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(8.5);
  doc.text(`Sidoarjo, ${formatIndonesianDate(getTodayWib())}`, signCenterX, signY, {
    align: 'center',
  });
  doc.setFont('helvetica', 'bold');
  doc.text('Petugas Resepsionis / Sekretariat', signCenterX, signY + 4.5, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.text('BPBD Kabupaten Sidoarjo', signCenterX, signY + 9, { align: 'center' });
  doc.text('( ................................................. )', signCenterX, signY + 26, {
    align: 'center',
  });

  triggerPdfDownload(doc, `laporan-buku-tamu-bpbd-sidoarjo-${getTodayWib()}.pdf`);
}

interface DownloadDeskPosterPdfParams {
  qrDataUrl: string;
  targetUrl: string;
  deskLabel: string;
}

export async function downloadDeskPosterPdf({
  qrDataUrl,
  targetUrl,
  deskLabel,
}: DownloadDeskPosterPdfParams): Promise<void> {
  const [sidoarjoPng, bpbdPng] = await Promise.all([
    loadImageAsPngDataUrl(SIDOARJO_LOGO_SRC, false),
    loadImageAsPngDataUrl(BPBD_EMBLEM_SRC, true),
  ]);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 18;
  const cardWidth = pageWidth - margin * 2;

  // Outer card frame
  doc.setDrawColor(15, 41, 74);
  doc.setLineWidth(0.8);
  doc.roundedRect(margin, 14, cardWidth, 268, 5, 5, 'S');

  // Header Navy Block
  doc.setFillColor(15, 41, 74);
  doc.rect(margin, 14, cardWidth, 44, 'F');
  doc.setFillColor(234, 88, 12);
  doc.rect(margin, 58, cardWidth, 3, 'F');

  if (sidoarjoPng) {
    doc.addImage(sidoarjoPng, 'PNG', margin + 8, 22, 26, 26);
  }
  if (bpbdPng) {
    doc.addImage(bpbdPng, 'PNG', pageWidth - margin - 34, 22, 26, 26);
  }

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(203, 213, 225);
  doc.setFontSize(9.5);
  doc.text('PEMERINTAH KABUPATEN SIDOARJO', pageWidth / 2, 26, { align: 'center' });

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text('BPBD KABUPATEN SIDOARJO', pageWidth / 2, 35, { align: 'center' });

  doc.setTextColor(251, 146, 60);
  doc.setFontSize(10);
  doc.text('SI-TAMU BPBD · SISTEM BUKU TAMU DIGITAL', pageWidth / 2, 44, { align: 'center' });

  // Body Welcome Heading
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 41, 74);
  doc.setFontSize(26);
  doc.text('SELAMAT DATANG', pageWidth / 2, 80, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  doc.setFontSize(12);
  const subtitleLines = doc.splitTextToSize(
    'Pindai QR Code di bawah ini untuk mengisi Buku Tamu Digital sebelum memasuki area layanan BPBD Kabupaten Sidoarjo',
    cardWidth - 28,
  );
  doc.text(subtitleLines, pageWidth / 2, 90, { align: 'center' });

  // QR Box
  const qrBoxSize = 96;
  const qrBoxX = (pageWidth - qrBoxSize) / 2;
  const qrBoxY = 108;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(15, 41, 74);
  doc.setLineWidth(1.2);
  doc.roundedRect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 5, 5, 'FD');

  if (qrDataUrl) {
    doc.addImage(qrDataUrl, 'PNG', qrBoxX + 7, qrBoxY + 7, qrBoxSize - 14, qrBoxSize - 14);
  }

  // Instructions Box
  const stepBoxY = 216;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.4);
  doc.roundedRect(margin + 12, stepBoxY, cardWidth - 24, 38, 3, 3, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 41, 74);
  doc.setFontSize(11);
  doc.text('LANGKAH PENGISIAN:', margin + 18, stepBoxY + 9);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(10);
  doc.text('1. Buka kamera ponsel atau aplikasi QR Scanner Anda.', margin + 18, stepBoxY + 16);
  doc.text('2. Arahkan ke QR Code dan buka tautan halaman Buku Tamu Digital.', margin + 18, stepBoxY + 22);
  doc.text('3. Lengkapi formulir kunjungan beserta tanda tangan digital.', margin + 18, stepBoxY + 28);
  doc.text('4. Simpan nomor urut kunjungan & tekan Check-Out saat selesai.', margin + 18, stepBoxY + 34);

  // Poster Footer
  doc.setFillColor(15, 41, 74);
  doc.rect(margin, 262, cardWidth, 20, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.text(deskLabel || 'Meja Resepsionis Utama BPBD Kabupaten Sidoarjo', pageWidth / 2, 270, {
    align: 'center',
  });

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(203, 213, 225);
  doc.setFontSize(8.5);
  const truncatedUrl = targetUrl.length > 78 ? `${targetUrl.slice(0, 75)}...` : targetUrl;
  doc.text(truncatedUrl, pageWidth / 2, 276.5, { align: 'center' });

  triggerPdfDownload(doc, 'poster-meja-resepsionis-si-tamu-bpbd-sidoarjo.pdf');
}
