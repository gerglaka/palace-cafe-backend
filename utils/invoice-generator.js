/**
 * Palace Cafe & Street Food - Invoice Generator (FIXED VERSION)
 * Professional invoice generation with Slovak legal compliance
 * Fixed UTF-8 encoding and your exact VAT calculation method
 * VAT = GROSS * 0.19, NET = GROSS - VAT
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Company details - FIXED ENCODING
const COMPANY_INFO = {
  name: 'Palace Cafe & Street Food s.r.o.',
  address: 'Hradná 168/2',
  city: '945 01 Komárno',
  ico: '56384840',
  dic: '2122291578',
  vatNumber: 'SK2122291578'
};

// Brand colors
const COLORS = {
  rusticRed: '#38141A',
  eucalyptusGreen: '#1D665D',
  darkGray: '#333333',
  lightGray: '#666666',
  veryLightGray: '#f5f5f5'
};

// Slovak translations only
const TRANSLATIONS = {
  // Invoice header
  invoice: 'FAKTÚRA',
  taxInvoice: 'Daňový doklad',
  
  // Company info
  supplier: 'Dodávateľ',
  customer: 'Odberateľ',
  
  // Order details
  orderNumber: 'Číslo objednávky',
  orderType: 'Typ objednávky',
  delivery: 'Doručenie',
  pickup: 'Vyzdvihnutie',
  
  // Dates
  issueDate: 'Dátum vystavenia',
  dueDate: 'Dátum splatnosti',
  
  // Table headers
  item: 'Položka',
  quantity: 'Množstvo',
  unitPrice: 'Jednotková cena',
  total: 'Celkom',
  
  // Totals
  subtotal: 'Medzisúčet',
  deliveryFee: 'Poplatok za doručenie',
  vatBase: 'Základ DPH 19%',
  vatAmount: 'DPH 19%',
  totalAmount: 'Celková suma',
  
  // Payment
  paymentMethod: 'Spôsob platby',
  cash: 'Hotovosť',
  card: 'Karta',
  online: 'Online platba',
  paid: 'Uhradené',
  
  // Menu items (add more as needed)
  menuItems: {
    'palace-burger': 'Palace Burger',
    'cheeseburger': 'Cheeseburger',
    'chicken-burger': 'Kuracie burger',
    'fanta': 'Fanta',
    'coca-cola': 'Coca-Cola',
    'sprite': 'Sprite',
    'beer': 'Pivo',
    'fries': 'Hranolky',
    'extra-cheese': 'Extra syr',
    'bacon': 'Slanina'
  }
};

/**
 * Generate invoice number based on payment method and year
 */
function generateInvoiceNumber(paymentMethod, year, counter) {
  const prefix = paymentMethod === 'CASH' ? '1250' : '2250';
  const paddedCounter = counter.toString().padStart(4, '0');
  return `${prefix}${paddedCounter}`;
}

/**
 * Get next invoice counter for the given payment method and year
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
 * Calculate VAT breakdown using YOUR EXACT METHOD
 * GROSS = x, VAT = x * 0.19, NET = GROSS - VAT
 */
function calculateVATBreakdown(grossAmount) {
  const vatRate = 0.19; // 19%
  const vatAmount = Math.round(grossAmount * vatRate * 100) / 100;
  const netAmount = Math.round((grossAmount - vatAmount) * 100) / 100;
  
  return {
    netAmount,
    vatAmount,
    grossAmount: Math.round(grossAmount * 100) / 100
  };
}

/**
 * Format currency for display
 */
function formatCurrency(amount) {
  return new Intl.NumberFormat('sk-SK', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2
  }).format(amount);
}

/**
 * Format date for Slovak locale
 */
function formatDate(date) {
  return new Date(date).toLocaleDateString('sk-SK');
}

/**
 * Translate menu item name (simplified for Slovak only)
 */
