/**
 * Palace Cafe & Street Food - PDFmake Invoice Generator
 * Reliable server-friendly PDF generation with proper UTF-8 support
 * Uses your exact VAT calculation: VAT = GROSS * 0.19, NET = GROSS - VAT
 * Slovak language only
 */

const pdfMake = require('pdfmake/build/pdfmake');
const pdfFonts = require('pdfmake/build/vfs_fonts');

// Set up fonts for PDFmake
pdfMake.vfs = pdfFonts.pdfMake.vfs;

// Company details
const COMPANY_INFO = {
  name: 'Palace Cafe & Street Food s.r.o.',
  address: 'Hradná 168/2',
  city: '945 01 Komárno',
  ico: '56384840',
  dic: '2122291578',
  vatNumber: 'SK2122291578'
};

// Brand colors (PDFmake uses arrays for RGB)
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
 * Generate invoice PDF using PDFmake
 */
function generateInvoicePDF(invoiceData) {
  return new Promise((resolve, reject) => {
    try {
      console.log('🚀 Starting PDFmake invoice generation...');
      
      const vatBreakdown = calculateVATBreakdown(invoiceData.totalGross);
      
      // Payment method translations
      const paymentMethods = {
        'CASH': 'Hotovosť',
        'CARD': 'Karta',
        'ONLINE': 'Online platba'
      };

      // Create items table data
      const itemsTableBody = [
        // Header row
        [
          { text: 'Položka', style: 'tableHeader' },
          { text: 'Mn.', style: 'tableHeader', alignment: 'center' },
          { text: 'Jedn. cena', style: 'tableHeader', alignment: 'right' },
          { text: 'Spolu', style: 'tableHeader', alignment: 'right' }
        ]
      ];

      // Add items
      (invoiceData.orderItems || []).forEach(item => {
        const itemRow = [
          {
            text: [
              { text: item.name || 'Unknown Item', style: 'itemName' },
              item.customizations ? 
                { text: `\n• ${item.customizations}`, style: 'itemCustomizations' } : 
                ''
            ]
          },
          { text: (item.quantity || 1).toString(), alignment: 'center' },
          { text: formatCurrency(item.unitPrice || item.price || 0), alignment: 'right' },
          { text: formatCurrency(item.totalPrice || 0), alignment: 'right' }
        ];
        itemsTableBody.push(itemRow);
      });

      // PDF document definition
      const docDefinition = {
        pageSize: 'A4',
        pageMargins: [40, 40, 40, 40],
        
        content: [
          // Header
          {
            columns: [
              {
                width: '60%',
                text: COMPANY_INFO.name,
                style: 'companyName'
              },
              {
                width: '40%',
                alignment: 'right',
                stack: [
                  { text: 'FAKTÚRA', style: 'invoiceTitle' },
                  { text: 'Daňový doklad', style: 'invoiceSubtitle' }
                ]
              }
            ],
            margin: [0, 0, 0, 20]
          },
          
          // Horizontal line
          {
            canvas: [
              {
                type: 'line',
                x1: 0, y1: 0,
                x2: 515, y2: 0,
                lineWidth: 2,
                lineColor: COLORS.eucalyptusGreen
              }
            ],
            margin: [0, 0, 0, 20]
          },
          
          // Invoice details box
          {
            table: {
              widths: ['*'],
              body: [
                [{
                  stack: [
                    { text: `Číslo faktúry: ${invoiceData.invoiceNumber}`, style: 'invoiceNumber' },
                    { text: `Dátum vystavenia: ${formatDate(invoiceData.createdAt)}`, style: 'invoiceDetail' },
                    { text: `Dátum splatnosti: ${formatDate(invoiceData.createdAt)}`, style: 'invoiceDetail' },
                    { text: `Číslo objednávky: #${invoiceData.order?.orderNumber || 'N/A'}`, style: 'invoiceDetail' }
                  ],
                  fillColor: COLORS.veryLightGray,
                  margin: [10, 10, 10, 10]
                }]
              ]
            },
            layout: 'noBorders',
            margin: [0, 0, 0, 20]
          },
          
          // Company and customer info
          {
            columns: [
              {
                width: '48%',
                stack: [
                  { text: 'Dodávateľ', style: 'sectionTitle' },
                  { text: COMPANY_INFO.name, style: 'companyDetail', bold: true },
                  { text: COMPANY_INFO.address, style: 'companyDetail' },
                  { text: COMPANY_INFO.city, style: 'companyDetail' },
                  { text: '', margin: [0, 5] }, // Spacer
                  { text: `IČO: ${COMPANY_INFO.ico}`, style: 'companyDetail' },
                  { text: `DIČ: ${COMPANY_INFO.dic}`, style: 'companyDetail' },
                  { text: `IČ DPH: ${COMPANY_INFO.vatNumber}`, style: 'companyDetail' }
                ]
              },
              {
                width: '4%',
                text: '' // Spacer column
              },
              {
                width: '48%',
                stack: [
                  { text: 'Odberateľ', style: 'sectionTitle' },
                  { text: invoiceData.customerName || 'Zákazník', style: 'customerDetail', bold: true },
                  invoiceData.customerPhone ? 
                    { text: `Tel: ${invoiceData.customerPhone}`, style: 'customerDetail' } : {},
                  invoiceData.customerEmail ? 
                    { text: `Email: ${invoiceData.customerEmail}`, style: 'customerDetail' } : {}
                ]
              }
            ],
            margin: [0, 0, 0, 30]
          },
          
          // Items table
          {
            table: {
              headerRows: 1,
              widths: ['50%', '10%', '20%', '20%'],
              body: itemsTableBody
            },
            layout: {
              fillColor: function (rowIndex) {
                return (rowIndex === 0) ? COLORS.eucalyptusGreen : 
                       (rowIndex % 2 === 0) ? '#fafafa' : null;
              },
              hLineWidth: function (i, node) {
                return (i === 0 || i === 1 || i === node.table.body.length) ? 2 : 1;
              },
              vLineWidth: function () { return 1; },
              hLineColor: function (i, node) {
                return (i === 0 || i === 1 || i === node.table.body.length) ? 
                  COLORS.eucalyptusGreen : '#eeeeee';
              },
              vLineColor: function () { return '#eeeeee'; }
            },
            margin: [0, 0, 0, 20]
          },
          
          // Totals section
          {
            columns: [
              { width: '60%', text: '' }, // Spacer
              {
                width: '40%',
                table: {
                  widths: ['60%', '40%'],
                  body: [
                    ['Medzisúčet:', { text: formatCurrency(invoiceData.subtotal || vatBreakdown.netAmount), alignment: 'right' }],
                    ...(invoiceData.deliveryFee && invoiceData.deliveryFee > 0 ? 
                      [['Poplatok za doručenie:', { text: formatCurrency(invoiceData.deliveryFee), alignment: 'right' }]] : 
                      []
                    ),
                    ['Základ DPH 19%:', { text: formatCurrency(vatBreakdown.netAmount), alignment: 'right' }],
                    ['DPH 19%:', { text: formatCurrency(vatBreakdown.vatAmount), alignment: 'right' }],
                    [
                      { text: 'CELKOM:', style: 'totalLabel' },
                      { text: formatCurrency(invoiceData.totalGross), style: 'totalAmount', alignment: 'right' }
                    ]
                  ]
                },
                layout: {
                  fillColor: function (rowIndex, node) {
                    return (rowIndex === node.table.body.length - 1) ? COLORS.eucalyptusGreen : null;
                  },
                  hLineWidth: function (i, node) {
                    return (i === node.table.body.length - 1) ? 2 : 1;
                  },
                  hLineColor: function (i, node) {
                    return (i === node.table.body.length - 1) ? COLORS.eucalyptusGreen : COLORS.lightGray;
                  }
                }
              }
            ],
            margin: [0, 0, 0, 30]
          },
          
          // Footer
          {
            stack: [
              {
                text: [
                  { text: 'Spôsob platby: ', style: 'footerLabel' },
                  { text: paymentMethods[invoiceData.paymentMethod] || invoiceData.paymentMethod, style: 'footerValue' }
                ],
                margin: [0, 0, 0, 10]
              },
              { text: 'UHRADENÉ', style: 'paidStatus', margin: [0, 0, 0, 20] },
              {
                text: 'Ďakujeme za vašu návštevu!\nPalace Cafe & Street Food - Autentické chute od 2016',
                style: 'footerNote',
                alignment: 'center'
              }
            ]
          }
        ],
        
        // Styles definition
        styles: {
          companyName: {
            fontSize: 18,
            bold: true,
            color: COLORS.rusticRed
          },
          invoiceTitle: {
            fontSize: 16,
            bold: true,
            color: COLORS.eucalyptusGreen
          },
          invoiceSubtitle: {
            fontSize: 9,
            color: COLORS.lightGray,
            margin: [0, 2, 0, 0]
          },
          invoiceNumber: {
            fontSize: 14,
            bold: true,
            color: COLORS.rusticRed,
            margin: [0, 0, 0, 5]
          },
          invoiceDetail: {
            fontSize: 10,
            margin: [0, 2, 0, 0]
          },
          sectionTitle: {
            fontSize: 12,
            bold: true,
            color: COLORS.eucalyptusGreen,
            margin: [0, 0, 0, 8]
          },
          companyDetail: {
            fontSize: 9,
            margin: [0, 1, 0, 0]
          },
          customerDetail: {
            fontSize: 9,
            margin: [0, 1, 0, 0]
          },
          tableHeader: {
            fontSize: 10,
            bold: true,
            color: 'white',
            margin: [5, 5, 5, 5]
          },
          itemName: {
            fontSize: 10,
            bold: true
          },
          itemCustomizations: {
            fontSize: 8,
            color: COLORS.lightGray,
            italics: true
          },
          totalLabel: {
            fontSize: 12,
            bold: true,
            color: 'white'
          },
          totalAmount: {
            fontSize: 12,
            bold: true,
            color: 'white'
          },
          footerLabel: {
            fontSize: 10,
            bold: true
          },
          footerValue: {
            fontSize: 10,
            color: COLORS.eucalyptusGreen
          },
          paidStatus: {
            fontSize: 12,
            bold: true,
            color: COLORS.rusticRed
          },
          footerNote: {
            fontSize: 8,
            color: COLORS.lightGray
          }
        },
        
        defaultStyle: {
          font: 'Helvetica',
          fontSize: 10,
          color: COLORS.darkGray
        }
      };

      // Generate PDF
      const pdfDoc = pdfMake.createPdf(docDefinition);
      
      pdfDoc.getBuffer((buffer) => {
        console.log('✅ PDFmake invoice generated successfully');
        resolve(buffer);
      });

    } catch (error) {
      console.error('❌ PDFmake invoice generation failed:', error);
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