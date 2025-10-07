/**
 * Palace Cafe & Street Food - Invoice Generator (FIXED VERSION)
 * Clean implementation with proper item processing and delivery handling
 * Your approach: DATA IN -> Clean customer -> Process items -> Build array -> Generate PDF
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
 * Clean Slovak/Hungarian characters for PDF compatibility
 * Comprehensive character mapping for better text rendering
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
    'ř': 'r', 'Ř': 'R',
    
    // Hungarian characters  
    'ő': 'o', 'Ő': 'O',
    'ű': 'u', 'Ű': 'U',
    
    // Common accented characters
    'á': 'a', 'Á': 'A',
    'é': 'e', 'É': 'E', 
    'í': 'i', 'Í': 'I',
    'ó': 'o', 'Ó': 'O',
    'ú': 'u', 'Ú': 'U',
    'ý': 'y', 'Ý': 'Y',
    'ô': 'o', 'Ô': 'O',
    'ä': 'a', 'Ä': 'A',
    'ü': 'u', 'Ü': 'U',
    'ö': 'o', 'Ö': 'O',
    
    // Additional problematic characters from your data
    'ÃÂ¡': 'á', 'ÃÂ': 'Á',
    'ÃÂ©': 'é', 'ÃÂ‰': 'É',
    'ÃÂ­': 'í', 'ÃÂ': 'Í',
    'ÃÂ³': 'ó', 'ÃÂ"': 'Ó',
    'ÃÂº': 'ú', 'ÃÂš': 'Ú'
  };
  
  // First pass: replace mapped characters
  let cleanText = text;
  for (const [original, replacement] of Object.entries(charMap)) {
    cleanText = cleanText.replace(new RegExp(original, 'g'), replacement);
  }
  
  // Second pass: remove any remaining non-ASCII characters
  cleanText = cleanText.replace(/[^\x00-\x7F]/g, '');
  
  return cleanText;
}

/**
 * Calculate VAT breakdown using exact method
 * GROSS = total amount, VAT = gross * 0.19, NET = GROSS - VAT
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
 * MAIN PROCESSING FUNCTION - Your clean approach implementation
 * Processes order data into clean array format for PDF generation
 */
