/**
 * Palace Cafe & Street Food - Email Service
 * Professional email service with SendGrid integration
 * Invoice delivery and order notifications
 * Bilingual Slovak/Hungarian support
 */

const sgMail = require('@sendgrid/mail');
const { formatCurrency } = require('./invoice-generator');

// Initialize SendGrid with API key from environment
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// Email configuration
const EMAIL_CONFIG = {
  from: {
    email: process.env.FROM_EMAIL || 'noreply@palacecafe.sk',
    name: 'Palace Cafe & Street Food'
  },
  replyTo: process.env.REPLY_TO_EMAIL || 'info@palacecafe.sk'
};

/**
 * Send invoice email with PDF attachment
 * @param {Object} invoiceData - Invoice data from database
 * @param {Buffer} pdfBuffer - Generated PDF buffer
 * @param {string} customerEmail - Customer's email address
 * @returns {Promise<Object>} SendGrid response
 */
async function sendInvoiceEmail(invoiceData, pdfBuffer, customerEmail) {
  try {
    console.log(`📧 Preparing invoice email for ${customerEmail}`);
    
    if (!customerEmail || !customerEmail.includes('@')) {
      console.log('⚠️ Invalid email address, skipping invoice email');
      return { success: false, error: 'Invalid email address' };
    }

    if (!process.env.SENDGRID_API_KEY) {
      console.log('⚠️ SendGrid not configured, skipping email send');
      return { success: false, error: 'Email service not configured' };
    }

    // Generate email content
    const emailContent = generateInvoiceEmailContent(invoiceData);
    
    // Prepare email message
    const msg = {
      to: customerEmail,
      from: EMAIL_CONFIG.from,
      replyTo: EMAIL_CONFIG.replyTo,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      attachments: [
        {
          content: pdfBuffer.toString('base64'),
          filename: `faktura-${invoiceData.invoiceNumber}.pdf`,
          type: 'application/pdf',
          disposition: 'attachment'
        }
      ],
      // Email categories for SendGrid analytics
      categories: ['invoice', 'palace-cafe'],
      // Custom args for tracking
      customArgs: {
        invoice_id: invoiceData.id.toString(),
        order_id: invoiceData.orderId.toString(),
        invoice_number: invoiceData.invoiceNumber
      }
    };

    // Send email
    console.log(`📤 Sending invoice email to ${customerEmail}...`);
    const response = await sgMail.send(msg);
    
    console.log(`✅ Invoice email sent successfully to ${customerEmail}`);
    return { 
      success: true, 
      messageId: response[0].headers['x-message-id'],
      response: response[0]
    };
    
  } catch (error) {
    console.error('❌ Failed to send invoice email:', error);
    
    // Log detailed error for debugging
    if (error.response) {
      console.error('SendGrid error details:', {
        statusCode: error.response.statusCode,
        body: error.response.body
      });
    }
    
    return { 
      success: false, 
      error: error.message,
      details: error.response?.body || null
    };
  }
}

/**
 * Generate email content for invoice
 * @param {Object} invoiceData - Invoice data
 * @returns {Object} Email content with subject, html, and text
 */
