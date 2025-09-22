/**
 * Palace Cafe & Street Food - Invoice Generator
 * Clean Slovak-only implementation with PDFKit
 * VAT calculation: GROSS = x, VAT = x * 0.19, NET = GROSS - VAT
 */

const PDFDocument = require('pdfkit');

// Company information
const COMPANY_INFO = {
  name: 'Palace Cafe & Street Food s.r.o.',
  address: 'Hradná 168/2',
  city: '945 01 Komárno',
  ico: '56384840',
  dic: '2122291578',
  vatNumber: 'SK2122291578'
};

// Colors
const COLORS = {
  primary: '#38141A',    // Rustic red
  secondary: '#1D665D',  // Eucalyptus green
  dark: '#333333',
  light: '#666666',
  background: '#f5f5f5'
};

/**
 * Calculate VAT breakdown using exact method
 * GROSS = x, VAT = x * 0.19, NET = GROSS - VAT
 */
function calculateVATBreakdown(grossAmount) {
  const vatRate = 0.19;
  const vatAmount = Math.round(grossAmount * vatRate * 100) / 100;
  const netAmount = Math.round((grossAmount - vatAmount) * 100) / 100;
  
  return {
    netAmount,
    vatAmount,
    grossAmount: Math.round(grossAmount * 100) / 100
  };
}

/**
 * Generate invoice number
 */
function generateInvoiceNumber(paymentMethod, year, counter) {
  const prefix = paymentMethod === 'CASH' ? '1250' : '2250';
  const paddedCounter = counter.toString().padStart(4, '0');
  return `${prefix}${paddedCounter}`;
}

/**
 * Get next invoice counter
 */
async function getNextInvoiceCounter(paymentMethod, year, prisma) {
  const key = `invoice_counter_${paymentMethod.toLowerCase()}_${year}`;
  
  const setting = await prisma.setting.findUnique({
    where: { key }
  });
  
  let nextCounter = 1;
  if (setting) {
    nextCounter = parseInt(setting.value) + 1;
    await prisma.setting.update({
      where: { key },
      data: { value: nextCounter.toString() }
    });
  } else {
    await prisma.setting.create({
      data: {
        key,
        value: nextCounter.toString(),
        type: 'number'
      }
    });
  }
  
  return nextCounter;
}

/**
 * Clean Slovak/Hungarian characters for PDF compatibility
 */
function cleanTextForPDF(text) {
  if (!text) return '';
  
  const charMap = {
    // Slovak characters
    'ň': 'n', 'Ň': 'N',
    'č': 'c', 'Č': 'C', 
    'ľ': 'l', 'Ľ': 'L',
    'ť': 't', 'Ť': 'T',
    'ď': 'd', 'Ď': 'D',
    'ž': 'z', 'Ž': 'Z',
    'š': 's', 'Š': 'S',
    
    // Hungarian characters  
    'ő': 'o', 'Ő': 'O',
    'ű': 'u', 'Ű': 'U',
    
    // Common accented characters
    'á': 'a', 'Á': 'A',
    'é': 'e', 'É': 'E', 
    'í': 'i', 'Í': 'I',
    'ó': 'o', 'Ó': 'O',
    'ú': 'u', 'Ú': 'U',
    'ý': 'y', 'Ý': 'Y'
  };
  
  return text.replace(/[^\x00-\x7F]/g, function(char) {
    return charMap[char] || char;
  });
}

/**
 * Format currency
 */
function formatCurrency(amount) {
  return new Intl.NumberFormat('sk-SK', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2
  }).format(amount);
}

/**
 * Format date
 */
function formatDate(date) {
  return new Date(date).toLocaleDateString('sk-SK');
}

/**
 * Generate invoice PDF
 */
