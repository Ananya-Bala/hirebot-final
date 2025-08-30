import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export interface PDFGenerationOptions {
  title: string;
  content: string;
  sessionId?: string;
  candidateName?: string;
  jobTitle?: string;
  dateGenerated?: string;
}

export const generatePDF = async (options: PDFGenerationOptions): Promise<void> => {
  const {
    title,
    content,
    sessionId,
    candidateName = 'Candidate',
    jobTitle = 'Position',
    dateGenerated = new Date().toLocaleDateString()
  } = options;

  // Create a temporary div to render the content
  const tempDiv = document.createElement('div');
  tempDiv.style.position = 'absolute';
  tempDiv.style.left = '-9999px';
  tempDiv.style.top = '-9999px';
  tempDiv.style.width = '210mm'; // A4 width
  tempDiv.style.padding = '20mm';
  tempDiv.style.backgroundColor = 'white';
  tempDiv.style.fontFamily = 'Arial, sans-serif';
  tempDiv.style.fontSize = '12px';
  tempDiv.style.lineHeight = '1.6';
  tempDiv.style.color = '#000000';

  // Create the HTML content for the PDF
  tempDiv.innerHTML = `
    <div style="margin-bottom: 30px; border-bottom: 2px solid #000; padding-bottom: 15px;">
      <h1 style="color: #000; margin: 0 0 10px 0; font-size: 24px; font-weight: bold;">${title}</h1>
      <div style="display: flex; justify-content: space-between; flex-wrap: wrap; margin-top: 15px;">
        <div style="margin-bottom: 10px;">
          <strong>Candidate:</strong> ${candidateName}
        </div>
        <div style="margin-bottom: 10px;">
          <strong>Position:</strong> ${jobTitle}
        </div>
        <div style="margin-bottom: 10px;">
          <strong>Generated:</strong> ${dateGenerated}
        </div>
        ${sessionId ? `<div style="margin-bottom: 10px;"><strong>Session ID:</strong> ${sessionId}</div>` : ''}
      </div>
    </div>
    <div style="white-space: pre-wrap; word-wrap: break-word;">
      ${formatContentForPDF(content)}
    </div>
  `;

  document.body.appendChild(tempDiv);

  try {
    // Convert to canvas
    const canvas = await html2canvas(tempDiv, {
      useCORS: true,
      allowTaint: true,
      background: '#ffffff',
      width: tempDiv.scrollWidth,
      height: tempDiv.scrollHeight
    });

    // Remove the temporary div
    document.body.removeChild(tempDiv);

    // Create PDF
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const imgWidth = 210; // A4 width in mm
    const pageHeight = 295; // A4 height in mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;

    // Add first page
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    // Add additional pages if needed
    while (heightLeft >= 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    // Download the PDF
    const fileName = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${dateGenerated.replace(/\//g, '-')}.pdf`;
    pdf.save(fileName);

  } catch (error) {
    // Remove the temporary div if it still exists
    if (document.body.contains(tempDiv)) {
      document.body.removeChild(tempDiv);
    }
    console.error('Error generating PDF:', error);
    throw new Error('Failed to generate PDF. Please try again.');
  }
};

// Helper function to format markdown-like content for PDF
const formatContentForPDF = (content: string): string => {
  return content
    // Convert markdown headers to HTML
    .replace(/^### (.*$)/gm, '<h3 style="font-size: 16px; font-weight: bold; margin: 20px 0 10px 0; color: #333;">$1</h3>')
    .replace(/^## (.*$)/gm, '<h2 style="font-size: 18px; font-weight: bold; margin: 25px 0 15px 0; color: #333;">$1</h2>')
    .replace(/^# (.*$)/gm, '<h1 style="font-size: 20px; font-weight: bold; margin: 30px 0 20px 0; color: #333;">$1</h1>')
    // Convert markdown bold and italic
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Convert markdown lists
    .replace(/^- (.*$)/gm, '• $1')
    .replace(/^\* (.*$)/gm, '• $1')
    .replace(/^\d+\. (.*$)/gm, '$&')
    // Convert line breaks
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
};
