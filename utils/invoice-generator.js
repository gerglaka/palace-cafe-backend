/**
 * Palace Cafe & Street Food - Invoice Generator (FIXED UTF-8)
 * Professional invoice generation with Slovak legal compliance
 * Bilingual support (Slovak/Hungarian) with proper character encoding
 * 19% DPH calculation and casual business formatting
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

// Slovak/Hungarian translations - FIXED ENCODING
const TRANSLATIONS = {
  // Invoice header
  invoice: { sk: 'FAKTÚRA', hu: 'SZÁMLA' },
  taxInvoice: { sk: 'Daňový doklad', hu: 'Adóbizonylat' },
  
  // Company info
  supplier: { sk: 'Dodávateľ', hu: 'Szállító' },
  customer: { sk: 'Odberateľ', hu: 'Vevő' },
  
  // Order details
  orderNumber: { sk: 'Číslo objednávky', hu: 'Rendelés száma' },
  orderType: { sk: 'Typ objednávky', hu: 'Rendelés típusa' },
  delivery: { sk: 'Doručenie', hu: 'Szállítás' },
  pickup: { sk: 'Vyzdvihnutie', hu: 'Átvétel' },
  
  // Dates
  issueDate: { sk: 'Dátum vystavenia', hu: 'Kiállítás dátuma' },
  dueDate: { sk: 'Dátum splatnosti', hu: 'Esedékesség dátuma' },
  
  // Table headers
  item: { sk: 'Položka', hu: 'Tétel' },
  quantity: { sk: 'Množstvo', hu: 'Mennyiség' },
  unitPrice: { sk: 'Jednotková cena', hu: 'Egységár' },
  total: { sk: 'Celkom', hu: 'Összesen' },
  
  // Totals
  subtotal: { sk: 'Medzisúčet', hu: 'Részösszeg' },
  deliveryFee: { sk: 'Poplatok za doručenie', hu: 'Szállítási díj' },
  vatBase: { sk: 'Základ DPH 19%', hu: 'ÁFA alap 19%' },
  vatAmount: { sk: 'DPH 19%', hu: 'ÁFA 19%' },
  totalAmount: { sk: 'Celková suma', hu: 'Végösszeg' },
  
  // Payment
  paymentMethod: { sk: 'Spôsob platby', hu: 'Fizetési mód' },
  cash: { sk: 'Hotovosť', hu: 'Készpénz' },
  card: { sk: 'Karta', hu: 'Kártya' },
  online: { sk: 'Online platba', hu: 'Online fizetés' },
  paid: { sk: 'Uhradené', hu: 'Kifizetve' },
  
  // Menu items (add more as needed)
  menuItems: {
    'palace-burger': { sk: 'Palace Burger', hu: 'Palace Burger' },
    'cheeseburger': { sk: 'Cheeseburger', hu: 'Sajtos Burger' },
    'chicken-burger': { sk: 'Kuracie burger', hu: 'Csirke Burger' },
    'fanta': { sk: 'Fanta', hu: 'Fanta' },
    'coca-cola': { sk: 'Coca-Cola', hu: 'Coca-Cola' },
    'sprite': { sk: 'Sprite', hu: 'Sprite' },
    'beer': { sk: 'Pivo', hu: 'Sör' },
    'fries': { sk: 'Hranolky', hu: 'Sült krumpli' },
    'extra-cheese': { sk: 'Extra syr', hu: 'Extra sajt' },
    'bacon': { sk: 'Slanina', hu: 'Szalonna' }
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
 * Calculate VAT breakdown (19% Slovak rate)
 * Corrected: net = gross / 1.19, vat = gross * 0.19
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
 * Translate menu item name
 */
