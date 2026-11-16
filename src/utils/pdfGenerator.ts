import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import i18n from 'i18next';

export const generateInvoicePDF = async (elementId: string, filename: string): Promise<Blob> => {
  const element = document.getElementById(elementId);
  if (!element) throw new Error("Element not found");

  // To avoid any React structure messing up due to DOM moves, we clone the element
  // or use html-to-image which is very careful about it.
  // We'll temporarily make it block to capture it if it relies on classes
  const originalClasses = element.className;
  
  // Make it visible to html-to-image
  element.className = 'fixed top-0 left-0 bg-white p-8 w-[800px] text-right font-sans text-black opacity-100 block z-50';

  let dataUrl;
  try {
    dataUrl = await toPng(element, { 
      cacheBust: true,
      backgroundColor: '#ffffff',
      pixelRatio: 2,
    });
  } finally {
    element.className = originalClasses;
  }

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const usableWidth = pdfWidth - margin * 2;

  // Usually jsPDF needs an image payload
  const imgProps = pdf.getImageProperties(dataUrl);
  const imgHeight = (imgProps.height * usableWidth) / imgProps.width;

  // Bug report (sprint 2 reports engine, 2026-11-17): a single addImage
  // call clipped any report taller than one A4 page -- content past the
  // page boundary was simply cut off, not pushed to a next page. Same
  // addPage() loop ZReport.tsx's generatePDF already uses successfully
  // (margin shifted in, stepping by the full page height exactly like
  // that proven version): each page draws the SAME full image shifted up
  // by one page height, so the page's own bounds act as a window
  // scrolling down the image.
  let heightLeft = imgHeight;
  let position = margin;

  pdf.addImage(dataUrl, 'PNG', margin, position, usableWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft >= 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(dataUrl, 'PNG', margin, position, usableWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  return pdf.output('blob');
};

export const downloadInvoicePDF = async (elementId: string, filename: string) => {
  try {
    const blob = await generateInvoicePDF(elementId, filename);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (a.parentNode) {
        a.parentNode.removeChild(a);
      }
      URL.revokeObjectURL(url);
    }, 100);
  } catch (error) {
    console.error("PDF generation failed:", error);
    alert(i18n.t('printing.pdf_generation_failed'));
    window.print();
  }
};

export type ShareAttachmentResult = 'shared' | 'downloaded' | 'failed';

/**
 * Attempts to hand the invoice/statement PDF off to the OS share sheet
 * (with `text` as the caption) so the user can pick WhatsApp and a contact
 * with the file already attached -- this is the only way a web app can get
 * a file INTO a WhatsApp chat; wa.me/api.whatsapp.com links only ever
 * accept a text parameter, never a file, by WhatsApp's own design.
 *
 * When native file sharing isn't available (most desktop browsers), the
 * PDF is downloaded instead so it's ready to attach manually in the
 * WhatsApp chat the caller opens next via api.whatsapp.com/send. Never
 * throws and never uses alert()/window.print() as a fallback -- a failure
 * here must not block the caller from still sending the text message.
 */
export const shareOrDownloadInvoicePDF = async (
  elementId: string,
  filename: string,
  text: string
): Promise<ShareAttachmentResult> => {
  let blob: Blob;
  try {
    blob = await generateInvoicePDF(elementId, filename);
  } catch (error) {
    console.error('PDF generation failed:', error);
    return 'failed';
  }

  const file = new File([blob], filename, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ text, files: [file] });
      return 'shared';
    } catch (error) {
      // AbortError just means the user closed the share sheet -- treat it
      // as handled rather than falling through to a redundant download.
      if ((error as any)?.name === 'AbortError') return 'shared';
      console.error('Native share failed:', error);
    }
  }

  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    return 'downloaded';
  } catch (error) {
    console.error('PDF download failed:', error);
    return 'failed';
  }
};
