/**
 * Palace Cafe & Street Food - SendGrid Email Service
 * Temporary replacement for WebSupport SMTP
 * Invoice delivery and order notifications via SendGrid API
 */

const sgMail = require('@sendgrid/mail');
const { formatCurrency } = require('./invoice-generator');

// SendGrid configuration
const SENDGRID_CONFIG = {
  apiKey: process.env.SENDGRID_API_KEY,
  from: {
    email: process.env.SENDGRID_FROM_EMAIL || 'notifications@palacebar.sk',
    name: process.env.SENDGRID_FROM_NAME || 'Palace Cafe & Street Food'
  },
  replyTo: process.env.REPLY_TO_EMAIL || 'admin@palacebar.sk'
};

// Initialize SendGrid
let isInitialized = false;

function initializeSendGrid() {
  try {
    if (!process.env.SENDGRID_API_KEY) {
      console.log('⚠️ SendGrid not configured - SENDGRID_API_KEY not set');
      return false;
    }

    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    isInitialized = true;
    console.log('✅ SendGrid initialized successfully');
    return true;
    
  } catch (error) {
    console.error('❌ Failed to initialize SendGrid:', error);
    return false;
  }
}

/**
 * Send order status notification email via SendGrid
 */
async function sendOrderStatusEmail(orderData, customerEmail) {
  try {
    console.log(`Preparing simple status email for ${customerEmail}`);
    
    if (!customerEmail) {
      return { success: false, error: 'No email address provided' };
    }

    // Initialize SendGrid if not already done
    if (!isInitialized) {
      const initialized = initializeSendGrid();
      if (!initialized) {
        return { success: false, error: 'SendGrid not configured' };
      }
    }

    // Simple content based on status
    let subject, headerText, mainMessage, subMessage;
    
    if (orderData.status === 'READY') {
      subject = `Objednavka ${orderData.orderNumber} je pripravena - Palace Cafe`;
      headerText = 'Objednavka pripravena na vyzdvihnutie / Rendeles keszre kesz atvevellre';
      mainMessage = 'Vasa objednavka je pripravena na vyzdvihnutie!';
      subMessage = 'Az On rendelese keszen all az atvetelre!';
    } else if (orderData.status === 'OUT_FOR_DELIVERY') {
      subject = `Objednavka ${orderData.orderNumber} je na ceste - Palace Cafe`;
      headerText = 'Objednavka je na ceste / Rendeles uton van';
      mainMessage = 'Vasa objednavka je na ceste k vam!';
      subMessage = 'Az On rendelese uton van!';
    }
    
    const msg = {
      to: customerEmail,
      from: {
        email: SENDGRID_CONFIG.from.email,
        name: SENDGRID_CONFIG.from.name
      },
      replyTo: SENDGRID_CONFIG.replyTo,
      subject: subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #38141A, #1D665D); color: white; text-align: center; padding: 30px; border-radius: 10px;">
            <h1>Palace Cafe & Street Food</h1>
            <p>${headerText}</p>
          </div>
          
          <div style="padding: 30px; background: #f9f9f9; border-radius: 10px; margin-top: 20px;">
            <h2>Dobry den ${orderData.customerName},</h2>
            <p><strong>Jo napot ${orderData.customerName},</strong></p>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
              <p style="font-size: 18px; color: #38141A; font-weight: bold;">${mainMessage}</p>
              <p style="font-size: 16px; color: #1D665D; font-style: italic;">${subMessage}</p>
              
              ${orderData.status === 'READY' ? `
              <div style="margin-top: 20px; padding: 15px; background: #f0f8f0; border-radius: 8px;">
                <p><strong>Adresa / Cim:</strong><br>Hradna 168/2, 945 01 Komarno</p>
              </div>
              ` : `
              <div style="margin-top: 20px; padding: 15px; background: #f0f8f0; border-radius: 8px;">
                <p>Nas kurier vas bude kontaktovat pred dorucenim.<br>
                <em>Futarunk a kezbesites elott felveszi Onnel a kapcsolatot.</em></p>
              </div>
              `}
            </div>
            
            <div style="text-align: center; padding: 20px; color: #666; font-size: 14px;">
              <p>Dakujeme za doveru! / Koszonjuk a bizalmat!</p>
            </div>
          </div>
        </div>
      `,
      text: `
Palace Cafe & Street Food

Dobry den ${orderData.customerName},

${mainMessage}
${subMessage}

${orderData.status === 'READY' ? 
`Adresa: Hradna 168/2, 945 01 Komarno` :
`Nas kurier vas bude kontaktovat pred dorucenim.`}

Dakujeme za doveru!
`,
      customArgs: {
        'order_number': orderData.orderNumber,
        'order_status': orderData.status
      }
    };

    const result = await sgMail.send(msg);
    console.log(`Status email sent to ${customerEmail}`);
    
    return { 
      success: true, 
      messageId: result[0].headers['x-message-id'] 
    };
    
  } catch (error) {
    console.error('Failed to send status email:', error);
    
    if (error.response) {
      console.error('SendGrid API Error:', {
        statusCode: error.response.statusCode,
        body: error.response.body
      });
    }
    
    return { success: false, error: error.message };
  }
}

/**
 * Send invoice email with PDF attachment using SendGrid
 */
async function sendInvoiceEmail(invoiceData, pdfBuffer, customerEmail) {
  try {
    console.log(`📧 Preparing SendGrid invoice email for ${customerEmail}`);
    
    if (!customerEmail || !customerEmail.includes('@')) {
      console.log('⚠️ Invalid email address, skipping invoice email');
      return { success: false, error: 'Invalid email address' };
    }

    // Initialize SendGrid if not already done
    if (!isInitialized) {
      const initialized = initializeSendGrid();
      if (!initialized) {
        console.log('⚠️ SendGrid not configured, skipping email send');
        return { success: false, error: 'SendGrid not configured' };
      }
    }

    // Generate email content
    const emailContent = generateInvoiceEmailContent(invoiceData);
    
    // Convert PDF buffer to base64 for SendGrid
    const pdfBase64 = pdfBuffer.toString('base64');
    
    // Prepare SendGrid message
    const msg = {
      to: customerEmail,
      from: {
        email: SENDGRID_CONFIG.from.email,
        name: SENDGRID_CONFIG.from.name
      },
      replyTo: SENDGRID_CONFIG.replyTo,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      attachments: [
        {
          content: pdfBase64,
          filename: `faktura-${invoiceData.invoiceNumber}.pdf`,
          type: 'application/pdf',
          disposition: 'attachment'
        }
      ],
      // Custom headers for tracking
      customArgs: {
        'invoice_id': invoiceData.id.toString(),
        'order_id': invoiceData.orderId.toString(),
        'invoice_number': invoiceData.invoiceNumber
      }
    };

    // Send email via SendGrid
    console.log(`📤 Sending invoice email via SendGrid to ${customerEmail}...`);
    const result = await sgMail.send(msg);
    
    console.log(`✅ SendGrid invoice email sent successfully to ${customerEmail}`);
    console.log(`📧 Message ID: ${result[0].headers['x-message-id']}`);
    
    return { 
      success: true, 
      messageId: result[0].headers['x-message-id'],
      statusCode: result[0].statusCode
    };
    
  } catch (error) {
    console.error('❌ Failed to send SendGrid invoice email:', error);
    
    // Log SendGrid-specific error details
    if (error.response) {
      console.error('SendGrid API Error:', {
        statusCode: error.response.statusCode,
        body: error.response.body
      });
    }
    
    return { 
      success: false, 
      error: error.message,
      statusCode: error.code || null
    };
  }
}

/**
 * Send order confirmation email via SendGrid
 */
async function sendOrderConfirmationEmail(orderData, customerEmail) {
  try {
    console.log(`📧 Preparing SendGrid order confirmation for ${customerEmail}`);
    
    if (!customerEmail) {
      return { success: false, error: 'No email address provided' };
    }

    // Initialize SendGrid if not already done
    if (!isInitialized) {
      const initialized = initializeSendGrid();
      if (!initialized) {
        return { success: false, error: 'SendGrid not configured' };
      }
    }

    const orderType = orderData.orderType === 'DELIVERY' ? 'doručenie / szállítás' : 'vyzdvihnutie / átvétel';
    
    const msg = {
      to: customerEmail,
      from: {
        email: SENDGRID_CONFIG.from.email,
        name: SENDGRID_CONFIG.from.name
      },
      replyTo: SENDGRID_CONFIG.replyTo,
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
          
          <div style="text-align: center; padding: 20px; color: #666;">
            <p>Palace Cafe & Street Food s.r.o.<br>
            Hradná 168/2, 945 01 Komárno</p>
          </div>
        </div>
      `,
      text: `
Palace Cafe & Street Food - Potvrdenie objednávky #${orderData.orderNumber}

Dobrý deň ${orderData.customerName},

Vaša objednávka #${orderData.orderNumber} bola úspešne prijatá!

Typ: ${orderType}
Suma: ${formatCurrency(orderData.total)}
Stav: Spracováva sa

Budeme vás informovať o ďalších krokoch.

Palace Cafe & Street Food s.r.o.
Hradná 168/2, 945 01 Komárno
`,
      customArgs: {
        'order_number': orderData.orderNumber,
        'order_type': orderData.orderType
      }
    };

    const result = await sgMail.send(msg);
    console.log(`✅ SendGrid order confirmation sent to ${customerEmail}`);
    
    return { 
      success: true, 
      messageId: result[0].headers['x-message-id'] 
    };
    
  } catch (error) {
    console.error('❌ Failed to send SendGrid order confirmation:', error);
    
    if (error.response) {
      console.error('SendGrid API Error:', {
        statusCode: error.response.statusCode,
        body: error.response.body
      });
    }
    
    return { success: false, error: error.message };
  }
}

