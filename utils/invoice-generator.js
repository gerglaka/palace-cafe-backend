/**
 * Palace Cafe & Street Food - React-PDF Invoice Generator (No JSX)
 * Pure JavaScript React elements, no transpilation needed
 * Uses your exact VAT calculation: VAT = GROSS * 0.19, NET = GROSS - VAT
 * Slovak language only
 */

const React = require('react');
const { Document, Page, Text, View, StyleSheet, pdf } = require('@react-pdf/renderer');

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
  veryLightGray: '#f5f5f5',
  white: '#ffffff'
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

// Define styles for React-PDF
const styles = StyleSheet.create({
  page: {
    backgroundColor: COLORS.white,
    padding: 30,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: COLORS.darkGray
  },
  
  // Header styles
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
    paddingBottom: 15,
    borderBottomWidth: 3,
    borderBottomColor: COLORS.eucalyptusGreen
  },
  companyName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.rusticRed
  },
  invoiceTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.eucalyptusGreen,
    textAlign: 'right'
  },
  invoiceSubtitle: {
    fontSize: 9,
    color: COLORS.lightGray,
    textAlign: 'right',
    marginTop: 3
  },
  
  // Invoice details box
  invoiceDetails: {
    backgroundColor: COLORS.veryLightGray,
    padding: 12,
    marginBottom: 20,
    borderRadius: 3
  },
  invoiceNumber: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.rusticRed,
    marginBottom: 6
  },
  invoiceDetail: {
    fontSize: 9,
    marginBottom: 3
  },
  
  // Info section
  infoSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20
  },
  infoBlock: {
    width: '48%'
  },
  infoTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    color: COLORS.eucalyptusGreen,
    marginBottom: 6
  },
  infoContent: {
    fontSize: 9,
    lineHeight: 1.4
  },
  
  // Table styles
  table: {
    marginBottom: 15
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: COLORS.eucalyptusGreen,
    padding: 8,
    color: COLORS.white,
    fontWeight: 'bold',
    fontSize: 9
  },
  tableRow: {
    flexDirection: 'row',
    padding: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
    minHeight: 25
  },
  tableRowEven: {
    backgroundColor: '#fafafa'
  },
  
  // Table column widths
  col1: { width: '50%', paddingRight: 5 },
  col2: { width: '12%', textAlign: 'center' },
  col3: { width: '19%', textAlign: 'right' },
  col4: { width: '19%', textAlign: 'right' },
  
  itemName: {
    fontWeight: 'bold',
    fontSize: 9
  },
  itemCustomizations: {
    fontSize: 8,
    color: COLORS.lightGray,
    fontStyle: 'italic',
    marginTop: 2
  },
  
  // Totals section
  totalsSection: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 20
  },
  totalsTable: {
    width: 250,
    border: 1,
    borderColor: COLORS.lightGray
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
    fontSize: 9
  },
  totalsRowFinal: {
    backgroundColor: COLORS.eucalyptusGreen,
    color: COLORS.white,
    fontWeight: 'bold',
    fontSize: 11,
    borderBottomWidth: 0
  },
  
  // Footer
  footer: {
    marginTop: 25,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: '#eeeeee'
  },
  paymentInfo: {
    fontSize: 10,
    marginBottom: 8
  },
  paymentMethod: {
    fontWeight: 'bold',
    color: COLORS.eucalyptusGreen
  },
  paidStatus: {
    fontSize: 11,
    fontWeight: 'bold',
    color: COLORS.rusticRed,
    marginVertical: 8
  },
  footerNote: {
    fontSize: 8,
    color: COLORS.lightGray,
    textAlign: 'center',
    marginTop: 12
  }
});

/**
 * Create React-PDF Document using React.createElement (no JSX)
 */