function generateInvoiceEmailContent(invoiceData) {
  const orderType = invoiceData.order?.orderType || 'PICKUP';
  const orderTypeText = orderType === 'DELIVERY' ? 'doručenie / szállítás' : 'vyzdvihnutie / átvétel';
  const paymentMethodText = getPaymentMethodText(invoiceData.paymentMethod);
  
  const subject = `Faktúra ${invoiceData.invoiceNumber} - Palace Cafe & Street Food`;
  
  const html = `
<!DOCTYPE html>
<html lang="sk">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subject}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            background: linear-gradient(135deg, #38141A, #1D665D);
            color: white;
            text-align: center;
            padding: 30px 20px;
            border-radius: 10px;
            margin-bottom: 30px;
        }
        .header h1 {
            margin: 0;
            font-size: 24px;
        }
        .header p {
            margin: 10px 0 0 0;
            opacity: 0.9;
        }
        .content {
            background: #f9f9f9;
            padding: 25px;
            border-radius: 10px;
            margin-bottom: 20px;
        }
        .invoice-info {
            background: white;
            padding: 20px;
            border-radius: 8px;
            border-left: 4px solid #1D665D;
            margin: 20px 0;
        }
        .invoice-info h3 {
            color: #38141A;
            margin-top: 0;
        }
        .detail-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #eee;
        }
        .detail-row:last-child {
            border-bottom: none;
            font-weight: bold;
            color: #38141A;
        }
        .items-summary {
            background: white;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .items-summary h4 {
            color: #1D665D;
            margin-top: 0;
        }
        .item {
            padding: 5px 0;
            color: #666;
        }
        .footer {
            text-align: center;
            padding: 20px;
            color: #666;
            font-size: 14px;
        }
        .button {
            display: inline-block;
            background: #1D665D;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 5px;
            margin: 20px 0;
        }
        @media only screen and (max-width: 600px) {
            body { padding: 10px; }
            .detail-row { flex-direction: column; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🍽️ Palace Cafe & Street Food</h1>
        <p>Ďakujeme za vašu objednávku! / Köszönjük a rendelést!</p>
    </div>
    
    <div class="content">
        <h2>Dobrý deň ${invoiceData.customerName},</h2>
        <p><strong>Jó napot ${invoiceData.customerName},</strong></p>
        
        <p>
            Ďakujeme za vašu objednávku v Palace Cafe & Street Food! V prílohe nájdete faktúru za vašu objednávku.
        </p>
        <p>
            <em>Köszönjük a Palace Cafe & Street Food-ban leadott rendelését! A mellékletben megtalálja a rendeléséhez tartozó számlát.</em>
        </p>
        
        <div class="invoice-info">
            <h3>📋 Detaily objednávky / Rendelés részletei</h3>
            <div class="detail-row">
                <span>Číslo faktúry / Számla száma:</span>
                <strong>${invoiceData.invoiceNumber}</strong>
            </div>
            <div class="detail-row">
                <span>Číslo objednávky / Rendelés száma:</span>
                <strong>#${invoiceData.order?.orderNumber || 'N/A'}</strong>
            </div>
            <div class="detail-row">
                <span>Typ objednávky / Rendelés típusa:</span>
                <strong>${orderTypeText}</strong>
            </div>
            <div class="detail-row">
                <span>Spôsob platby / Fizetési mód:</span>
                <strong>${paymentMethodText}</strong>
            </div>
            <div class="detail-row">
                <span>Celková suma / Végösszeg:</span>
                <strong>${formatCurrency(invoiceData.totalGross)}</strong>
            </div>
        </div>
        
        <div class="items-summary">
            <h4>📦 Vaše položky / Az Ön tételei</h4>
            ${generateItemsList(invoiceData.orderItems)}
        </div>
        
        ${orderType === 'DELIVERY' ? generateDeliveryInfo(invoiceData) : generatePickupInfo()}
    </div>
    
    <div class="footer">
        <p>
            <strong>Palace Cafe & Street Food s.r.o.</strong><br>
            Hradná 168/2, 945 01 Komárno<br>
            IČO: 56384840 | DIČ: 2122291578 | IČ DPH: SK2122291578
        </p>
        
        <p style="margin-top: 30px;">
            🙏 Ďakujeme za dôveru a tešíme sa na vašu ďalšiu návštevu!<br>
            <em>Köszönjük a bizalmát és várjuk újabb látogatását!</em>
        </p>
        
        <p style="font-size: 12px; color: #999; margin-top: 20px;">
            Tento email bol odoslaný automaticky. Prosím neodpovedajte na túto správu.<br>
            <em>Ez az email automatikusan lett elküldve. Kérjük, ne válaszoljon erre az üzenetre.</em>
        </p>
    </div>
</body>
</html>
  `;
  
  // Plain text version for email clients that don't support HTML
  const text = `
Palace Cafe & Street Food - Faktúra ${invoiceData.invoiceNumber}

Dobrý deň ${invoiceData.customerName},

Ďakujeme za vašu objednávku v Palace Cafe & Street Food!

DETAILY OBJEDNÁVKY:
- Číslo faktúry: ${invoiceData.invoiceNumber}
- Číslo objednávky: #${invoiceData.order?.orderNumber || 'N/A'}
- Typ: ${orderTypeText}
- Platba: ${paymentMethodText}
- Celková suma: ${formatCurrency(invoiceData.totalGross)}

V prílohe nájdete PDF faktúru.

Ďakujeme za dôveru!
Palace Cafe & Street Food s.r.o.
Hradná 168/2, 945 01 Komárno
`;

  return { subject, html, text };
}

/**
 * Generate HTML list of order items
 */
function generateItemsList(orderItems) {
  if (!orderItems || !Array.isArray(orderItems)) {
    return '<p>Informácie o položkách nie sú dostupné.</p>';
  }
  
  return orderItems.map(item => `
    <div class="item">
      <strong>${item.name || 'Neznámy produkt'}</strong> - ${item.quantity}x ${formatCurrency(item.unitPrice || 0)}
      ${item.customizations ? `<br><small style="color: #999;">• ${item.customizations}</small>` : ''}
    </div>
  `).join('');
}