function processOrderDataForInvoice(invoiceData) {
  console.log('🔄 Starting order data processing...');
  
  // STEP 1: Clean customer data
  const cleanCustomerData = {
    name: cleanTextForPDF(invoiceData.customerName || 'Zákazník'),
    phone: invoiceData.customerPhone || '',
    email: invoiceData.customerEmail || '',
    address: cleanTextForPDF(invoiceData.deliveryAddress || '')
  };
  
  console.log('✅ Customer data cleaned:', cleanCustomerData);
  
  // STEP 2: Process each ordered item into standardized format
  const processedItems = [];
  const orderItems = invoiceData.orderItems || [];
  
  orderItems.forEach((item, index) => {
    console.log(`🔄 Processing item ${index + 1}:`, item);
    
    // Parse quantity from name if present (e.g., "2x Baconburger")
    let rawName = item.name || 'Unknown Item';
    const match = rawName.match(/^(\d+)x\s*(.*)$/i);
    const quantity = match ? parseInt(match[1]) : (item.quantity || 1);
    let itemName = match ? match[2] : rawName;
    
    // Clean item name
    itemName = cleanTextForPDF(itemName);
    
    // Calculate unit price (totalPrice is already multiplied by quantity)
    const lineTotal = Math.round((item.totalPrice || item.unitPrice || 0) * 100) / 100;
    const unitPrice = quantity > 0 ? Math.round((lineTotal / quantity) * 100) / 100 : lineTotal;
    
    // Build description from customizations
    const descriptionParts = [];
    
    // Add sauce
    if (item.selectedSauce) {
      descriptionParts.push(`Omáčka: ${cleanTextForPDF(item.selectedSauce)}`);
    }
    
    // Add fries upgrade
    if (item.friesUpgrade && item.friesUpgrade !== 'regular' && item.friesUpgrade !== 'regular-fries') {
      descriptionParts.push(`Hranolky: ${cleanTextForPDF(item.friesUpgrade)}`);
    }
    
    // Add extras
    if (item.extras && Array.isArray(item.extras) && item.extras.length > 0) {
      const cleanExtras = item.extras.map(extra => cleanTextForPDF(extra));
      descriptionParts.push(`Extra: ${cleanExtras.join(', ')}`);
    }
    
    // Add removed items
    if (item.removeItems && Array.isArray(item.removeItems) && item.removeItems.length > 0) {
      const cleanRemoved = item.removeItems.map(removed => cleanTextForPDF(removed));
      descriptionParts.push(`Bez: ${cleanRemoved.join(', ')}`);
    }
    
    // Add special notes
    if (item.specialNotes) {
      descriptionParts.push(`Poznámka: ${cleanTextForPDF(item.specialNotes)}`);
    }

    // Add raw customizations string if present (fallback for unstructured data)
    if (item.customizations && typeof item.customizations === 'string' && item.customizations.trim() !== '') {
      descriptionParts.push(cleanTextForPDF(item.customizations));
    }    
    
    const description = descriptionParts.length > 0 ? descriptionParts.join(' | ') : null;
    
    // Create processed item
    const processedItem = {
      name: itemName,
      description: description,
      quantity: quantity,
      grossPrice: unitPrice
    };
    
    processedItems.push(processedItem);
    console.log('✅ Processed item:', processedItem);
  });
  
  // ============================================
  // CALCULATE PACKAGING FEE DYNAMICALLY (€0.50 per food item)
  // ============================================
  const PACKAGING_FEE_PER_ITEM = 0.50;
  
  // Categories that DON'T get packaging fee (non-food items)
  const nonFoodCategories = [
    'sides', 'nonalcoholic', 'sauces', 'coffees', 
    'lemonades', 'specialty', 'cocktails', 'alcohol', 
    'shots', 'desserts', 'dorucenie' // Also exclude delivery
  ];
  
  // Count food items from processed items
  let packagingFeeCount = 0;
  
  processedItems.forEach(item => {
    // Convert item name to slug-like format for comparison
    const itemSlug = item.name.toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    
    // Check if it's a food item (not in excluded categories)
    const isNonFood = nonFoodCategories.some(category => 
      itemSlug.includes(category) || 
      item.name.toLowerCase().includes(category)
    );
    
    if (!isNonFood) {
      packagingFeeCount += item.quantity;
    }
  });
  
  // Only add packaging fee if there are food items
  if (packagingFeeCount > 0) {
    const totalPackagingFee = packagingFeeCount * PACKAGING_FEE_PER_ITEM;
    
    const packagingItem = {
      name: 'Csomagolas',
      description: `Balenie (${packagingFeeCount}x)`,
      quantity: 1,
      grossPrice: totalPackagingFee
    };
    
    processedItems.push(packagingItem);
    console.log(`✅ Added packaging fee: ${packagingFeeCount} items = €${totalPackagingFee.toFixed(2)}`);
  } else {
    console.log('ℹ️ No packaging fee - no food items in order');
  }
  
  
  // STEP 3: Check if delivery order and add delivery fee
  if (invoiceData.order?.orderType?.trim().toUpperCase() === 'DELIVERY') {
    const deliveryItem = {
      name: 'Dorucenie',
      description: null,
      quantity: 1,
      grossPrice: 2.50
    };

    processedItems.push(deliveryItem);
    console.log('✅ Added delivery fee:', deliveryItem);
  }
  
  // STEP 4: Calculate total gross amount
  const totalGrossAmount = processedItems.reduce((sum, item) => {
    return sum + (item.grossPrice * item.quantity);
  }, 0);
  
  console.log('💰 Total gross amount calculated:', totalGrossAmount);
  
  // STEP 5: Calculate VAT breakdown
  const vatBreakdown = calculateVATBreakdown(totalGrossAmount);
  
  console.log('📊 VAT breakdown:', vatBreakdown);
  
  return {
    cleanCustomerData,
    processedItems,
    vatBreakdown,
    totalGrossAmount
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
 * Format date for display
 */
function formatDate(date) {
  return new Date(date).toLocaleDateString('sk-SK');
}

/**
 * Generate invoice PDF with your clean approach
 */
function generateInvoicePDF(invoiceData) {
  return new Promise((resolve, reject) => {
    try {
      console.log('🔄 Starting PDF generation...');
      
      // Process order data using your clean approach
      const { cleanCustomerData, processedItems, vatBreakdown } = processOrderDataForInvoice(invoiceData);
      
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
        console.log('✅ PDF generation completed successfully');
        resolve(pdfData);
      });
      
      // Header
      doc.fontSize(22)
         .fillColor(COLORS.primary)
         .text(COMPANY_INFO.name, 50, 50);
      
      doc.fontSize(18)
         .fillColor(COLORS.secondary)
         .text(cleanTextForPDF('FAKTÚRA'), 400, 50, { align: 'right' });
      
      doc.fontSize(10)
         .fillColor(COLORS.light)
         .text(cleanTextForPDF('Danový doklad'), 400, 75, { align: 'right' })
      
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
         .text(cleanTextForPDF('Faktúra c.:'), 400, y)
         .font('Helvetica-Bold')
         .fillColor(COLORS.primary)
         .text(invoiceData.invoiceNumber, 400, y + 15);
      
      y += 40;
      doc.font('Helvetica')
         .fillColor(COLORS.dark)
         .fontSize(10)
         .text(cleanTextForPDF('Dátum vystavenia:'), 400, y)
         .text(formatDate(invoiceData.createdAt), 400, y + 12)
         .text(cleanTextForPDF('Dátum splatnosti:'), 400, y + 30)
         .text(formatDate(invoiceData.createdAt), 400, y + 42)
         .text(cleanTextForPDF('Dátum dodanie:'), 400, y + 60)
         .text(formatDate(invoiceData.createdAt), 400, y + 72);
      
      y += 100;
      doc.text(cleanTextForPDF('Císlo objednávky:'), 400, y)
         .font('Helvetica-Bold')
         .text(`#${invoiceData.order?.orderNumber || 'N/A'}`, 400, y + 12);
      
      // Company info
      y = 120;
      doc.font('Helvetica-Bold')
         .fillColor(COLORS.secondary)
         .fontSize(11)
         .text(cleanTextForPDF('Dodávateľ'), 50, y);
      
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
      
      // Customer info (using cleaned data)
      y = 220;
      doc.font('Helvetica-Bold')
         .fillColor(COLORS.secondary)
         .fontSize(11)
         .text(cleanTextForPDF('Odberateľ'), 50, y);
      
      y += 20;
      let customerY = y;
      doc.font('Helvetica')
         .fillColor(COLORS.dark)
         .fontSize(10)
         .text(cleanCustomerData.name, 50, customerY);
      
      customerY += 12;
      
      if (cleanCustomerData.phone) {
        doc.text(`Tel: ${cleanCustomerData.phone}`, 50, customerY);
        customerY += 12;
      }
      
      if (cleanCustomerData.email) {
        doc.text(`Email: ${cleanCustomerData.email}`, 50, customerY);
        customerY += 12;
      }
      
      if (cleanCustomerData.address && invoiceData.orderType?.trim().toUpperCase() === 'DELIVERY') {
        doc.text(`Adresa: ${cleanCustomerData.address}`, 50, customerY);
        customerY += 12;
      }
      
      // Items table header
      y = 300;
      
      doc.fontSize(10)
         .font('Helvetica-Bold')
         .fillColor(COLORS.dark);
      
      doc.rect(50, y, 495, 20)
         .fill(COLORS.background);
      
      doc.fillColor(COLORS.dark)
         .text(cleanTextForPDF('Položka'), 55, y + 6)
         .text('Mn.', 300, y + 6)
         .text(cleanTextForPDF('Cena'), 350, y + 6)
         .text(cleanTextForPDF('Spolu'), 470, y + 6);
      
      y += 25;
      
      // Render each processed item (YOUR CLEAN APPROACH)
      doc.font('Helvetica').fontSize(9);
      
      processedItems.forEach((item, index) => {
        console.log(`📄 Rendering item ${index + 1} in PDF:`, item);
        
        // Check for page break
        if (y > 700) {
          doc.addPage();
          y = 50;
        }
        
        // Item name and basic info
        doc.fillColor(COLORS.dark)
           .text(item.name, 55, y, { width: 240 })
           .text(item.quantity.toString(), 300, y)
           .text(formatCurrency(item.grossPrice), 350, y)
           .text(formatCurrency(item.grossPrice * item.quantity), 470, y);
        
        // Add description if exists
        if (item.description) {
          y += 12;
          doc.fontSize(8)
             .fillColor(COLORS.light)
             .text(`• ${item.description}`, 60, y, { width: 230 });
          doc.fontSize(9); // Reset font size
        }
        
        y += 20;
        
        // Add separator line (except for last item)
        if (index < processedItems.length - 1) {
          doc.strokeColor('#eeeeee')
             .lineWidth(0.5)
             .moveTo(55, y - 5)
             .lineTo(540, y - 5)
             .stroke();
        }
      });
      
      // Table bottom line
      doc.strokeColor(COLORS.secondary)
         .lineWidth(1)
         .moveTo(50, y)
         .lineTo(545, y)
         .stroke();
      
      y += 20;
      
      // VAT Summary (using calculated breakdown)
      y = Math.max(y, 500);
      
      doc.rect(300, y, 245, 100)
         .stroke(COLORS.light);
      
      y += 15;
      
      doc.fontSize(10)
         .fillColor(COLORS.dark)
         .text(cleanTextForPDF('Medzisúčet'), 310, y)
         .text(formatCurrency(vatBreakdown.grossAmount), 480, y, { align: 'right' });
      
      y += 15;
      doc.text(cleanTextForPDF('Základ DPH 19%:'), 310, y)
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
         .text(cleanTextForPDF('CELKOM:'), 310, y)
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
         .text(cleanTextForPDF('Spôsob platby:'), 50, y);
      
      doc.font('Helvetica')
         .fillColor(COLORS.dark)
         .text(cleanTextForPDF(paymentMethods[invoiceData.paymentMethod] || invoiceData.paymentMethod), 150, y);
      
      if (invoiceData.paymentMethod === 'CARD') {
        y += 15;
        doc.font('Helvetica-Bold')
           .fillColor(COLORS.primary)
           .text(cleanTextForPDF('UHRADENÉ'), 50, y);
      }
      
      y += 30;
      doc.fontSize(8)
         .fillColor(COLORS.light)
         .text('Dakujeme za vasu objednavku!', 50, y)
         .text('Palace Cafe & Street Food - Autentické chute od 2021', 50, y + 12);
      
      doc.end();
      
    } catch (error) {
      console.error('❌ PDF generation error:', error);
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
  processOrderDataForInvoice, // Export the new processing function
  cleanTextForPDF, // Export cleaning function
  COMPANY_INFO
};