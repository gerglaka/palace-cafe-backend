/**
 * Palace Cafe & Bar - SMTP Email Service
 * Email delivery via WebSupport SMTP server
 * Handles invoice delivery, order notifications, and confirmations
 */

const nodemailer = require('nodemailer');
const { formatCurrency } = require('./invoice-generator');

// =============================================================================
// SMTP CONFIGURATION
// =============================================================================

/**
 * Email service configuration using environment variables
 * For production (Railway), these should be set in environment variables
 * For development, you can use .env file
 */
const SMTP_CONFIG = {
  host: process.env.SMTP_HOST || 'smtp.m1.websupport.sk',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true, // Use SSL/TLS
  auth: {
    user: process.env.SMTP_USER || 'notifications@palacebar.sk',
    pass: process.env.SMTP_PASS // Required! Set in environment variables
  },
  from: {
    email: process.env.SMTP_FROM_EMAIL || 'notifications@palacebar.sk',
    name: process.env.SMTP_FROM_NAME || 'Palace Cafe & Bar'
  },
  replyTo: process.env.SMTP_REPLY_TO || 'admin@palacebar.sk'
};

// Transporter instance (will be initialized on first use)
let transporter = null;
let isInitialized = false;

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Initialize the SMTP transporter
 * Creates a reusable transporter object for sending emails
 * @returns {boolean} Success status
 */
function initializeSMTP() {
  try {
    // Check if password is configured
    if (!SMTP_CONFIG.auth.pass) {
      console.log('⚠️ SMTP not configured - SMTP_PASS not set');
      return false;
    }

    // Create transporter with SMTP configuration
    transporter = nodemailer.createTransport({
      host: SMTP_CONFIG.host,
      port: SMTP_CONFIG.port,
      secure: SMTP_CONFIG.secure,
      auth: {
        user: SMTP_CONFIG.auth.user,
        pass: SMTP_CONFIG.auth.pass
      },
      tls: {
        rejectUnauthorized: true // Verify SSL certificate
      }
    });

    isInitialized = true;
    console.log('✅ SMTP email service initialized successfully');
    console.log(`📧 Sending from: ${SMTP_CONFIG.from.email}`);
    
    return true;
    
  } catch (error) {
    console.error('❌ Failed to initialize SMTP:', error);
    isInitialized = false;
    return false;
  }
}

/**
 * Ensure transporter is initialized before sending
 * @returns {boolean} True if ready, false otherwise
 */
function ensureInitialized() {
  if (!isInitialized) {
    return initializeSMTP();
  }
  return true;
}

// =============================================================================
// EMAIL SENDING FUNCTIONS
// =============================================================================

/**
 * Send order status notification email
 * Used when order status changes to READY or OUT_FOR_DELIVERY
 * 
 * @param {Object} orderData - Order information
 * @param {string} customerEmail - Customer's email address
 * @returns {Promise<Object>} Result object with success status
 */