function translateMenuItem(slug, language = 'sk') {
  if (TRANSLATIONS.menuItems[slug]) {
    return TRANSLATIONS.menuItems[slug][language];
  }
  // Fallback to original name if no translation found
  return slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function testPDFText() {
  const testStrings = [
    'FAKTÚRA',
    'Daňový doklad', 
    'Dodávateľ',
    'Test ľščťžýáí'
  ];
  
  testStrings.forEach(str => {
    console.log(`Original: ${str}`);
    console.log(`Bytes: ${Buffer.from(str, 'utf8')}`);
    console.log(`Length: ${str.length}`);
    console.log('---');
  });
}

/**
 * Generate invoice PDF with proper UTF-8 encoding
 */
function generateInvoicePDF(invoiceData) {
  return new Promise((resolve, reject) => {
    try {

      console.log('🔍 DEBUG - Invoice data received:');
      console.log('Customer name:', invoiceData.customerName);
      console.log('Invoice number:', invoiceData.invoiceNumber);
      console.log('Order items:', JSON.stringify(invoiceData.orderItems, null, 2));
      
      // Check for encoding issues in customer data
      if (invoiceData.customerName) {
        console.log('Customer name bytes:', Buffer.from(invoiceData.customerName, 'utf8'));
      }

      // Create PDF with proper font support for Unicode characters
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

      doc.font('Helvetica');

      // Register Unicode-supporting fonts (download DejaVuSans from https://dejavu-fonts.github.io/Download.html and place in a 'fonts' directory relative to this script)
      let defaultFont = 'Helvetica';
      let boldFont = 'Helvetica-Bold';
      try {
        const fontPath = path.join(__dirname, 'fonts/DejaVuSans.ttf');
        const boldFontPath = path.join(__dirname, 'fonts/DejaVuSans-Bold.ttf');
        if (fs.existsSync(fontPath) && fs.existsSync(boldFontPath)) {
          doc.registerFont('DejaVu', fontPath);
          doc.registerFont('DejaVu-Bold', boldFontPath);
          defaultFont = 'DejaVu';
          boldFont = 'DejaVu-Bold';
        }
      } catch (fontError) {
        console.warn('Custom fonts not found, falling back to built-in fonts (may have limited Unicode support)');
      }

      // Set default font
      doc.font(defaultFont);

      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });
      
      // Header
      drawHeader(doc, defaultFont, boldFont);
      
      // Invoice info
      drawInvoiceInfo(doc, invoiceData, defaultFont, boldFont);
      
      // Company and customer info
      drawCompanyInfo(doc, defaultFont, boldFont);
      drawCustomerInfo(doc, invoiceData, defaultFont, boldFont);
      
      // Items table
      const tableEndY = drawItemsTable(doc, invoiceData, defaultFont, boldFont);
      
      // Totals
      drawTotals(doc, invoiceData, tableEndY, defaultFont, boldFont);
      
      // Footer
      drawFooter(doc, invoiceData, defaultFont, boldFont);
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Draw PDF header
 */
function drawHeader(doc, defaultFont, boldFont) {
  // Company name in brand color
  doc.fontSize(24)
     .fillColor(COLORS.rusticRed)
     .font(defaultFont)
     .text(COMPANY_INFO.name, 50, 50);
  
  // Invoice title
  doc.fontSize(20)
     .fillColor(COLORS.eucalyptusGreen)
     .font(defaultFont)
     .text('FAKTÚRA / SZÁMLA', 350, 50, { align: 'right' });
  
  // Tax invoice subtitle
  doc.fontSize(10)
     .fillColor(COLORS.lightGray)
     .font(defaultFont)
     .text('Daňový doklad / Adóbizonylat', 350, 75, { align: 'right' });
  
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
function drawInvoiceInfo(doc, invoiceData, defaultFont, boldFont) {
  let y = 120;
  
  // Invoice number
  doc.fontSize(12)
     .fillColor(COLORS.darkGray)
     .font(defaultFont)
     .text('Číslo faktúry / Számla száma:', 350, y)
     .font(boldFont)
     .fillColor(COLORS.rusticRed)
     .text(invoiceData.invoiceNumber, 350, y + 15);
  
  // Dates
  y += 40;
  doc.font(defaultFont)
     .fillColor(COLORS.darkGray)
     .fontSize(10)
     .text('Dátum vystavenia / Kiállítás dátuma:', 350, y)
     .text(formatDate(invoiceData.createdAt), 350, y + 12)
     .text('Dátum splatnosti / Esedékesség:', 350, y + 30)
     .text(formatDate(invoiceData.createdAt), 350, y + 42);
  
  // Order info
  y += 70;
  doc.font(defaultFont)
     .text('Číslo objednávky / Rendelés száma:', 350, y)
     .font(boldFont)
     .text(`#${invoiceData.order?.orderNumber || 'N/A'}`, 350, y + 12);
}

/**
 * Draw company information
 */
function drawCompanyInfo(doc, defaultFont, boldFont) {
  let y = 120;
  
  doc.fontSize(12)
     .font(boldFont)
     .fillColor(COLORS.eucalyptusGreen)
     .text('Dodávateľ / Szállító', 50, y);
  
  y += 20;
  doc.font(defaultFont)
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
function drawCustomerInfo(doc, invoiceData, defaultFont, boldFont) {
  let y = 220;
  
  doc.fontSize(12)
     .font(boldFont)
     .fillColor(COLORS.eucalyptusGreen)
     .text('Odberateľ / Vevő', 50, y);
  
  y += 20;
  doc.font(defaultFont)
     .fillColor(COLORS.darkGray)
     .fontSize(10)
     .text(invoiceData.customerName || 'Zákazník / Vásárló', 50, y);
  
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
function drawItemsTable(doc, invoiceData, defaultFont, boldFont) {
  let y = 300;
  
  // Table headers
  doc.fontSize(10)
     .font(boldFont)
     .fillColor(COLORS.darkGray);
  
  // Header background
  doc.rect(50, y, 495, 20)
     .fill(COLORS.veryLightGray);
  
  // Header text
  doc.fillColor(COLORS.darkGray)
     .font(defaultFont)
     .text('Položka / Tétel', 55, y + 6)
     .text('Mn. / Mny.', 300, y + 6)
     .text('Jedn. cena / Egységár', 350, y + 6)
     .text('Spolu / Összesen', 470, y + 6);
  
  y += 25;
  
  // Items
  doc.font(defaultFont).fontSize(9);
  
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
      const itemNameSk = translateMenuItem(item.slug, 'sk');
      const itemNameHu = translateMenuItem(item.slug, 'hu');
      displayName = `${itemNameSk} / ${itemNameHu}`;
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
 * Draw totals section
 */
function drawTotals(doc, invoiceData, startY, defaultFont, boldFont) {
  let y = Math.max(startY, 500);
  
  const breakdown = calculateVATBreakdown(invoiceData.totalGross);
  
  // Totals box
  doc.rect(300, y, 245, 120)
     .stroke(COLORS.lightGray);
  
  y += 15;
  
  // Subtotal
  doc.fontSize(10)
     .fillColor(COLORS.darkGray)
     .font(defaultFont)
     .text('Medzisúčet / Részösszeg:', 310, y)
     .text(formatCurrency(invoiceData.subtotal || breakdown.netAmount), 480, y, { align: 'right' });
  
  // Delivery fee (if applicable)
  if (invoiceData.deliveryFee && invoiceData.deliveryFee > 0) {
    y += 15;
    doc.text('Poplatok za doručenie / Szállítási díj:', 310, y)
       .text(formatCurrency(invoiceData.deliveryFee), 480, y, { align: 'right' });
  }
  
  // VAT base
  y += 15;
  doc.text('Základ DPH 19% / ÁFA alap 19%:', 310, y)
     .text(formatCurrency(breakdown.netAmount), 480, y, { align: 'right' });
  
  // VAT amount
  y += 15;
  doc.text('DPH 19% / ÁFA 19%:', 310, y)
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
     .font(boldFont)
     .fillColor(COLORS.rusticRed)
     .text('CELKOM / VÉGÖSSZEG:', 310, y)
     .text(formatCurrency(invoiceData.totalGross), 480, y, { align: 'right' });
}

/**
 * Draw footer with payment info
 */
function drawFooter(doc, invoiceData, defaultFont, boldFont) {
  let y = 650;
  
  // Payment method
  const paymentMethods = {
    'CASH': 'Hotovosť / Készpénz',
    'CARD': 'Karta / Kártya',
    'ONLINE': 'Online platba / Online fizetés'
  };
  
  doc.fontSize(10)
     .font(boldFont)
     .fillColor(COLORS.eucalyptusGreen)
     .text('Spôsob platby / Fizetési mód:', 50, y);
  
  doc.font(defaultFont)
     .fillColor(COLORS.darkGray)
     .text(paymentMethods[invoiceData.paymentMethod] || invoiceData.paymentMethod, 200, y);
  
  // Payment status
  y += 15;
  doc.font(boldFont)
     .fillColor(COLORS.rusticRed)
     .text('UHRADENÉ / KIFIZETVE', 50, y);
  
  // Footer note
  y += 40;
  doc.fontSize(8)
     .fillColor(COLORS.lightGray)
     .font(defaultFont)
     .text('Ďakujeme za vašu návštevu! / Köszönjük a látogatást!', 50, y)
     .text('Palace Cafe & Street Food - Autentické chute od 2016', 50, y + 12);
}

module.exports = {
  generateInvoicePDF,
  generateInvoiceNumber,
  getNextInvoiceCounter,
  calculateVATBreakdown,
  formatCurrency,
  COMPANY_INFO,
  TRANSLATIONS
};