/**
 * Palace Cafe & Street Food - NEW Invoice Generator
 * Clean implementation with Puppeteer (HTML to PDF)
 * Uses your exact VAT calculation: VAT = GROSS * 0.19, NET = GROSS - VAT
 * Slovak language only, proper UTF-8 support
 */

const puppeteer = require('puppeteer');

// Company details
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

/**
 * Calculate VAT breakdown using YOUR METHOD
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
 * Generate HTML template for invoice
 */
function generateInvoiceHTML(invoiceData) {
  const vatBreakdown = calculateVATBreakdown(invoiceData.totalGross);
  
  // Payment method translations
  const paymentMethods = {
    'CASH': 'Hotovosť',
    'CARD': 'Karta',
    'ONLINE': 'Online platba'
  };

  return `
<!DOCTYPE html>
<html lang="sk">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Faktúra ${invoiceData.invoiceNumber}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', Arial, sans-serif;
            font-size: 12px;
            line-height: 1.4;
            color: ${COLORS.darkGray};
            background: white;
        }
        
        .invoice-container {
            max-width: 210mm;
            margin: 0 auto;
            padding: 20mm;
            background: white;
        }
        
        .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 30px;
            border-bottom: 3px solid ${COLORS.eucalyptusGreen};
            padding-bottom: 20px;
        }
        
        .company-name {
            font-size: 24px;
            font-weight: 700;
            color: ${COLORS.rusticRed};
            margin-bottom: 5px;
        }
        
        .invoice-title {
            font-size: 20px;
            font-weight: 600;
            color: ${COLORS.eucalyptusGreen};
            text-align: right;
        }
        
        .invoice-subtitle {
            font-size: 10px;
            color: ${COLORS.lightGray};
            text-align: right;
            margin-top: 5px;
        }
        
        .info-section {
            display: flex;
            justify-content: space-between;
            margin-bottom: 30px;
        }
        
        .info-block {
            width: 48%;
        }
        
        .info-title {
            font-size: 14px;
            font-weight: 600;
            color: ${COLORS.eucalyptusGreen};
            margin-bottom: 10px;
        }
        
        .info-content {
            font-size: 11px;
            line-height: 1.5;
        }
        
        .invoice-details {
            background: ${COLORS.veryLightGray};
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
        }
        
        .invoice-number {
            font-size: 16px;
            font-weight: 700;
            color: ${COLORS.rusticRed};
            margin-bottom: 10px;
        }
        
        .items-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
        }
        
        .items-table th {
            background: ${COLORS.eucalyptusGreen};
            color: white;
            padding: 12px 8px;
            text-align: left;
            font-weight: 600;
            font-size: 11px;
        }
        
        .items-table td {
            padding: 10px 8px;
            border-bottom: 1px solid #eee;
            font-size: 11px;
        }
        
        .items-table tr:nth-child(even) {
            background: #fafafa;
        }
        
        .customizations {
            font-size: 9px;
            color: ${COLORS.lightGray};
            font-style: italic;
            margin-top: 3px;
        }
        
        .totals-section {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 30px;
        }
        
        .totals-box {
            width: 300px;
            border: 2px solid ${COLORS.lightGray};
            border-radius: 5px;
            overflow: hidden;
        }
        
        .totals-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 15px;
            border-bottom: 1px solid #eee;
        }
        
        .totals-row.final {
            background: ${COLORS.eucalyptusGreen};
            color: white;
            font-weight: 700;
            font-size: 14px;
            border-bottom: none;
        }
        
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #eee;
        }
        
        .payment-info {
            margin-bottom: 15px;
        }
        
        .payment-method {
            font-weight: 600;
            color: ${COLORS.eucalyptusGreen};
        }
        
        .payment-status {
            font-weight: 700;
            color: ${COLORS.rusticRed};
            font-size: 14px;
            margin: 10px 0;
        }
        
        .footer-note {
            font-size: 10px;
            color: ${COLORS.lightGray};
            text-align: center;
            margin-top: 20px;
        }
        
        @media print {
            .invoice-container {
                margin: 0;
                padding: 15mm;
            }
        }
    </style>
</head>
<body>
    <div class="invoice-container">
        <!-- Header -->
        <div class="header">
            <div>
                <div class="company-name">${COMPANY_INFO.name}</div>
            </div>
            <div>
                <div class="invoice-title">FAKTÚRA</div>
                <div class="invoice-subtitle">Daňový doklad</div>
            </div>
        </div>
        
        <!-- Invoice Details -->
        <div class="invoice-details">
            <div class="invoice-number">Číslo faktúry: ${invoiceData.invoiceNumber}</div>
            <div><strong>Dátum vystavenia:</strong> ${formatDate(invoiceData.createdAt)}</div>
            <div><strong>Dátum splatnosti:</strong> ${formatDate(invoiceData.createdAt)}</div>
            <div><strong>Číslo objednávky:</strong> #${invoiceData.order?.orderNumber || 'N/A'}</div>
        </div>
        
        <!-- Company and Customer Info -->
        <div class="info-section">
            <div class="info-block">
                <div class="info-title">Dodávateľ</div>
                <div class="info-content">
                    <strong>${COMPANY_INFO.name}</strong><br>
                    ${COMPANY_INFO.address}<br>
                    ${COMPANY_INFO.city}<br><br>
                    <strong>IČO:</strong> ${COMPANY_INFO.ico}<br>
                    <strong>DIČ:</strong> ${COMPANY_INFO.dic}<br>
                    <strong>IČ DPH:</strong> ${COMPANY_INFO.vatNumber}
                </div>
            </div>
            
            <div class="info-block">
                <div class="info-title">Odberateľ</div>
                <div class="info-content">
                    <strong>${invoiceData.customerName || 'Zákazník'}</strong><br>
                    ${invoiceData.customerPhone ? `Tel: ${invoiceData.customerPhone}<br>` : ''}
                    ${invoiceData.customerEmail ? `Email: ${invoiceData.customerEmail}<br>` : ''}
                </div>
            </div>
        </div>
        
        <!-- Items Table -->
        <table class="items-table">
            <thead>
                <tr>
                    <th style="width: 50%">Položka</th>
                    <th style="width: 10%">Mn.</th>
                    <th style="width: 20%">Jedn. cena</th>
                    <th style="width: 20%">Spolu</th>
                </tr>
            </thead>
            <tbody>
                ${(invoiceData.orderItems || []).map(item => `
                    <tr>
                        <td>
                            <strong>${item.name || 'Unknown Item'}</strong>
                            ${item.customizations ? `<div class="customizations">• ${item.customizations}</div>` : ''}
                        </td>
                        <td>${item.quantity || 1}</td>
                        <td>${formatCurrency(item.unitPrice || item.price || 0)}</td>
                        <td>${formatCurrency(item.totalPrice || 0)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        
        <!-- Totals -->
        <div class="totals-section">
            <div class="totals-box">
                <div class="totals-row">
                    <span>Medzisúčet:</span>
                    <span>${formatCurrency(invoiceData.subtotal || vatBreakdown.netAmount)}</span>
                </div>
                ${invoiceData.deliveryFee && invoiceData.deliveryFee > 0 ? `
                <div class="totals-row">
                    <span>Poplatok za doručenie:</span>
                    <span>${formatCurrency(invoiceData.deliveryFee)}</span>
                </div>
                ` : ''}
                <div class="totals-row">
                    <span>Základ DPH 19%:</span>
                    <span>${formatCurrency(vatBreakdown.netAmount)}</span>
                </div>
                <div class="totals-row">
                    <span>DPH 19%:</span>
                    <span>${formatCurrency(vatBreakdown.vatAmount)}</span>
                </div>
                <div class="totals-row final">
                    <span>CELKOM:</span>
                    <span>${formatCurrency(invoiceData.totalGross)}</span>
                </div>
            </div>
        </div>
        
        <!-- Footer -->
        <div class="footer">
            <div class="payment-info">
                <strong>Spôsob platby:</strong> 
                <span class="payment-method">${paymentMethods[invoiceData.paymentMethod] || invoiceData.paymentMethod}</span>
            </div>
            
            <div class="payment-status">UHRADENÉ</div>
            
            <div class="footer-note">
                Ďakujeme za vašu návštevu!<br>
                Palace Cafe & Street Food - Autentické chute od 2016
            </div>
        </div>
    </div>
</body>
</html>
  `;
}

/**
 * Generate invoice PDF using Puppeteer
 */
async function generateInvoicePDF(invoiceData) {
  let browser = null;
  
  try {
    console.log('🚀 Starting Puppeteer invoice generation...');
    
    // Launch browser
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Generate HTML content
    const htmlContent = generateInvoiceHTML(invoiceData);
    
    // Set HTML content
    await page.setContent(htmlContent, {
      waitUntil: 'networkidle0'
    });
    
    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm'
      },
      printBackground: true,
      preferCSSPageSize: true
    });
    
    console.log('✅ PDF generated successfully');
    return pdfBuffer;
    
  } catch (error) {
    console.error('❌ PDF generation failed:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  generateInvoicePDF,
  generateInvoiceNumber,
  getNextInvoiceCounter,
  calculateVATBreakdown,
  formatCurrency,
  COMPANY_INFO
};