function generateInvoicePDF(invoiceData) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        size: 'A4', 
        margin: 50,
        bufferPages: true
      });
      
      doc.font('Helvetica');
      
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      // Calculate total gross amount including delivery fee if it's a delivery order
      let totalGrossAmount = invoiceData.totalGross;
      if (invoiceData.orderType === 'DELIVERY' && invoiceData.deliveryFee && invoiceData.deliveryFee > 0) {
        totalGrossAmount = invoiceData.totalGross + invoiceData.deliveryFee;
      }      
      
      // Calculate VAT
      const vatBreakdown = calculateVATBreakdown(invoiceData.totalGross);
      
      // Header
      doc.fontSize(22)
         .fillColor(COLORS.primary)
         .text(COMPANY_INFO.name, 50, 50);
      
      doc.fontSize(18)
         .fillColor(COLORS.secondary)
         .text('FAKTÚRA', 400, 50, { align: 'right' });
      
      doc.fontSize(10)
         .fillColor(COLORS.light)
         .text('Danovy doklad', 400, 75, { align: 'right' })
      
      // Line
      doc.strokeColor(COLORS.secondary)
         .lineWidth(2)
         .moveTo(50, 100)
         .lineTo(545, 100)
         .stroke();
      
      // Invoice details
      let y = 120;
      doc.fontSize(11)
         .fillColor(COLORS.dark)
         .text('Faktura c.:', 400, y)
         .font('Helvetica-Bold')
         .fillColor(COLORS.primary)
         .text(invoiceData.invoiceNumber, 400, y + 15);
      
      y += 40;
      doc.font('Helvetica')
         .fillColor(COLORS.dark)
         .fontSize(10)
         .text('Dátum vystavenia:', 400, y)
         .text(formatDate(invoiceData.createdAt), 400, y + 12)
         .text('Dátum splatnosti:', 400, y + 30)
         .text(formatDate(invoiceData.createdAt), 400, y + 42)
         .text('Dátum dodanie:', 400, y + 60)
         .text(formatDate(invoiceData.createdAt), 400, y + 72);
      
      y += 100;
      doc.text('Cislo objednavky:', 400, y)
         .font('Helvetica-Bold')
         .text(`#${invoiceData.order?.orderNumber || 'N/A'}`, 400, y + 12);
      
      // Company info
      y = 120;
      doc.font('Helvetica-Bold')
         .fillColor(COLORS.secondary)
         .fontSize(11)
         .text('Dodavatel', 50, y);
      
      y += 20;
      doc.font('Helvetica')
         .fillColor(COLORS.dark)
         .fontSize(10)
         .text(COMPANY_INFO.name, 50, y)
         .text(COMPANY_INFO.address, 50, y + 12)
         .text(COMPANY_INFO.city, 50, y + 24)
         .text(`ICO: ${COMPANY_INFO.ico}`, 50, y + 40)
         .text(`DIC: ${COMPANY_INFO.dic}`, 50, y + 52)
         .text(`IC DPH: ${COMPANY_INFO.vatNumber}`, 50, y + 64);
      
      // Customer info
      y = 220;
      doc.font('Helvetica-Bold')
         .fillColor(COLORS.secondary)
         .fontSize(11)
         .text('Odberatel', 50, y);
      
      y += 20;
      doc.font('Helvetica')
         .fillColor(COLORS.dark)
         .fontSize(10)
         .text(cleanTextForPDF(invoiceData.customerName || 'Zákazník'), 50, y);
      
      if (invoiceData.customerPhone) {
        doc.text(`Tel: ${invoiceData.customerPhone}`, 50, y + 12);
        y += 12;
      }
      
      if (invoiceData.customerEmail) {
        doc.text(`Email: ${invoiceData.customerEmail}`, 50, y + 12);
      }
      
      // Items table
      y = 300;
      
      // Table header
      doc.fontSize(10)
         .font('Helvetica-Bold')
         .fillColor(COLORS.dark);
      
      doc.rect(50, y, 495, 20)
         .fill(COLORS.background);
      
      doc.fillColor(COLORS.dark)
         .text('Položka', 55, y + 6)
         .text('Mn.', 300, y + 6)
         .text('Cena', 350, y + 6)
         .text('Spolu', 470, y + 6);
      
      y += 25;
      
      // Items
      doc.font('Helvetica').fontSize(9);
      
      const items = invoiceData.orderItems || [];
      
      items.forEach((item, index) => {
        if (y > 700) {
          doc.addPage();
          y = 50;
        }
        
        let displayName = item.name || 'Unknown Item';
        
        doc.fillColor(COLORS.dark)
           .text(displayName, 55, y, { width: 240 })
           .text((item.quantity || 1).toString(), 300, y)
           .text(formatCurrency(item.unitPrice || item.price || 0), 350, y)
           .text(formatCurrency(item.totalPrice || 0), 470, y);
        
        if (item.customizations) {
          y += 12;
          doc.fontSize(8)
             .fillColor(COLORS.light)
             .text(`• ${item.customizations}`, 60, y);
        }
        
        y += 20;
        
        if (index < items.length - 1) {
          doc.strokeColor('#eeeeee')
             .lineWidth(0.5)
             .moveTo(55, y - 5)
             .lineTo(540, y - 5)
             .stroke();
        }
      });
          
      if (invoiceData.orderType === 'DELIVERY') {
        if (y > 700) {
          doc.addPage();
          y = 50;
        }
        
        const deliveryFee = 2.50; // Fixed delivery fee
        
        doc.fontSize(9)
           .fillColor(COLORS.dark)
           .text('Poplatok za dorucenie', 55, y, { width: 240 })
           .text('1', 300, y)
           .text(formatCurrency(deliveryFee), 350, y)
           .text(formatCurrency(deliveryFee), 470, y);
        
        y += 20;
      }    
      
      // Table bottom
      doc.strokeColor(COLORS.secondary)
         .lineWidth(1)
         .moveTo(50, y)
         .lineTo(545, y)
         .stroke();
      
      y += 20;
      
      // Totals
      y = Math.max(y, 500);
      
      doc.rect(300, y, 245, 100)
         .stroke(COLORS.light);
      
      y += 15;
      
      doc.fontSize(10)
         .fillColor(COLORS.dark)
         .text('Medzisucet', 310, y)
         .text(formatCurrency(vatBreakdown.grossAmount), 480, y, { align: 'right' });
      
      y += 15;
      doc.text('Základ DPH 19%:', 310, y)
         .text(formatCurrency(vatBreakdown.netAmount), 480, y, { align: 'right' });
      
      y += 15;
      doc.text('DPH 19%:', 310, y)
         .text(formatCurrency(vatBreakdown.vatAmount), 480, y, { align: 'right' });
      
      y += 20;
      doc.strokeColor(COLORS.secondary)
         .lineWidth(1)
         .moveTo(310, y)
         .lineTo(535, y)
         .stroke();
      
      y += 10;
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .fillColor(COLORS.primary)
         .text('CELKOM:', 310, y)
         .text(formatCurrency(vatBreakdown.grossAmount), 480, y, { align: 'right' });
      
      // Footer
      y = 650;
      
      const paymentMethods = {
        'CASH': 'Hotovost',
        'CARD': 'Karta',
        'ONLINE': 'Online platba'
      };
      
      doc.fontSize(10)
         .font('Helvetica-Bold')
         .fillColor(COLORS.secondary)
         .text('Spôsob platby:', 50, y);
      
      doc.font('Helvetica')
         .fillColor(COLORS.dark)
         .text(paymentMethods[invoiceData.paymentMethod] || invoiceData.paymentMethod, 150, y);
      
      if (invoiceData.paymentMethod === 'CARD') {
        y += 15;
        doc.font('Helvetica-Bold')
           .fillColor(COLORS.primary)
           .text('UHRADENÉ', 50, y);
      }
      
      y += 30;
      doc.fontSize(8)
         .fillColor(COLORS.light)
         .text('Dakujeme za vasu objednavku!', 50, y)
         .text('Palace Cafe & Street Food - Autentické chute od 2021', 50, y + 12);
      
      doc.end();
      
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  generateInvoicePDF,
  generateInvoiceNumber,
  getNextInvoiceCounter,
  calculateVATBreakdown,
  formatCurrency,
  COMPANY_INFO
};