async function sendOrderStatusEmail(orderData, customerEmail) {
  try {
    console.log(`📧 Preparing status email for ${customerEmail}`);
    
    // Validate email address
    if (!customerEmail || !customerEmail.includes('@')) {
      console.log('⚠️ Invalid email address provided');
      return { success: false, error: 'No valid email address provided' };
    }

    // Ensure SMTP is initialized
    if (!ensureInitialized()) {
      return { success: false, error: 'SMTP not configured' };
    }

    // Determine email content based on order status
    let subject, headerText, mainMessage, subMessage;
    
    if (orderData.status === 'READY') {
      subject = `Objednávka ${orderData.orderNumber} je pripravená - Palace Cafe`;
      headerText = 'Objednávka pripravená na vyzdvihnutie / Rendelés készen áll az átvételre';
      mainMessage = 'Vaša objednávka je pripravená na vyzdvihnutie!';
      subMessage = 'Az Ön rendelése készen áll az átvételre!';
    } else if (orderData.status === 'OUT_FOR_DELIVERY') {
      subject = `Objednávka ${orderData.orderNumber} je na ceste - Palace Cafe`;
      headerText = 'Objednávka je na ceste / Rendelés úton van';
      mainMessage = 'Vaša objednávka je na ceste k vám!';
      subMessage = 'Az Ön rendelése úton van!';
    } else {
      // Unsupported status
      return { success: false, error: 'Unsupported order status for notification' };
    }
    
    // Prepare email message
    const mailOptions = {
      from: `"${SMTP_CONFIG.from.name}" <${SMTP_CONFIG.from.email}>`,
      to: customerEmail,
      replyTo: SMTP_CONFIG.replyTo,
      subject: subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #38141A, #1D665D); color: white; text-align: center; padding: 30px; border-radius: 10px;">
            <h1>Palace Cafe & Bar</h1>
            <p>${headerText}</p>
          </div>
          
          <div style="padding: 30px; background: #f9f9f9; border-radius: 10px; margin-top: 20px;">
            <h2>Dobrý deň ${orderData.customerName},</h2>
            <p><strong>Jó napot ${orderData.customerName},</strong></p>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
              <p style="font-size: 18px; color: #38141A; font-weight: bold;">${mainMessage}</p>
              <p style="font-size: 16px; color: #1D665D; font-style: italic;">${subMessage}</p>
              
              ${orderData.status === 'READY' ? `
              <div style="margin-top: 20px; padding: 15px; background: #f0f8f0; border-radius: 8px;">
                <p><strong>Adresa / Cím:</strong><br>Námestie gen. Klapku 9, 945 01 Komárno</p>
              </div>
              ` : `
              <div style="margin-top: 20px; padding: 15px; background: #f0f8f0; border-radius: 8px;">
                <p>Náš kuriér vás bude kontaktovať pred doručením.<br>
                <em>Futárunk a kézbesítés előtt felveszi Önnel a kapcsolatot.</em></p>
              </div>
              `}
            </div>
            
            <div style="text-align: center; padding: 20px; color: #666; font-size: 14px;">
              <p>Ďakujeme za dôveru! / Köszönjük a bizalmát!</p>
            </div>
          </div>
        </div>
      `,
      text: `
Palace Cafe & Bar

Dobrý deň ${orderData.customerName},

${mainMessage}
${subMessage}

${orderData.status === 'READY' ? 
`Adresa: Námestie gen. Klapku 9, 945 01 Komárno` :
`Náš kuriér vás bude kontaktovať pred doručením.`}

Ďakujeme za dôveru!
`
    };

    // Send the email
    console.log(`📤 Sending status email to ${customerEmail}...`);
    const result = await transporter.sendMail(mailOptions);
    
    console.log(`✅ Status email sent successfully to ${customerEmail}`);
    console.log(`📧 Message ID: ${result.messageId}`);
    
    return { 
      success: true, 
      messageId: result.messageId,
      response: result.response
    };
    
  } catch (error) {
    console.error('❌ Failed to send status email:', error);
    return { 
      success: false, 
      error: error.message,
      code: error.code
    };
  }
}

/**
 * Send invoice email with PDF attachment
 * Sends a professional invoice email with attached PDF
 * 
 * @param {Object} invoiceData - Invoice details from database
 * @param {Buffer} pdfBuffer - PDF file as buffer
 * @param {string} customerEmail - Customer's email address
 * @returns {Promise<Object>} Result object with success status
 */
async function sendInvoiceEmail(invoiceData, pdfBuffer, customerEmail) {
  try {
    console.log(`📧 Preparing invoice email for ${customerEmail}`);
    
    // Validate inputs
    if (!customerEmail || !customerEmail.includes('@')) {
      console.log('⚠️ Invalid email address, skipping invoice email');
      return { success: false, error: 'Invalid email address' };
    }

    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
      console.log('⚠️ Invalid PDF buffer provided');
      return { success: false, error: 'Invalid PDF buffer' };
    }

    // Ensure SMTP is initialized
    if (!ensureInitialized()) {
      console.log('⚠️ SMTP not configured, skipping email send');
      return { success: false, error: 'SMTP not configured' };
    }

    // Generate email content
    const emailContent = generateInvoiceEmailContent(invoiceData);
    
    // Prepare email with PDF attachment
    const mailOptions = {
      from: `"${SMTP_CONFIG.from.name}" <${SMTP_CONFIG.from.email}>`,
      to: customerEmail,
      replyTo: SMTP_CONFIG.replyTo,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      attachments: [
        {
          filename: `faktura-${invoiceData.invoiceNumber}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    };

    // Send email via SMTP
    console.log(`📤 Sending invoice email to ${customerEmail}...`);
    const result = await transporter.sendMail(mailOptions);
    
    console.log(`✅ Invoice email sent successfully to ${customerEmail}`);
    console.log(`📧 Message ID: ${result.messageId}`);
    
    return { 
      success: true, 
      messageId: result.messageId,
      response: result.response
    };
    
  } catch (error) {
    console.error('❌ Failed to send invoice email:', error);
    return { 
      success: false, 
      error: error.message,
      code: error.code
    };
  }
}