/**
 * Generate email content for invoice (same as WebSupport version)
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
            Pre otázky nás kontaktujte na: ${SENDGRID_CONFIG.replyTo}<br>
            <em>Kérdések esetén írjon nekünk: ${SENDGRID_CONFIG.replyTo}</em>
        </p>
    </div>
</body>
</html>
  `;
  
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

Kontakt: ${SENDGRID_CONFIG.replyTo}
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
 * Test SendGrid configuration
 */
async function testEmailConfig() {
  try {
    if (!process.env.SENDGRID_API_KEY) {
      return { 
        success: false, 
        error: 'SENDGRID_API_KEY environment variable not set' 
      };
    }

    // Initialize if needed
    if (!isInitialized) {
      const initialized = initializeSendGrid();
      if (!initialized) {
        return { success: false, error: 'Failed to initialize SendGrid' };
      }
    }

    console.log('✅ SendGrid configuration is valid');
    return { 
      success: true, 
      config: {
        apiKey: process.env.SENDGRID_API_KEY ? 'Set (hidden)' : 'Not set',
        fromEmail: SENDGRID_CONFIG.from.email,
        fromName: SENDGRID_CONFIG.from.name,
        replyTo: SENDGRID_CONFIG.replyTo
      }
    };
    
  } catch (error) {
    console.error('❌ SendGrid configuration test failed:', error);
    return { success: false, error: error.message };
  }
}

// Initialize SendGrid on module load
initializeSendGrid();

module.exports = {
  sendInvoiceEmail,
  sendOrderConfirmationEmail, 
  sendOrderStatusEmail,
  testEmailConfig,
  EMAIL_CONFIG: SENDGRID_CONFIG // For compatibility
};