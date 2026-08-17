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
  
  // Usually jsPDF needs an image payload
  const imgProps = pdf.getImageProperties(dataUrl);
  const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
  
  const margin = 10;
  pdf.addImage(dataUrl, 'PNG', margin, margin, pdfWidth - (margin*2), pdfHeight - (margin*2));
  
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

/**
 * Same as downloadInvoicePDF, but never alerts or falls back to
 * window.print() on failure -- for callers firing this as a best-effort
 * side effect (e.g. alongside opening a WhatsApp chat directly) where a
 * capture hiccup must not interrupt or block the primary action.
 */
export const downloadInvoicePDFSilently = async (elementId: string, filename: string): Promise<boolean> => {
  try {
    const blob = await generateInvoicePDF(elementId, filename);
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
    return true;
  } catch (error) {
    console.error('PDF generation failed:', error);
    return false;
  }
};

export const shareInvoiceAsPDFFile = async (elementId: string, filename: string, text: string) => {
  try {
    const blob = await generateInvoicePDF(elementId, filename);
    const file = new File([blob], filename, { type: 'application/pdf' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: i18n.t('settings_page.invoice.tax'),
        text: text,
        files: [file]
      });
    } else {
      // Fallback
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
      // maybe trigger download too
      downloadInvoicePDF(elementId, filename);
    }
  } catch (error) {
    console.error("Share failed:", error);
    // Fallback
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
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
