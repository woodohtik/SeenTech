import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';

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
    alert('تعذر إنشاء ملف PDF (قد لا يتم دعم بعض الألوان)، سيتم فتح نافذة الطباعة بدلاً من ذلك.');
    window.print();
  }
};

export const shareInvoiceAsPDFFile = async (elementId: string, filename: string, text: string) => {
  try {
    const blob = await generateInvoicePDF(elementId, filename);
    const file = new File([blob], filename, { type: 'application/pdf' });
    
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: 'فاتورة ضريبية',
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