/**
 * Generate delivery information section
 */
function generateDeliveryInfo(invoiceData) {
  return `
    <div class="invoice-info">
      <h3>🚚 Informácie o doručení / Szállítási információk</h3>
      <p>
        Vaša objednávka bude doručená na zadanú adresu. Platba prebehne pri doručení.
      </p>
      <p>
        <em>Rendelését a megadott címre szállítjuk. A fizetés kiszállításkor történik.</em>
      </p>
    </div>
  `;
}

/**
 * Generate pickup information section  
 */
function generatePickupInfo() {
  return `
    <div class="invoice-info">
      <h3>🏪 Informácie o vyzdvihnutí / Átvételi információk</h3>
      <p>
        <strong>Adresa / Cím:</strong> Hradná 168/2, 945 01 Komárno<br>
        Vaša objednávka bude pripravená na vyzdvihnutie. Platba prebehne pri prevzatí.
      </p>
      <p>
        <em>Rendelése átvételre készül. A fizetés átvételkor történik.</em>
      </p>
    </div>
  `;
}

/**
 * Get payment method text in both languages
 */
function getPaymentMethodText(paymentMethod) {
  const methods = {
    'CASH': 'Hotovosť / Készpénz',
    'CARD': 'Karta / Kártya', 
    'ONLINE': 'Online platba / Online fizetés'
  };
  
  return methods[paymentMethod] || paymentMethod;
}

/**
 * Send order confirmation email (without invoice)
 * @param {Object} orderData - Order data
 * @param {string} customerEmail - Customer email
 */
async function sendOrderConfirmationEmail(orderData, customerEmail) {
  try {
    console.log(`📧 Preparing order confirmation for ${customerEmail}`);
    
    if (!customerEmail || !process.env.SENDGRID_API_KEY) {
      return { success: false, error: 'Email service not available' };
    }

    const orderType = orderData.orderType === 'DELIVERY' ? 'doručenie / szállítás' : 'vyzdvihnutie / átvétel';
    
    const msg = {
      to: customerEmail,
      from: EMAIL_CONFIG.from,
      replyTo: EMAIL_CONFIG.replyTo,
      subject: `Potvrdenie objednávky #${orderData.orderNumber} - Palace Cafe`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #38141A, #1D665D); color: white; text-align: center; padding: 30px; border-radius: 10px;">
            <h1>🍽️ Palace Cafe & Street Food</h1>
            <p>Objednávka prijatá! / Rendelés elfogadva!</p>
          </div>
          
          <div style="padding: 30px; background: #f9f9f9; border-radius: 10px; margin-top: 20px;">
            <h2>Dobrý deň ${orderData.customerName},</h2>
            <p>Vaša objednávka #${orderData.orderNumber} bola úspešne prijatá!</p>
            <p><em>Az Ön ${orderData.orderNumber} számú rendelését sikeresen felvettük!</em></p>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p><strong>Typ:</strong> ${orderType}</p>
              <p><strong>Suma:</strong> ${formatCurrency(orderData.total)}</p>
              <p><strong>Stav:</strong> Spracováva sa / Feldolgozás alatt</p>
            </div>
            
            <p>Budeme vás informovať o ďalších krokoch emailom.</p>
            <p><em>A további lépésekről email-ben tájékoztatjuk.</em></p>
          </div>
        </div>
      `,
      categories: ['order-confirmation', 'palace-cafe']
    };

    const response = await sgMail.send(msg);
    console.log(`✅ Order confirmation sent to ${customerEmail}`);
    
    return { success: true, messageId: response[0].headers['x-message-id'] };
    
  } catch (error) {
    console.error('❌ Failed to send order confirmation:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Test email configuration
 */
async function testEmailConfig() {
  try {
    if (!process.env.SENDGRID_API_KEY) {
      return { 
        success: false, 
        error: 'SENDGRID_API_KEY environment variable not set' 
      };
    }
    
    if (!process.env.FROM_EMAIL) {
      return { 
        success: false, 
        error: 'FROM_EMAIL environment variable not set' 
      };
    }
    
    console.log('✅ Email configuration appears valid');
    return { 
      success: true, 
      config: {
        hasApiKey: !!process.env.SENDGRID_API_KEY,
        fromEmail: process.env.FROM_EMAIL,
        replyTo: process.env.REPLY_TO_EMAIL
      }
    };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendInvoiceEmail,
  sendOrderConfirmationEmail, 
  testEmailConfig,
  EMAIL_CONFIG
};