function createInvoiceDocument(invoiceData) {
  const vatBreakdown = calculateVATBreakdown(invoiceData.totalGross);
  
  // Payment method translations
  const paymentMethods = {
    'CASH': 'Hotovosť',
    'CARD': 'Karta',
    'ONLINE': 'Online platba'
  };

  return React.createElement(Document, null,
    React.createElement(Page, { size: "A4", style: styles.page },
      
      // Header
      React.createElement(View, { style: styles.header },
        React.createElement(Text, { style: styles.companyName }, COMPANY_INFO.name),
        React.createElement(View, null,
          React.createElement(Text, { style: styles.invoiceTitle }, "FAKTÚRA"),
          React.createElement(Text, { style: styles.invoiceSubtitle }, "Daňový doklad")
        )
      ),

      // Invoice Details
      React.createElement(View, { style: styles.invoiceDetails },
        React.createElement(Text, { style: styles.invoiceNumber }, 
          `Číslo faktúry: ${invoiceData.invoiceNumber}`
        ),
        React.createElement(Text, { style: styles.invoiceDetail }, 
          `Dátum vystavenia: ${formatDate(invoiceData.createdAt)}`
        ),
        React.createElement(Text, { style: styles.invoiceDetail }, 
          `Dátum splatnosti: ${formatDate(invoiceData.createdAt)}`
        ),
        React.createElement(Text, { style: styles.invoiceDetail }, 
          `Číslo objednávky: #${invoiceData.order?.orderNumber || 'N/A'}`
        )
      ),

      // Company and Customer Info
      React.createElement(View, { style: styles.infoSection },
        React.createElement(View, { style: styles.infoBlock },
          React.createElement(Text, { style: styles.infoTitle }, "Dodávateľ"),
          React.createElement(View, { style: styles.infoContent },
            React.createElement(Text, { style: { fontWeight: 'bold' } }, COMPANY_INFO.name),
            React.createElement(Text, null, COMPANY_INFO.address),
            React.createElement(Text, null, COMPANY_INFO.city),
            React.createElement(Text, null, "\n"),
            React.createElement(Text, null, `IČO: ${COMPANY_INFO.ico}`),
            React.createElement(Text, null, `DIČ: ${COMPANY_INFO.dic}`),
            React.createElement(Text, null, `IČ DPH: ${COMPANY_INFO.vatNumber}`)
          )
        ),
        
        React.createElement(View, { style: styles.infoBlock },
          React.createElement(Text, { style: styles.infoTitle }, "Odberateľ"),
          React.createElement(View, { style: styles.infoContent },
            React.createElement(Text, { style: { fontWeight: 'bold' } }, 
              invoiceData.customerName || 'Zákazník'
            ),
            invoiceData.customerPhone && 
              React.createElement(Text, null, `Tel: ${invoiceData.customerPhone}`),
            invoiceData.customerEmail && 
              React.createElement(Text, null, `Email: ${invoiceData.customerEmail}`)
          )
        )
      ),

      // Items Table
      React.createElement(View, { style: styles.table },
        // Table Header
        React.createElement(View, { style: styles.tableHeader },
          React.createElement(Text, { style: styles.col1 }, "Položka"),
          React.createElement(Text, { style: styles.col2 }, "Mn."),
          React.createElement(Text, { style: styles.col3 }, "Jedn. cena"),
          React.createElement(Text, { style: styles.col4 }, "Spolu")
        ),
        
        // Table Rows
        ...(invoiceData.orderItems || []).map((item, index) =>
          React.createElement(View, { 
            key: index, 
            style: [styles.tableRow, index % 2 === 0 ? styles.tableRowEven : {}]
          },
            React.createElement(View, { style: styles.col1 },
              React.createElement(Text, { style: styles.itemName }, 
                item.name || 'Unknown Item'
              ),
              item.customizations && 
                React.createElement(Text, { style: styles.itemCustomizations }, 
                  `• ${item.customizations}`
                )
            ),
            React.createElement(Text, { style: styles.col2 }, (item.quantity || 1).toString()),
            React.createElement(Text, { style: styles.col3 }, 
              formatCurrency(item.unitPrice || item.price || 0)
            ),
            React.createElement(Text, { style: styles.col4 }, 
              formatCurrency(item.totalPrice || 0)
            )
          )
        )
      ),

      // Totals
      React.createElement(View, { style: styles.totalsSection },
        React.createElement(View, { style: styles.totalsTable },
          React.createElement(View, { style: styles.totalsRow },
            React.createElement(Text, null, "Medzisúčet:"),
            React.createElement(Text, null, formatCurrency(invoiceData.subtotal || vatBreakdown.netAmount))
          ),
          
          invoiceData.deliveryFee && invoiceData.deliveryFee > 0 &&
            React.createElement(View, { style: styles.totalsRow },
              React.createElement(Text, null, "Poplatok za doručenie:"),
              React.createElement(Text, null, formatCurrency(invoiceData.deliveryFee))
            ),
          
          React.createElement(View, { style: styles.totalsRow },
            React.createElement(Text, null, "Základ DPH 19%:"),
            React.createElement(Text, null, formatCurrency(vatBreakdown.netAmount))
          ),
          
          React.createElement(View, { style: styles.totalsRow },
            React.createElement(Text, null, "DPH 19%:"),
            React.createElement(Text, null, formatCurrency(vatBreakdown.vatAmount))
          ),
          
          React.createElement(View, { style: [styles.totalsRow, styles.totalsRowFinal] },
            React.createElement(Text, null, "CELKOM:"),
            React.createElement(Text, null, formatCurrency(invoiceData.totalGross))
          )
        )
      ),

      // Footer
      React.createElement(View, { style: styles.footer },
        React.createElement(Text, { style: styles.paymentInfo },
          "Spôsob platby: ",
          React.createElement(Text, { style: styles.paymentMethod },
            paymentMethods[invoiceData.paymentMethod] || invoiceData.paymentMethod
          )
        ),
        
        React.createElement(Text, { style: styles.paidStatus }, "UHRADENÉ"),
        
        React.createElement(Text, { style: styles.footerNote },
          "Ďakujeme za vašu návštevu!\nPalace Cafe & Street Food - Autentické chute od 2016"
        )
      )
    )
  );
}

/**
 * Generate invoice PDF using React-PDF
 */
async function generateInvoicePDF(invoiceData) {
  try {
    console.log('🚀 Starting React-PDF invoice generation...');
    
    // Create PDF document using React.createElement (no JSX)
    const doc = createInvoiceDocument(invoiceData);
    
    // Generate PDF buffer
    const pdfBuffer = await pdf(doc).toBuffer();
    
    console.log('✅ React-PDF invoice generated successfully');
    return pdfBuffer;
    
  } catch (error) {
    console.error('❌ React-PDF invoice generation failed:', error);
    throw error;
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