function translateMenuItem(slug) {
  if (TRANSLATIONS.menuItems[slug]) {
    return TRANSLATIONS.menuItems[slug];
  }
  // Fallback to original name if no translation found
  return slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Generate invoice PDF with proper UTF-8 encoding
 */
function generateInvoicePDF(invoiceData) {
  return new Promise((resolve, reject) => {
    try {
      // Create PDF with proper settings for UTF-8
      const doc = new PDFDocument({ 
        size: 'A4', 
        margin: 50,
        bufferPages: true,
        compress: false,
        info: {
          Title: `Faktúra ${invoiceData.invoiceNumber}`,
          Subject: 'Palace Cafe & Street Food - Faktúra',
          Author: COMPANY_INFO.name
        }
      });
      
      // Use Helvetica font for better Unicode support
      doc.font('Helvetica');
      
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });
      
      // Header
      drawHeader(doc);
      
      // Invoice info
      drawInvoiceInfo(doc, invoiceData);
      
      // Company and customer info
      drawCompanyInfo(doc);
      drawCustomerInfo(doc, invoiceData);
      
      // Items table
      const tableEndY = drawItemsTable(doc, invoiceData);
      
      // Totals
      drawTotals(doc, invoiceData, tableEndY);
      
      // Footer
      drawFooter(doc, invoiceData);
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Draw PDF header
 */
function drawHeader(doc) {
  // Company name in brand color
  doc.fontSize(24)
     .fillColor(COLORS.rusticRed)
     .text(COMPANY_INFO.name, 50, 50);
  
  // Invoice title
  doc.fontSize(20)
     .fillColor(COLORS.eucalyptusGreen)
     .text('FAKTÚRA', 350, 50, { align: 'right' });
  
  // Tax invoice subtitle
  doc.fontSize(10)
     .fillColor(COLORS.lightGray)
     .text('Daňový doklad', 350, 75, { align: 'right' });
  
  // Line separator
  doc.strokeColor(COLORS.eucalyptusGreen)
     .lineWidth(2)
     .moveTo(50, 100)
     .lineTo(545, 100)
     .stroke();
}

/**
 * Draw invoice information
 */
function drawInvoiceInfo(doc, invoiceData) {
  let y = 120;
  
  // Invoice number
  doc.fontSize(12)
     .fillColor(COLORS.darkGray)
     .text('Číslo faktúry:', 350, y)
     .font('Helvetica-Bold')
     .fillColor(COLORS.rusticRed)
     .text(invoiceData.invoiceNumber, 350, y + 15);
  
  // Dates
  y += 40;
  doc.font('Helvetica')
     .fillColor(COLORS.darkGray)
     .fontSize(10)
     .text('Dátum vystavenia:', 350, y)
     .text(formatDate(invoiceData.createdAt), 350, y + 12)
     .text('Dátum splatnosti:', 350, y + 30)
     .text(formatDate(invoiceData.createdAt), 350, y + 42);
  
  // Order info
  y += 70;
  doc.text('Číslo objednávky:', 350, y)
     .font('Helvetica-Bold')
     .text(`#${invoiceData.order?.orderNumber || 'N/A'}`, 350, y + 12);
}

/**
 * Draw company information
 */
function drawCompanyInfo(doc) {
  let y = 120;
  
  doc.fontSize(12)
     .font('Helvetica-Bold')
     .fillColor(COLORS.eucalyptusGreen)
     .text('Dodávateľ', 50, y);
  
  y += 20;
  doc.font('Helvetica')
     .fillColor(COLORS.darkGray)
     .fontSize(10)
     .text(COMPANY_INFO.name, 50, y)
     .text(COMPANY_INFO.address, 50, y + 12)
     .text(COMPANY_INFO.city, 50, y + 24)
     .text(`IČO: ${COMPANY_INFO.ico}`, 50, y + 40)
     .text(`DIČ: ${COMPANY_INFO.dic}`, 50, y + 52)
     .text(`IČ DPH: ${COMPANY_INFO.vatNumber}`, 50, y + 64);
}

/**
 * Draw customer information
 */
function drawCustomerInfo(doc, invoiceData) {
  let y = 220;
  
  doc.fontSize(12)
     .font('Helvetica-Bold')
     .fillColor(COLORS.eucalyptusGreen)
     .text('Odberateľ', 50, y);
  
  y += 20;
  doc.font('Helvetica')
     .fillColor(COLORS.darkGray)
     .fontSize(10)
     .text(invoiceData.customerName || 'Zákazník', 50, y);
  
  if (invoiceData.customerPhone) {
    doc.text(`Tel: ${invoiceData.customerPhone}`, 50, y + 12);
    y += 12;
  }
  
  if (invoiceData.customerEmail) {
    doc.text(`Email: ${invoiceData.customerEmail}`, 50, y + 12);
  }
}

/**
 * Draw items table
 */
function drawItemsTable(doc, invoiceData) {
  let y = 300;
  
  // Table headers
  doc.fontSize(10)
     .font('Helvetica-Bold')
     .fillColor(COLORS.darkGray);
  
  // Header background
  doc.rect(50, y, 495, 20)
     .fill(COLORS.veryLightGray);
  
  // Header text
  doc.fillColor(COLORS.darkGray)
     .text('Položka', 55, y + 6)
     .text('Mn.', 300, y + 6)
     .text('Jedn. cena', 350, y + 6)
     .text('Spolu', 470, y + 6);
  
  y += 25;
  
  // Items
  doc.font('Helvetica').fontSize(9);
  
  const items = invoiceData.orderItems || [];
  
  items.forEach((item, index) => {
    if (y > 700) { // New page if needed
      doc.addPage();
      y = 50;
    }
    
    // Handle different item name formats
    let displayName = item.name || 'Unknown Item';
    
    // If we have slug, try to translate
    if (item.slug) {
      displayName = translateMenuItem(item.slug);
    }
    
    // Item row
    doc.fillColor(COLORS.darkGray)
       .text(displayName, 55, y, { width: 240 })
       .text((item.quantity || 1).toString(), 300, y)
       .text(formatCurrency(item.unitPrice || item.price || 0), 350, y)
       .text(formatCurrency(item.totalPrice || 0), 470, y);
    
    // Customizations (if any)
    if (item.customizations) {
      y += 12;
      doc.fontSize(8)
         .fillColor(COLORS.lightGray)
         .text(`• ${item.customizations}`, 60, y);
    }
    
    y += 20;
    
    // Line separator
    if (index < items.length - 1) {
      doc.strokeColor('#eeeeee')
         .lineWidth(0.5)
         .moveTo(55, y - 5)
         .lineTo(540, y - 5)
         .stroke();
    }
  });
  
  // Table bottom border
  doc.strokeColor(COLORS.eucalyptusGreen)
     .lineWidth(1)
     .moveTo(50, y)
     .lineTo(545, y)
     .stroke();
  
  return y + 20;
}

/**
 * Draw totals section with YOUR VAT CALCULATION
 */
function drawTotals(doc, invoiceData, startY) {
  let y = Math.max(startY, 500);
  
  const breakdown = calculateVATBreakdown(invoiceData.totalGross);
  
  // Totals box
  doc.rect(300, y, 245, 120)
     .stroke(COLORS.lightGray);
  
  y += 15;
  
  // Subtotal
  doc.fontSize(10)
     .fillColor(COLORS.darkGray)
     .text('Medzisúčet:', 310, y)
     .text(formatCurrency(invoiceData.subtotal || breakdown.netAmount), 480, y, { align: 'right' });
  
  // Delivery fee (if applicable)
  if (invoiceData.deliveryFee && invoiceData.deliveryFee > 0) {
    y += 15;
    doc.text('Poplatok za doručenie:', 310, y)
       .text(formatCurrency(invoiceData.deliveryFee), 480, y, { align: 'right' });
  }
  
  // VAT base
  y += 15;
  doc.text('Základ DPH 19%:', 310, y)
     .text(formatCurrency(breakdown.netAmount), 480, y, { align: 'right' });
  
  // VAT amount
  y += 15;
  doc.text('DPH 19%:', 310, y)
     .text(formatCurrency(breakdown.vatAmount), 480, y, { align: 'right' });
  
  // Total line
  y += 20;
  doc.strokeColor(COLORS.eucalyptusGreen)
     .lineWidth(1)
     .moveTo(310, y)
     .lineTo(535, y)
     .stroke();
  
  // Final total
  y += 10;
  doc.fontSize(12)
     .font('Helvetica-Bold')
     .fillColor(COLORS.rusticRed)
     .text('CELKOM:', 310, y)
     .text(formatCurrency(invoiceData.totalGross), 480, y, { align: 'right' });
}

/**
 * Draw footer with payment info
 */
function drawFooter(doc, invoiceData) {
  let y = 650;
  
  // Payment method
  const paymentMethods = {
    'CASH': 'Hotovosť',
    'CARD': 'Karta',
    'ONLINE': 'Online platba'
  };
  
  doc.fontSize(10)
     .font('Helvetica-Bold')
     .fillColor(COLORS.eucalyptusGreen)
     .text('Spôsob platby:', 50, y);
  
  doc.font('Helvetica')
     .fillColor(COLORS.darkGray)
     .text(paymentMethods[invoiceData.paymentMethod] || invoiceData.paymentMethod, 200, y);
  
  // Payment status
  y += 15;
  doc.font('Helvetica-Bold')
     .fillColor(COLORS.rusticRed)
     .text('UHRADENÉ', 50, y);
  
  // Footer note
  y += 40;
  doc.fontSize(8)
     .fillColor(COLORS.lightGray)
     .text('Ďakujeme za vašu návštevu!', 50, y)
     .text('Palace Cafe & Street Food - Autentické chute od 2016', 50, y + 12);
}

module.exports = {
  generateInvoicePDF,
  generateInvoiceNumber,
  getNextInvoiceCounter,
  calculateVATBreakdown,
  formatCurrency,
  COMPANY_INFO
};