/**
 * Send order confirmation email
 * Sent immediately after order is placed successfully
 * 
 * @param {Object} orderData - Order information
 * @param {string} customerEmail - Customer's email address
 * @returns {Promise<Object>} Result object with success status
 */
async function sendOrderConfirmationEmail(orderData, customerEmail) {
  try {
    console.log(`📧 Preparing order confirmation for ${customerEmail}`);
    
    // Validate email
    if (!customerEmail || !customerEmail.includes('@')) {
      return { success: false, error: 'No valid email address provided' };
    }

    // Ensure SMTP is initialized
    if (!ensureInitialized()) {
      return { success: false, error: 'SMTP not configured' };
    }

    // Determine order type text
    const orderTypeText = orderData.orderType === 'DELIVERY' 
      ? 'Donáška / Házhozszállítás' 
      : 'Vyzdvihnutie / Átvétel';

    // Determine payment method text
    const paymentMethodText = getPaymentMethodText(orderData.paymentMethod);

    // Generate items list HTML
    const itemsListHtml = orderData.items && orderData.items.length > 0
      ? orderData.items.map(item => `
          <div style="padding: 10px 0; border-bottom: 1px solid #eee;">
            <strong>${item.name || 'Neznámy produkt'}</strong><br>
            <span style="color: #666;">Množstvo / Mennyiség: ${item.quantity}x</span>
            <span style="float: right; color: #1D665D; font-weight: bold;">${formatCurrency(item.price * item.quantity)}</span>
            ${item.customizations ? `<br><small style="color: #999;">• ${item.customizations}</small>` : ''}
          </div>
        `).join('')
      : '<p>Žiadne položky / Nincs tétel</p>';

    // Prepare email
    const mailOptions = {
      from: `"${SMTP_CONFIG.from.name}" <${SMTP_CONFIG.from.email}>`,
      to: customerEmail,
      replyTo: SMTP_CONFIG.replyTo,
      subject: `Potvrdenie objednávky ${orderData.orderNumber} - Palace Cafe`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .header { background: linear-gradient(135deg, #38141A, #1D665D); color: white; text-align: center; padding: 30px; border-radius: 10px; }
                .content { padding: 30px; background: #f9f9f9; border-radius: 10px; margin-top: 20px; }
                .order-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
                .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
                .total-row { font-size: 18px; font-weight: bold; color: #38141A; padding: 15px 0; border-top: 2px solid #1D665D; }
                .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>🍽️ Palace Cafe & Bar</h1>
                <p>Ďakujeme za vašu objednávku! / Köszönjük a rendelését!</p>
            </div>
            
            <div class="content">
                <h2>Dobrý deň ${orderData.customerName},</h2>
                <p><strong>Jó napot ${orderData.customerName},</strong></p>
                
                <p>
                    Vaša objednávka bola úspešne prijatá a je v spracovaní. Potvrdenie a faktúru nájdete v samostatnom emaili.
                </p>
                <p>
                    <em>Rendelését sikeresen fogadtuk és feldolgozás alatt áll. A visszaigazolást és a számlát külön emailben kapja meg.</em>
                </p>
                
                <div class="order-box">
                    <h3>📋 Detaily objednávky / Rendelés részletei</h3>
                    <div class="info-row">
                        <span>Číslo objednávky / Rendelésszám:</span>
                        <strong>#${orderData.orderNumber}</strong>
                    </div>
                    <div class="info-row">
                        <span>Typ / Típus:</span>
                        <strong>${orderTypeText}</strong>
                    </div>
                    <div class="info-row">
                        <span>Platba / Fizetés:</span>
                        <strong>${paymentMethodText}</strong>
                    </div>
                    
                    <h4 style="margin-top: 20px; color: #1D665D;">📦 Vaše položky / Az Ön tételei</h4>
                    ${itemsListHtml}
                    
                    <div class="total-row">
                        <span>Celková suma / Végösszeg:</span>
                        <span>${formatCurrency(orderData.totalAmount)}</span>
                    </div>
                </div>
                
                ${orderData.orderType === 'DELIVERY' ? `
                <div class="order-box">
                    <h3>🚚 Doručenie / Szállítás</h3>
                    <p><strong>Adresa / Cím:</strong><br>${orderData.deliveryAddress || 'N/A'}</p>
                    <p>
                        Doručíme čo najskôr. Budeme vás kontaktovať pred doručením.<br>
                        <em>A lehető leghamarabb kiszállítjuk. Kézbesítés előtt felvesszük Önnel a kapcsolatot.</em>
                    </p>
                </div>
                ` : `
                <div class="order-box">
                    <h3>🏪 Vyzdvihnutie / Átvétel</h3>
                    <p>
                        <strong>Adresa / Cím:</strong><br>
                        Námestie gen. Klapku 9, 945 01 Komárno
                    </p>
                    <p>
                        Pripravíme vašu objednávku čo najskôr. Dáme vám vedieť, keď bude pripravená.<br>
                        <em>A lehető leghamarabb elkészítjük rendelését. Értesítjük, amikor átvehető.</em>
                    </p>
                </div>
                `}
            </div>
            
            <div class="footer">
                <p>
                    <strong>Palace Cafe & Bar</strong><br>
                    Námestie gen. Klapku 9, 945 01 Komárno<br>
                    📞 Telefón / Telefon: +421 XXX XXX XXX
                </p>
                <p style="margin-top: 20px;">
                    🙏 Tešíme sa na vás! / Várjuk Önt!
                </p>
                <p style="font-size: 12px; color: #999; margin-top: 20px;">
                    Otázky? Kontaktujte nás: ${SMTP_CONFIG.replyTo}<br>
                    <em>Kérdése van? Írjon nekünk: ${SMTP_CONFIG.replyTo}</em>
                </p>
            </div>
        </body>
        </html>
      `,
      text: `
Palace Cafe & Bar - Potvrdenie objednávky ${orderData.orderNumber}

Dobrý deň ${orderData.customerName},

Vaša objednávka bola úspešne prijatá!

DETAILY:
- Číslo objednávky: #${orderData.orderNumber}
- Typ: ${orderTypeText}
- Platba: ${paymentMethodText}
- Celková suma: ${formatCurrency(orderData.totalAmount)}

${orderData.orderType === 'DELIVERY' ? 
`Doručíme na: ${orderData.deliveryAddress}` :
`Vyzdvihnutie na: Námestie gen. Klapku 9, 945 01 Komárno`}

Ďakujeme za dôveru!
Palace Cafe & Bar

Kontakt: ${SMTP_CONFIG.replyTo}
`
    };

    // Send the email
    console.log(`📤 Sending confirmation email to ${customerEmail}...`);
    const result = await transporter.sendMail(mailOptions);
    
    console.log(`✅ Confirmation email sent to ${customerEmail}`);
    console.log(`📧 Message ID: ${result.messageId}`);
    
    return { 
      success: true, 
      messageId: result.messageId,
      response: result.response
    };
    
  } catch (error) {
    console.error('❌ Failed to send confirmation email:', error);
    return { 
      success: false, 
      error: error.message,
      code: error.code
    };
  }
}

/**
 * Send Storno (cancellation) invoice email
 * Used when an order is cancelled and needs a credit note
 * 
 * @param {Object} stornoData - Storno invoice data
 * @param {Buffer} pdfBuffer - Storno invoice PDF
 * @param {string} customerEmail - Customer's email address
 * @returns {Promise<Object>} Result object with success status
 */
async function sendStornoInvoiceEmail(stornoData, pdfBuffer, customerEmail) {
  try {
    console.log(`📧 Preparing storno invoice email for ${customerEmail}`);
    
    // Validate inputs
    if (!customerEmail || !customerEmail.includes('@')) {
      console.log('⚠️ Invalid email address');
      return { success: false, error: 'Invalid email address' };
    }

    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
      console.log('⚠️ Invalid PDF buffer');
      return { success: false, error: 'Invalid PDF buffer' };
    }

    // Ensure SMTP is initialized
    if (!ensureInitialized()) {
      return { success: false, error: 'SMTP not configured' };
    }

    // Prepare storno email
    const mailOptions = {
      from: `"${SMTP_CONFIG.from.name}" <${SMTP_CONFIG.from.email}>`,
      to: customerEmail,
      replyTo: SMTP_CONFIG.replyTo,
      subject: `Storno faktúra ${stornoData.stornoNumber} - Palace Cafe`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .header { background: linear-gradient(135deg, #8B0000, #DC143C); color: white; text-align: center; padding: 30px; border-radius: 10px; }
                .content { padding: 30px; background: #f9f9f9; border-radius: 10px; margin-top: 20px; }
                .warning-box { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 5px; }
                .info-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
                .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>⚠️ Storno Faktúra / Sztornó Számla</h1>
                <p>Palace Cafe & Bar</p>
            </div>
            
            <div class="content">
                <h2>Dobrý deň ${stornoData.customerName},</h2>
                <p><strong>Jó napot ${stornoData.customerName},</strong></p>
                
                <div class="warning-box">
                    <p>
                        <strong>Vaša objednávka bola zrušená. / Az Ön rendelését törölték.</strong>
                    </p>
                </div>
                
                <p>
                    V prílohe nájdete storno faktúru, ktorá ruší pôvodnú faktúru č. ${stornoData.originalInvoiceNumber}.
                </p>
                <p>
                    <em>A mellékletben megtalálja a sztornó számlát, amely érvényteleníti az eredeti ${stornoData.originalInvoiceNumber} számú számlát.</em>
                </p>
                
                <div class="info-box">
                    <h3>📋 Detaily storna / Sztornó részletei</h3>
                    <p>
                        <strong>Storno číslo / Sztornó szám:</strong> ${stornoData.stornoNumber}<br>
                        <strong>Pôvodná faktúra / Eredeti számla:</strong> ${stornoData.originalInvoiceNumber}<br>
                        <strong>Suma / Összeg:</strong> ${formatCurrency(stornoData.amount)}
                    </p>
                </div>
                
                <p>
                    Ospravedlňujeme sa za prípadné nepríjemnosti.<br>
                    <em>Elnézést kérünk a kellemetlenségért.</em>
                </p>
            </div>
            
            <div class="footer">
                <p>
                    <strong>Palace Cafe & Bar</strong><br>
                    Námestie gen. Klapku 9, 945 01 Komárno
                </p>
                <p style="font-size: 12px; color: #999; margin-top: 20px;">
                    Otázky? / Kérdések? ${SMTP_CONFIG.replyTo}
                </p>
            </div>
        </body>
        </html>
      `,
      text: `
Palace Cafe & Bar - Storno Faktúra ${stornoData.stornoNumber}

Dobrý deň ${stornoData.customerName},

Vaša objednávka bola zrušená.

DETAILY STORNA:
- Storno číslo: ${stornoData.stornoNumber}
- Pôvodná faktúra: ${stornoData.originalInvoiceNumber}
- Suma: ${formatCurrency(stornoData.amount)}

V prílohe nájdete PDF storno faktúru.

Ospravedlňujeme sa za prípadné nepríjemnosti.

Palace Cafe & Bar
Kontakt: ${SMTP_CONFIG.replyTo}
`,
      attachments: [
        {
          filename: `storno-${stornoData.stornoNumber}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    };

    // Send email
    console.log(`📤 Sending storno invoice to ${customerEmail}...`);
    const result = await transporter.sendMail(mailOptions);
    
    console.log(`✅ Storno invoice sent to ${customerEmail}`);
    console.log(`📧 Message ID: ${result.messageId}`);
    
    return { 
      success: true, 
      messageId: result.messageId,
      response: result.response
    };
    
  } catch (error) {
    console.error('❌ Failed to send storno email:', error);
    return { 
      success: false, 
      error: error.message,
      code: error.code
    };
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate invoice email content (HTML and text)
 * Creates the email body for invoice emails
 * 
 * @param {Object} invoiceData - Invoice data from database
 * @returns {Object} Object with subject, html, and text properties
 */
function generateInvoiceEmailContent(invoiceData) {
  // Determine order type and payment method
  const orderType = invoiceData.order?.orderType || 'PICKUP';
  const orderTypeText = orderType === 'DELIVERY' 
    ? 'Donáška / Házhozszállítás' 
    : 'Vyzdvihnutie / Átvétel';
  
  const paymentMethodText = getPaymentMethodText(invoiceData.paymentMethod);

  const subject = `Faktúra ${invoiceData.invoiceNumber} - Palace Cafe & Bar`;

  const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
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
            padding: 30px;
            border-radius: 10px;
        }
        .header h1 {
            margin: 0;
            font-size: 28px;
        }
        .content {
            padding: 30px;
            background: #f9f9f9;
            border-radius: 10px;
            margin-top: 20px;
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
        <h1>🍽️ Palace Cafe & Bar</h1>
        <p>Ďakujeme za vašu objednávku! / Köszönjük a rendelését!</p>
    </div>
    
    <div class="content">
        <h2>Dobrý deň ${invoiceData.customerName},</h2>
        <p><strong>Jó napot ${invoiceData.customerName},</strong></p>
        
        <p>
            Ďakujeme za vašu objednávku v Palace Cafe & Bar! V prílohe nájdete faktúru za vašu objednávku.
        </p>
        <p>
            <em>Köszönjük a Palace Cafe & Bar-ban leadott rendelését! A mellékletben megtalálja a rendeléséhez tartozó számlát.</em>
        </p>
        
        <div class="invoice-info">
            <h3>📋 Detaily objednávky / Rendelés részletei</h3>
            <div class="detail-row">
                <span>Číslo faktúry / Számla száma:</span>
                <strong>${invoiceData.invoiceNumber}</strong>
            </div>
            <div class="detail-row">
                <span>Číslo objednávky / Rendelésszám:</span>
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
            <strong>Palace Cafe & Bar</strong><br>
            Námestie gen. Klapku 9, 945 01 Komárno<br>
            IČO: 56384840 | DIČ: 2122291578 | IČ DPH: SK2122291578
        </p>
        
        <p style="margin-top: 30px;">
            🙏 Ďakujeme za dôveru a tešíme sa na vašu ďalšiu návštevu!<br>
            <em>Köszönjük a bizalmát és várjuk újabb látogatását!</em>
        </p>
        
        <p style="font-size: 12px; color: #999; margin-top: 20px;">
            Pre otázky nás kontaktujte na: ${SMTP_CONFIG.replyTo}<br>
            <em>Kérdések esetén írjon nekünk: ${SMTP_CONFIG.replyTo}</em>
        </p>
    </div>
</body>
</html>
  `;
  
  const text = `
Palace Cafe & Bar - Faktúra ${invoiceData.invoiceNumber}

Dobrý deň ${invoiceData.customerName},

Ďakujeme za vašu objednávku v Palace Cafe & Bar!

DETAILY OBJEDNÁVKY:
- Číslo faktúry: ${invoiceData.invoiceNumber}
- Číslo objednávky: #${invoiceData.order?.orderNumber || 'N/A'}
- Typ: ${orderTypeText}
- Platba: ${paymentMethodText}
- Celková suma: ${formatCurrency(invoiceData.totalGross)}

V prílohe nájdete PDF faktúru.

Ďakujeme za dôveru!
Palace Cafe & Bar
Námestie gen. Klapku 9, 945 01 Komárno

Kontakt: ${SMTP_CONFIG.replyTo}
`;

  return { subject, html, text };
}

/**
 * Generate HTML list of order items for email
 * 
 * @param {Array} orderItems - Array of order items
 * @returns {string} HTML string of items
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
 * Generate delivery information section for email
 * 
 * @param {Object} invoiceData - Invoice data
 * @returns {string} HTML string for delivery info
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
 * Generate pickup information section for email
 * 
 * @returns {string} HTML string for pickup info
 */
function generatePickupInfo() {
  return `
    <div class="invoice-info">
      <h3>🏪 Informácie o vyzdvihnutí / Átvételi információk</h3>
      <p>
        <strong>Adresa / Cím:</strong> Námestie gen. Klapku 9, 945 01 Komárno<br>
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
 * 
 * @param {string} paymentMethod - Payment method code
 * @returns {string} Formatted payment method text
 */
function getPaymentMethodText(paymentMethod) {
  const methods = {
    'CASH': 'Hotovosť / Készpénz',
    'CARD': 'Karta / Kártya', 
    'ONLINE': 'Online platba / Online fizetés'
  };
  
  return methods[paymentMethod] || paymentMethod;
}

// =============================================================================
// TESTING & CONFIGURATION
// =============================================================================

/**
 * Test SMTP email configuration
 * Verifies that SMTP is properly configured and can connect
 * 
 * @returns {Promise<Object>} Test result with configuration details
 */
async function testEmailConfig() {
  try {
    // Check if password is set
    if (!SMTP_CONFIG.auth.pass) {
      return { 
        success: false, 
        error: 'SMTP_PASS environment variable not set' 
      };
    }

    // Initialize if needed
    if (!ensureInitialized()) {
      return { success: false, error: 'Failed to initialize SMTP' };
    }

    // Verify connection
    console.log('🔍 Testing SMTP connection...');
    await transporter.verify();
    
    console.log('✅ SMTP configuration is valid and connection successful');
    
    return { 
      success: true, 
      config: {
        host: SMTP_CONFIG.host,
        port: SMTP_CONFIG.port,
        secure: SMTP_CONFIG.secure,
        user: SMTP_CONFIG.auth.user,
        fromEmail: SMTP_CONFIG.from.email,
        fromName: SMTP_CONFIG.from.name,
        replyTo: SMTP_CONFIG.replyTo
      }
    };
    
  } catch (error) {
    console.error('❌ SMTP configuration test failed:', error);
    return { 
      success: false, 
      error: error.message,
      code: error.code
    };
  }
}

// =============================================================================
// INITIALIZATION ON MODULE LOAD
// =============================================================================

// Initialize SMTP when module is loaded
initializeSMTP();

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  sendInvoiceEmail,
  sendOrderConfirmationEmail, 
  sendOrderStatusEmail,
  sendStornoInvoiceEmail,
  testEmailConfig,
  EMAIL_CONFIG: SMTP_CONFIG // Export config for compatibility
};
