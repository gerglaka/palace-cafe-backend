const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { createServer } = require('http');
const { Server } = require('socket.io');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

require('dotenv').config();

// Initialize Prisma
const prisma = new PrismaClient();

// Create Express app
const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// MIDDLEWARE SETUP
// ============================================

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
app.use(cors({
  origin: [
    'https://palace-cafe-frontend.vercel.app',
    'https://palacebar.sk',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'file://', 
    'https://js.stripe.com'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token']
}));

// Stripe webhook needs raw body, so handle it before JSON parsing
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression middleware
app.use(compression());

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 1000 : 100, // Much higher for dev
  message: {
    error: 'Too many requests from this IP, please try again later.',
  },
});
app.use('/api/', limiter);

// Stricter rate limiting for orders
const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 100 : 10, // Much higher for dev
  message: {
    error: 'Too many orders from this IP, please try again later.',
  },
}); 

// ============================================
// UTILITY FUNCTIONS
// ============================================

// Error handler middleware
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);
  
  if (err.code === 'P2002') {
    return res.status(400).json({
      success: false,
      error: 'Duplicate entry. This record already exists.'
    });
  }
  
  if (err.code === 'P2025') {
    return res.status(404).json({
      success: false,
      error: 'Record not found.'
    });
  }
  
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
};

// Async wrapper to handle errors
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Generate order number
const generateOrderNumber = () => {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `PCB-${dateStr}-${timeStr}-${random}`;
};

// ============================================
// HEALTH CHECK
// ============================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Palace Cafe API is running!',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// ============================================
// PUBLIC MENU APIs
// ============================================

// Get all categories with items (for menu display)
app.get('/api/menu', asyncHandler(async (req, res) => {
  const { lang = 'hu' } = req.query;
  
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    include: {
      translations: {
        where: { language: lang }
      },
      menuItems: {
        where: { 
          isDeleted: false },
        include: {
          translations: {
            where: { language: lang }
          }
        },
        orderBy: { id: 'asc' }
      }
    },
    orderBy: { displayOrder: 'asc' }
  });

  // Transform data for frontend
  const menuData = {};
  
  categories.forEach(category => {
    const categoryName = category.translations[0]?.name || 'Unknown';
    
    menuData[categoryName] = {
      id: category.id,
      slug: category.slug,
      name: categoryName,
      isDeliverable: category.isDeliverable,
      items: category.menuItems.map(item => ({
        id: item.id,
        slug: item.slug,
        name: item.translations[0]?.name || 'Unknown',
        description: item.translations[0]?.description || '',
        price: item.price,
        imageUrl: item.imageUrl,
        badge: item.badge,
        includesSides: item.includesSides,
        isPopular: item.isPopular,
        spicyLevel: item.spicyLevel
      }))
    };
  });

  res.json({
    success: true,
    data: menuData
  });
}));

// Get deliverable categories only (for order page)
app.get('/api/menu/deliverable', asyncHandler(async (req, res) => {
  const { lang = 'hu' } = req.query;
  
  const categories = await prisma.category.findMany({
    where: { 
      isActive: true,
      isDeliverable: true 
    },
    include: {
      translations: {
        where: { language: lang }
      },
      menuItems: {
        where: { 
          isAvailable: true,
          isDeleted: false
        },
        include: {
          translations: {
            where: { language: lang }
          }
        },
        orderBy: { id: 'asc' }
      }
    },
    orderBy: { displayOrder: 'asc' }
  });

  // Transform data for frontend
  const menuData = {};
  
  categories.forEach(category => {
    const categoryName = category.translations[0]?.name || 'Unknown';
    
    menuData[categoryName] = {
      id: category.id,
      slug: category.slug,
      name: categoryName,
      items: category.menuItems.map(item => ({
        id: item.id,
        slug: item.slug,
        name: item.translations[0]?.name || 'Unknown',
        description: item.translations[0]?.description || '',
        price: item.price,
        imageUrl: item.imageUrl,
        badge: item.badge,
        includesSides: item.includesSides,
        isPopular: item.isPopular,
        spicyLevel: item.spicyLevel
      }))
    };
  });

  res.json({
    success: true,
    data: menuData
  });
}));

// Get customization options
app.get('/api/customization', asyncHandler(async (req, res) => {
  const { lang = 'hu' } = req.query;
  
  // Get sauces
  const sauces = await prisma.sauce.findMany({
    where: { isActive: true },
    include: {
      translations: {
        where: { language: lang }
      }
    },
    orderBy: { isDefault: 'desc' }
  });

  // Get fries options
  const friesOptions = await prisma.friesOption.findMany({
    where: { isActive: true },
    include: {
      translations: {
        where: { language: lang }
      }
    },
    orderBy: { isDefault: 'desc' }
  });

  res.json({
    success: true,
    data: {
      sauces: sauces.map(sauce => ({
        id: sauce.id,
        slug: sauce.slug,
        name: sauce.translations[0]?.name || 'Unknown',
        price: sauce.price,
        isDefault: sauce.isDefault
      })),
      friesOptions: friesOptions.map(option => ({
        id: option.id,
        slug: option.slug,
        name: option.translations[0]?.name || 'Unknown',
        priceAddon: option.priceAddon,
        isDefault: option.isDefault
      }))
    }
  });
}));

// ============================================
// ORDER MANAGEMENT APIs
// ============================================

const { generateInvoicePDF, generateInvoiceNumber, getNextInvoiceCounter, calculateVATBreakdown } = require('./utils/invoice-generator');
const { sendInvoiceEmail, sendOrderConfirmationEmail, testEmailConfig } = require('./utils/email-service');

// Place new order
app.post('/api/orders', orderLimiter, asyncHandler(async (req, res) => {
  const {
    customerName,
    customerPhone,
    customerEmail,
    orderType, // 'DELIVERY' or 'PICKUP'
    deliveryAddress,
    deliveryNotes,
    specialNotes,
    items, // Array of order items
    scheduledFor, // Optional scheduled delivery time
    paymentMethod // 'CASH', 'CARD', 'ONLINE'
  } = req.body;

  console.log('🛒 Processing new order...');
  console.log('- customerName:', customerName);
  console.log('- items:', items?.length || 0, 'items');
  console.log('- paymentMethod:', paymentMethod);

  // Validation
  if (!customerName || !customerPhone || !items || items.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: customerName, customerPhone, items'
    });
  }

  if (orderType === 'DELIVERY' && !deliveryAddress) {
    return res.status(400).json({
      success: false,
      error: 'Delivery address is required for delivery orders'
    });
  }

  try {
    // Get restaurant settings for delivery fee
    const restaurant = await prisma.restaurant.findFirst();
    const deliveryFee = (orderType === 'DELIVERY') ? restaurant?.deliveryFee || 2.50 : 0;

    // Calculate totals and prepare order items
    let subtotal = 0;
    const orderItems = [];
    const invoiceItems = []; // For invoice generation

    for (const item of items) {
      const menuItem = await prisma.menuItem.findUnique({
        where: { id: item.menuItemId },
        include: {
          translations: { where: { language: 'hu' } }
        }
      });

      if (!menuItem) {
        return res.status(400).json({
          success: false,
          error: `Menu item with ID ${item.menuItemId} not found`
        });
      }

      let itemTotal = menuItem.price * item.quantity;
      let customizations = [];
      
      // Add fries upgrade cost - check if sides are included
      if (item.friesUpgrade) {
        const friesOption = await prisma.friesOption.findFirst({
          where: { slug: item.friesUpgrade },
          include: { translations: { where: { language: 'hu' } } }
        });
        
        if (friesOption) {
          if (menuItem.includesSides) {
            // Items WITH sides included - regular fries are FREE, only charge for upgrades
            if (friesOption.slug !== 'regular' && friesOption.slug !== 'regular-fries') {
              itemTotal += friesOption.priceAddon * item.quantity;
              customizations.push(`${friesOption.translations[0]?.name || friesOption.slug} (+€${friesOption.priceAddon})`);
            } else {
              customizations.push(friesOption.translations[0]?.name || 'Regular fries');
            }
          } else {
            // Items WITHOUT sides included - charge full price for any fries
            itemTotal += friesOption.priceAddon * item.quantity;
            customizations.push(`${friesOption.translations[0]?.name || friesOption.slug} (+€${friesOption.priceAddon})`);
          }
        }
      }

      // Add sauce selection
      if (item.selectedSauce) {
        const sauce = await prisma.sauce.findFirst({
          where: { slug: item.selectedSauce },
          include: { translations: { where: { language: 'hu' } } }
        });
        if (sauce) {
          customizations.push(sauce.translations[0]?.name || sauce.slug);
        }
      }

      // Add extras cost (€0.30 per extra)
      if (item.extras && item.extras.length > 0) {
        const extrasCount = item.extras.length;
        const extrasCost = extrasCount * 0.30;
        itemTotal += extrasCost * item.quantity;
        customizations.push(`${extrasCount} extra(s) (+€${extrasCost.toFixed(2)})`);
      }

      subtotal += itemTotal;
      
      // For database
      orderItems.push({
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        unitPrice: menuItem.price,
        totalPrice: itemTotal,
        selectedSauce: item.selectedSauce || null,
        friesUpgrade: item.friesUpgrade || null,
        extras: item.extras || [],
        removeItems: item.removeItems || [],
        specialNotes: item.specialNotes || null
      });

      // For invoice
      invoiceItems.push({
        slug: menuItem.slug,
        name: menuItem.translations[0]?.name || 'Unknown Item',
        quantity: item.quantity,
        unitPrice: menuItem.price,
        totalPrice: itemTotal,
        customizations: customizations.join(', ')
      });
    }

    const total = subtotal + deliveryFee;

    // Create order in database
    const order = await prisma.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        status: 'PENDING',
        orderType,
        paymentMethod: paymentMethod || 'CASH',
        customerName,
        customerPhone,
        customerEmail: customerEmail || null,
        deliveryAddress: orderType === 'DELIVERY' ? deliveryAddress : null,
        deliveryNotes: deliveryNotes || null,
        specialNotes: specialNotes || null,
        subtotal,
        deliveryFee,
        total,
        scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
        estimatedTime: new Date(Date.now() + 45 * 60 * 1000), // 45 minutes from now
        items: {
          create: orderItems
        }
      },
      include: {
        items: {
          include: {
            menuItem: {
              include: {
                translations: {
                  where: { language: 'hu' }
                }
              }
            }
          }
        }
      }
    });

    console.log(`✅ Order created: ${order.orderNumber}`);

    // Generate invoice
    try {
      console.log('📄 Generating invoice...');
      
      // Get next invoice number
      const currentYear = new Date().getFullYear();
      const invoiceCounter = await getNextInvoiceCounter(paymentMethod || 'CASH', currentYear, prisma);
      const invoiceNumber = generateInvoiceNumber(paymentMethod || 'CASH', currentYear, invoiceCounter);
      
      // Calculate VAT breakdown
      const vatBreakdown = calculateVATBreakdown(total);
      
      // Create invoice record
      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber,
          orderId: order.id,
          customerName,
          customerEmail: customerEmail || null,
          customerPhone,
          subtotal,
          deliveryFee,
          totalNet: vatBreakdown.netAmount,
          vatAmount: vatBreakdown.vatAmount,
          totalGross: vatBreakdown.grossAmount,
          paymentMethod: paymentMethod || 'CASH',
          orderItems: invoiceItems, // Store as JSON
          emailSent: false
        },
        include: {
          order: true
        }
      });

      console.log(`📋 Invoice created: ${invoiceNumber}`);

      // Generate PDF
      const pdfBuffer = await generateInvoicePDF({
        ...invoice,
        orderItems: invoiceItems
      });

      console.log('📧 PDF generated, attempting to send email...');

      // Send invoice email if email provided
      if (customerEmail) {
        try {
          const emailResult = await sendInvoiceEmail(invoice, pdfBuffer, customerEmail);
          
          if (emailResult.success) {
            // Update invoice record
            await prisma.invoice.update({
              where: { id: invoice.id },
              data: {
                emailSent: true,
                emailSentAt: new Date(),
                emailAttempts: 1
              }
            });
            console.log(`✅ Invoice email sent to ${customerEmail}`);
          } else {
            console.log(`⚠️ Failed to send invoice email: ${emailResult.error}`);
            // Don't fail the order, just log the issue
          }
        } catch (emailError) {
          console.error('❌ Email sending error:', emailError);
          // Update invoice with failed attempt
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              emailAttempts: 1
            }
          });
        }
      } else {
        console.log('📧 No customer email provided, skipping invoice email');
      }

    } catch (invoiceError) {
      console.error('❌ Invoice generation failed:', invoiceError);
      // Don't fail the order, but log the issue
      // The order was created successfully, invoice can be generated later
    }

    // Emit WebSocket event for admin dashboard
    io.emit('newOrder', {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      customerName: order.customerName,
      orderType: order.orderType,
      total: order.total,
      createdAt: order.createdAt,
      items: order.items.map(item => ({
        name: item.menuItem.translations[0]?.name || 'Unknown',
        quantity: item.quantity
      }))
    });

    console.log(`🎉 Order ${order.orderNumber} completed successfully`);

    // Send order confirmation email (separate from invoice)
    if (customerEmail) {
      try {
        await sendOrderConfirmationEmail({
          orderNumber: order.orderNumber,
          customerName,
          orderType,
          total
        }, customerEmail);
        console.log(`📧 Order confirmation sent to ${customerEmail}`);
      } catch (confirmationError) {
        console.error('❌ Order confirmation email failed:', confirmationError);
        // Don't fail the order
      }
    }

    // Return success response
    res.status(201).json({
      success: true,
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        estimatedTime: order.estimatedTime,
        total: order.total,
        invoiceGenerated: true
      },
      message: 'Order placed successfully! Invoice will be sent to your email.'
    });

  } catch (error) {
    console.error('❌ Order creation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create order',
      details: error.message
    });
  }
}));

// Get order status
app.get('/api/orders/:orderNumber/status', asyncHandler(async (req, res) => {
  const { orderNumber } = req.params;
  
  console.log('🔍 Looking for order:', orderNumber);
  
  try {
    const order = await prisma.order.findUnique({
      where: { orderNumber },
      include: {
        items: {
          include: {
            menuItem: {
              include: {
                translations: {
                  where: { language: 'hu' }
                }
              }
            }
          }
        }
      }
    });

    console.log('📦 Found order:', order ? `Yes (ID: ${order.id})` : 'No');

    if (!order) {
      console.log('❌ Order not found for orderNumber:', orderNumber);
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    // Get all unique sauce and fries option slugs from the order
    const sauceSlugs = [...new Set(order.items.map(item => item.selectedSauce).filter(Boolean))];
    const friesSlugs = [...new Set(order.items.map(item => item.friesUpgrade).filter(Boolean))];

    // Fetch translations for sauces and fries
    const [sauceTranslations, friesTranslations] = await Promise.all([
      prisma.sauce.findMany({
        where: { slug: { in: sauceSlugs } },
        include: {
          translations: {
            where: { language: 'hu' }
          }
        }
      }),
      prisma.friesOption.findMany({
        where: { slug: { in: friesSlugs } },
        include: {
          translations: {
            where: { language: 'hu' }
          }
        }
      })
    ]);

    // Create lookup maps for translations
    const sauceMap = {};
    sauceTranslations.forEach(sauce => {
      sauceMap[sauce.slug] = sauce.translations[0]?.name || sauce.slug;
    });

    const friesMap = {};
    friesTranslations.forEach(fries => {
      friesMap[fries.slug] = fries.translations[0]?.name || fries.slug;
    });

    console.log('✅ Returning order data for:', orderNumber);

    res.json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        status: order.status,
        orderType: order.orderType,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        customerEmail: order.customerEmail,
        deliveryAddress: order.deliveryAddress,
        deliveryNotes: order.deliveryNotes,
        paymentMethod: order.paymentMethod,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        total: order.total,
        createdAt: order.createdAt,
        estimatedTime: order.estimatedTime,
        confirmedAt: order.confirmedAt,
        readyAt: order.readyAt,
        deliveredAt: order.deliveredAt,
        scheduledFor: order.scheduledFor,
        specialNotes: order.specialNotes,
        items: order.items.map(item => {
          // Build customization text with proper translations
          const customizations = [];
          
          if (item.selectedSauce) {
            const sauceName = sauceMap[item.selectedSauce] || item.selectedSauce;
            customizations.push(`Szósz: ${sauceName}`);
          }
          
          if (item.friesUpgrade) {
            const friesName = friesMap[item.friesUpgrade] || item.friesUpgrade;
            customizations.push(`Krumpli: ${friesName}`);
          }
          
          if (item.extras && item.extras.length > 0) {
            customizations.push(`Extrák: ${item.extras.join(', ')}`);
          }
          
          if (item.removeItems && item.removeItems.length > 0) {
            customizations.push(`Elhagyva: ${item.removeItems.join(', ')}`);
          }

          return {
            id: item.id,
            name: item.menuItem.translations[0]?.name || 'Unknown',
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            selectedSauce: item.selectedSauce,
            friesUpgrade: item.friesUpgrade,
            extras: item.extras || [],
            removeItems: item.removeItems || [],
            specialNotes: item.specialNotes,
            imageUrl: item.menuItem?.imageUrl ? item.menuItem.imageUrl.replace(/\\/g, '/') : 'photos/default-food.jpg',
            // Add the properly formatted customizations
            displayCustomizations: customizations.join(' • ')
          };
        })
      }
    });
  } catch (error) {
    console.error('❌ Database error in order status endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Database error occurred'
    });
  }
}));

const httpServer = createServer(app);
// Create HTTP server and Socket.io instance
const io = new Server(httpServer, {
  cors: {
    origin: ['https://palacebar.sk', 'https://www.palacebar.sk', 'http://localhost:3000', 'http://127.0.0.1:5500'],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Nodemailer setup (stub for email notifications)
//const transporter = nodemailer.createTransport({
  //host: 'smtp.example.com', // Replace with your SMTP host (e.g., Gmail, SendGrid)
  //port: 587,
  //secure: false,
  //auth: {
    //user: 'your-email@example.com', // Replace with your email
    //pass: 'your-email-password' // Replace with your email password or app-specific password
  //}
//});

const transporter = {
  sendMail: (options, callback) => {
    console.log('Email would be sent to:', options.to, 'Subject:', options.subject);
    if (callback) callback(null, { messageId: 'email-disabled-' + Date.now() });
  }
};

// Socket.io connection for real-time order updates
io.on('connection', (socket) => {
  console.log('Admin connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Admin disconnected:', socket.id);
  });
});

// ============================================
// STRIPE PAYMENT PROCESSING APIs
// ============================================

// Initialize Stripe with secret key
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Create payment intent (Step 1: Setup payment)
app.post('/api/stripe/create-payment-intent', orderLimiter, asyncHandler(async (req, res) => {
  const {
    amount,
    currency = 'eur',
    orderData, // Customer info and order details
    metadata = {}
  } = req.body;

  console.log('💳 Creating Stripe payment intent...');
  console.log('- Amount:', amount, currency.toUpperCase());
  console.log('- Customer:', orderData?.customerName);

  // Validation
  if (!amount || amount < 0.50) { // Minimum 50 cents
    return res.status(400).json({
      success: false,
      error: 'Invalid amount. Minimum payment is €0.50'
    });
  }

  if (!orderData?.customerName || !orderData?.customerEmail) {
    return res.status(400).json({
      success: false,
      error: 'Customer name and email are required for payment processing'
    });
  }

  try {
    // Create or retrieve customer in Stripe
    let customer;
    const existingCustomers = await stripe.customers.list({
      email: orderData.customerEmail,
      limit: 1
    });

    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
      console.log('🔍 Found existing Stripe customer:', customer.id);
    } else {
      customer = await stripe.customers.create({
        email: orderData.customerEmail,
        name: orderData.customerName,
        phone: orderData.customerPhone,
        metadata: {
          restaurant: 'Palace Cafe & Street Food',
          source: 'website_order'
        }
      });
      console.log('✅ Created new Stripe customer:', customer.id);
    }

    // Prepare payment intent parameters
    const paymentIntentParams = {
        amount: Math.round(amount * 100), // Convert euros to cents
        currency: currency.toLowerCase(),
        customer: customer.id,
        capture_method: 'automatic', // Charge immediately on confirmation
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never'
        },
        description: `Palace Cafe Order - ${orderData.customerName}`,
        metadata: {
            customer_name: orderData.customerName,
            customer_email: orderData.customerEmail,
            customer_phone: orderData.customerPhone || '',
            order_type: orderData.orderType || 'PICKUP',
            restaurant: 'Palace Cafe & Street Food',
            ...metadata
        },
        receipt_email: orderData.customerEmail
    };

    // Only add shipping for delivery orders
    if (orderData.orderType === 'DELIVERY' && orderData.deliveryAddress) {
        paymentIntentParams.shipping = {
            name: orderData.customerName,
            phone: orderData.customerPhone,
            address: {
                line1: orderData.deliveryAddress,
                city: 'Komárno',
                country: 'SK'
            }
        };
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

    console.log('✅ Payment intent created:', paymentIntent.id);

    res.json({
      success: true,
      data: {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        customerId: customer.id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency
      }
    });

  } catch (error) {
    console.error('❌ Stripe payment intent creation failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create payment intent'
    });
  }
}));

// Confirm payment and create order (Step 2: After successful payment)
app.post('/api/stripe/confirm-payment', orderLimiter, asyncHandler(async (req, res) => {
  const {
    paymentIntentId,
    orderData // Complete order information
  } = req.body;

  console.log('🔄 Confirming Stripe payment and creating order...');
  console.log('- Payment Intent:', paymentIntentId);
  console.log('- Customer:', orderData?.customerName);

  // Validation
  if (!paymentIntentId || !orderData) {
    return res.status(400).json({
      success: false,
      error: 'Payment Intent ID and order data are required'
    });
  }

  try {
    // Retrieve payment intent to verify status
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({
        success: false,
        error: 'Payment not completed. Status: ' + paymentIntent.status
      });
    }

    console.log('✅ Payment confirmed, creating order...');

    // Extract order data
    const {
      customerName,
      customerPhone,
      customerEmail,
      orderType,
      deliveryAddress,
      deliveryNotes,
      specialNotes,
      items,
      scheduledFor
    } = orderData;

    // Get restaurant settings for delivery fee
    const restaurant = await prisma.restaurant.findFirst();
    const deliveryFee = (orderType === 'DELIVERY') ? restaurant?.deliveryFee || 2.50 : 0;

    // Calculate totals and prepare order items (same logic as cash orders)
    let subtotal = 0;
    const orderItems = [];
    const invoiceItems = [];

    for (const item of items) {
      const menuItem = await prisma.menuItem.findUnique({
        where: { id: item.menuItemId },
        include: {
          translations: { where: { language: 'hu' } }
        }
      });

      if (!menuItem) {
        return res.status(400).json({
          success: false,
          error: `Menu item with ID ${item.menuItemId} not found`
        });
      }

      let itemTotal = menuItem.price * item.quantity;
      let customizations = [];
      
      // Add fries upgrade cost
      if (item.friesUpgrade) {
        const friesOption = await prisma.friesOption.findFirst({
          where: { slug: item.friesUpgrade },
          include: { translations: { where: { language: 'hu' } } }
        });
        
        if (friesOption) {
          if (menuItem.includesSides) {
            if (friesOption.slug !== 'regular' && friesOption.slug !== 'regular-fries') {
              itemTotal += friesOption.priceAddon * item.quantity;
              customizations.push(`${friesOption.translations[0]?.name || friesOption.slug} (+€${friesOption.priceAddon})`);
            } else {
              customizations.push(friesOption.translations[0]?.name || 'Regular fries');
            }
          } else {
            itemTotal += friesOption.priceAddon * item.quantity;
            customizations.push(`${friesOption.translations[0]?.name || friesOption.slug} (+€${friesOption.priceAddon})`);
          }
        }
      }

      // Add sauce selection
      if (item.selectedSauce) {
        const sauce = await prisma.sauce.findFirst({
          where: { slug: item.selectedSauce },
          include: { translations: { where: { language: 'hu' } } }
        });
        if (sauce) {
          customizations.push(sauce.translations[0]?.name || sauce.slug);
        }
      }

      // Add extras cost
      if (item.extras && item.extras.length > 0) {
        const extrasCount = item.extras.length;
        const extrasCost = extrasCount * 0.30;
        itemTotal += extrasCost * item.quantity;
        customizations.push(`${extrasCount} extra(s) (+€${extrasCost.toFixed(2)})`);
      }

      subtotal += itemTotal;
      
      // For database
      orderItems.push({
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        unitPrice: menuItem.price,
        totalPrice: itemTotal,
        selectedSauce: item.selectedSauce || null,
        friesUpgrade: item.friesUpgrade || null,
        extras: item.extras || [],
        removeItems: item.removeItems || [],
        specialNotes: item.specialNotes || null
      });

      // For invoice
      invoiceItems.push({
        slug: menuItem.slug,
        name: menuItem.translations[0]?.name || 'Unknown Item',
        quantity: item.quantity,
        unitPrice: menuItem.price,
        totalPrice: itemTotal,
        customizations: customizations.join(', ')
      });
    }

    const total = subtotal + deliveryFee;

    // Verify payment amount matches order total
    const paidAmount = paymentIntent.amount / 100; // Convert cents to euros
    if (Math.abs(paidAmount - total) > 0.01) { // Allow 1 cent difference for rounding
      console.error('❌ Payment amount mismatch:', paidAmount, 'vs', total);
      return res.status(400).json({
        success: false,
        error: 'Payment amount does not match order total'
      });
    }

    // Create order in database
    const order = await prisma.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        status: 'PENDING', 
        orderType,
        paymentMethod: 'CARD', // Use CARD for Stripe payments
        paymentStatus: 'COMPLETED', // Payment already processed
        customerName,
        customerPhone,
        customerEmail,
        deliveryAddress: orderType === 'DELIVERY' ? deliveryAddress : null,
        deliveryNotes: deliveryNotes || null,
        specialNotes: specialNotes || null,
        subtotal,
        deliveryFee,
        total,
        scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
        estimatedTime: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes for card orders
        confirmedAt: new Date(), // Already confirmed by payment
        items: {
          create: orderItems
        }
      },
      include: {
        items: {
          include: {
            menuItem: {
              include: {
                translations: { where: { language: 'hu' } }
              }
            }
          }
        }
      }
    });

    // Create payment record
    await prisma.payment.create({
      data: {
        orderId: order.id,
        paymentMethod: 'CARD',
        status: 'COMPLETED',
        amount: total,
        currency: 'EUR',
        transactionId: paymentIntent.id,
        gatewayResponse: {
          stripe_payment_intent: paymentIntentId,
          stripe_customer: paymentIntent.customer,
          payment_method: paymentIntent.payment_method,
          amount_received: paymentIntent.amount_received
        }
      }
    });

    console.log(`✅ Order created: ${order.orderNumber}`);

    // Generate invoice in background (same as cash orders)
    setImmediate(async () => {
      try {
        console.log('📄 Generating invoice for card payment...');
        
        const currentYear = new Date().getFullYear();
        const invoiceCounter = await getNextInvoiceCounter('CARD', currentYear, prisma);
        const invoiceNumber = generateInvoiceNumber('CARD', currentYear, invoiceCounter);
        const vatBreakdown = calculateVATBreakdown(total);
        
        const invoice = await prisma.invoice.create({
          data: {
            invoiceNumber,
            orderId: order.id,
            customerName,
            customerEmail,
            customerPhone,
            subtotal,
            deliveryFee,
            totalNet: vatBreakdown.netAmount,
            vatAmount: vatBreakdown.vatAmount,
            totalGross: vatBreakdown.grossAmount,
            paymentMethod: 'CARD',
            orderItems: invoiceItems,
            emailSent: false
          },
          include: { order: true }
        });

        console.log(`📋 Invoice created: ${invoiceNumber}`);

        // Generate and send invoice (when email is re-enabled)
        // const pdfBuffer = await generateInvoicePDF({ ...invoice, orderItems: invoiceItems });
        // await sendInvoiceEmail(invoice, pdfBuffer, customerEmail);

      } catch (invoiceError) {
        console.error('❌ Invoice generation failed for card payment:', invoiceError);
      }
    });

    // Emit WebSocket event for admin dashboard
    io.emit('newOrder', {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      customerName: order.customerName,
      orderType: order.orderType,
      total: order.total,
      paymentMethod: 'CARD',
      createdAt: order.createdAt,
      items: order.items.map(item => ({
        name: item.menuItem.translations[0]?.name || 'Unknown',
        quantity: item.quantity
      }))
    });

    console.log(`🎉 Stripe order ${order.orderNumber} completed successfully`);

    // Return success response
    res.status(201).json({
      success: true,
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        estimatedTime: order.estimatedTime,
        total: order.total,
        paymentIntentId: paymentIntentId,
        invoiceGenerated: true
      },
      message: 'Payment successful! Order confirmed.'
    });

  } catch (error) {
    console.error('❌ Stripe order creation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process payment and create order',
      details: error.message
    });
  }
}));

// Stripe webhook handler (for payment confirmations and updates)
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log('📡 Stripe webhook received:', event.type);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle different event types
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log('✅ Payment succeeded:', paymentIntent.id);
      
      // Update order status if needed
      try {
        const payment = await prisma.payment.findFirst({
          where: { transactionId: paymentIntent.id },
          include: { order: true }
        });

        if (payment && payment.order.status === 'PENDING') {
          const updatedOrder = await prisma.order.update({
            where: { id: payment.orderId },
            data: { 
              status: 'PENDING',
              confirmedAt: new Date()
            }
          });
          
          // Emit WebSocket event for real-time updates
          io.emit('orderStatusUpdate', {
            id: updatedOrder.id,
            orderNumber: updatedOrder.orderNumber,
            status: updatedOrder.status,
            confirmedAt: updatedOrder.confirmedAt
          });
          
          console.log(`📋 Order ${payment.order.orderNumber} confirmed via webhook`);
        }
      } catch (error) {
        console.error('❌ Failed to update order from webhook:', error);
      }
      break;

    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object;
      console.log('❌ Payment failed:', failedPayment.id);
      
      // Handle failed payment
      try {
        const payment = await prisma.payment.findFirst({
          where: { transactionId: failedPayment.id },
          include: { order: true }
        });

        if (payment) {
          await prisma.payment.update({
            where: { id: payment.id },
            data: { status: 'FAILED' }
          });
          
          // Optionally update order status to cancelled
          await prisma.order.update({
            where: { id: payment.orderId },
            data: { status: 'CANCELLED' }
          });
          
          console.log(`📋 Order ${payment.order.orderNumber} cancelled due to payment failure`);
        }
      } catch (error) {
        console.error('❌ Failed to update failed payment:', error);
      }
      break;

    case 'checkout.session.completed':
      const session = event.data.object;
      console.log('🛒 Checkout session completed:', session.id);
      // Handle checkout session completion if using Stripe Checkout
      break;

    case 'charge.dispute.created':
      const dispute = event.data.object;
      console.log('⚠️ Charge disputed:', dispute.id);
      // Handle chargebacks/disputes
      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
}));

// Get Stripe publishable key for frontend
app.get('/api/stripe/config', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      currency: 'eur',
      country: 'SK'
    }
  });
}));



// ============================================
// ADMIN AUTHENTICATION APIs
// ============================================

// Middleware to validate JWT for protected admin routes
const authenticateAdmin = asyncHandler(async (req, res, next) => {
  console.log('🔍 Auth check - Headers:', req.headers.authorization);
  
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('❌ No auth header or wrong format');
    return res.status(401).json({
      success: false,
      error: 'Authentication token required'
    });
  }

  const token = authHeader.split(' ')[1];
  console.log('🔑 Token received:', token ? 'Yes' : 'No');
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'F#zGcwr+zM*1D/9#w#66*}Qb_[jYNv');
    console.log('✅ Token decoded:', decoded);
    
    const admin = await prisma.adminUser.findUnique({
      where: { id: decoded.id }
    });

    if (!admin || !admin.isActive) {
      console.log('❌ Admin not found or inactive');
      return res.status(401).json({
        success: false,
        error: 'Invalid or inactive admin account'
      });
    }

    console.log('✅ Admin authenticated:', admin.email);
    req.admin = admin;
    next();
  } catch (error) {
    console.log('❌ Token verification failed:', error.message);
    return res.status(401).json({
      success: false,
      error: 'Invalid token'
    });
  }
});

// Stricter rate limiting for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per window
  message: {
    error: 'Too many login attempts from this IP, please try again later.'
  }
});

// Admin login with input validation, bcrypt, and JWT
app.post('/api/admin/login', loginLimiter, [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
], asyncHandler(async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: errors.array()[0].msg
    });
  }

  const { email, password } = req.body;

  // Find admin user by email
  const admin = await prisma.adminUser.findUnique({
    where: { email }
  });

  // Check if user exists and password matches
  if (!admin || !(await bcrypt.compare(password, admin.password))) {
    return res.status(401).json({
      success: false,
      error: 'Invalid credentials'
    });
  }

  if (!admin.isActive) {
    return res.status(401).json({
      success: false,
      error: 'Account is disabled'
    });
  }

  // Generate JWT token
  const token = jwt.sign(
    { id: admin.id, email: admin.email, role: admin.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' } // Token expires in 1 hour
  );

  // Update last login
  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() }
  });

  res.json({
    success: true,
    data: {
      id: admin.id,
      email: admin.email,
      firstName: admin.firstName,
      lastName: admin.lastName,
      role: admin.role,
      token // Return JWT token for client to use in subsequent requests
    },
    message: 'Login successful'
  });
}));

// Get current admin user info (protected)
app.get('/api/admin/auth/user', authenticateAdmin, asyncHandler(async (req, res) => {
  console.log('📋 Getting admin user info for:', req.admin.email);
  
  try {
    // req.admin is already populated by the authenticateAdmin middleware
    const admin = await prisma.adminUser.findUnique({
      where: { id: req.admin.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true
      }
    });

    if (!admin || !admin.isActive) {
      return res.status(401).json({
        success: false,
        error: 'Admin account not found or inactive'
      });
    }

    res.json({
      success: true,
      data: {
        id: admin.id,
        email: admin.email,
        name: admin.firstName && admin.lastName ? 
          `${admin.firstName} ${admin.lastName}` : 
          admin.email.split('@')[0], // Fallback to email username
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.role,
        lastLoginAt: admin.lastLoginAt,
        createdAt: admin.createdAt
      }
    });

  } catch (error) {
    console.error('❌ Error fetching admin user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user information'
    });
  }
}));

// ============================================
// ADMIN ORDER MANAGEMENT APIs
// ============================================

// Get all active orders
app.get('/api/admin/orders/active', authenticateAdmin, asyncHandler(async (req, res) => {
  console.log('📋 Loading active orders...');
  
  try {
    const activeOrders = await prisma.order.findMany({
      where: {
        status: {
          in: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY']
        }
      },
      include: {
        items: {
          include: {
            menuItem: {
              include: {
                translations: {
                  where: { language: 'hu' }
                }
              }
            }
          }
        }
      },
      orderBy: [
        { status: 'asc' },
        { estimatedTime: 'asc' },
        { createdAt: 'desc' }
      ]
    });

    console.log(`✅ Found ${activeOrders.length} active orders`);
    
    const processedOrders = activeOrders.map(order => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      orderType: order.orderType,
      paymentMethod: order.paymentMethod,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerEmail: order.customerEmail,
      deliveryAddress: order.deliveryAddress,
      deliveryNotes: order.deliveryNotes,
      total: order.total,
      createdAt: order.createdAt,
      acceptedAt: order.acceptedAt,
      estimatedTime: order.estimatedTime,
      scheduledFor: order.scheduledFor,
      items: order.items.map(item => ({
        name: item.menuItem.translations[0]?.name || 'Unknown',
        quantity: item.quantity,
        totalPrice: item.totalPrice,
        selectedSauce: item.selectedSauce,
        friesUpgrade: item.friesUpgrade,
        extras: item.extras,
        removeItems: item.removeItems || [],
        specialNotes: item.specialNotes || null
      }))
    }));

    res.json({
      success: true,
      data: processedOrders
    });

  } catch (error) {
    console.error('❌ Error loading active orders:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch orders'
    });
  }
}));

// Get all orders with filtering (protected)
app.get('/api/admin/orders', authenticateAdmin, asyncHandler(async (req, res) => {
  const { status, date, limit = 50, page = 1 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);
  
  let whereClause = {};
  
  if (status && status !== 'ALL') {
    whereClause.status = status;
  }
  
  if (date) {
    const startDate = new Date(date);
    const endDate = new Date(date);
    endDate.setDate(endDate.getDate() + 1);
    
    whereClause.createdAt = {
      gte: startDate,
      lt: endDate
    };
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where: whereClause,
      include: {
        items: {
          include: {
            menuItem: {
              include: {
                translations: {
                  where: { language: 'hu' }
                }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      skip
    }),
    prisma.order.count({ where: whereClause })
  ]);

  res.json({
    success: true,
    data: {
      orders: orders.map(order => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        orderType: order.orderType,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        total: order.total,
        createdAt: order.createdAt,
        estimatedTime: order.estimatedTime,
        itemCount: order.items.length,
        paymentMethod: order.paymentMethod
      })),
      total,
      page: parseInt(page),
      limit: parseInt(limit)
    }
  });
}));

// Get archived orders with filtering - MOVE THIS BEFORE THE :id ROUTE
app.get('/api/admin/orders/archived', authenticateAdmin, asyncHandler(async (req, res) => {
  console.log('📁 Loading archived orders...');
  
  const { period = 'today', page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);
  
  // Calculate date ranges based on period
  let dateFilter = {};
  const now = new Date();
  
  switch (period) {
    case 'today':
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      dateFilter = {
        createdAt: {
          gte: today,
          lt: tomorrow
        }
      };
      break;
      
    case 'week':
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
      weekStart.setHours(0, 0, 0, 0);
      dateFilter = {
        createdAt: {
          gte: weekStart
        }
      };
      break;
      
    case 'month':
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      dateFilter = {
        createdAt: {
          gte: monthStart
        }
      };
      break;
      
    case 'all':
    default:
      // No date filter for all time
      break;
  }
  
  try {
    const whereClause = {
      status: {
        in: ['DELIVERED', 'CANCELLED']
      },
      ...dateFilter
    };
    
    const [archivedOrders, total] = await Promise.all([
      prisma.order.findMany({
        where: whereClause,
        include: {
          items: {
            include: {
              menuItem: {
                include: {
                  translations: {
                    where: { language: 'hu' }
                  }
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip
      }),
      prisma.order.count({ where: whereClause })
    ]);

    console.log(`✅ Found ${archivedOrders.length} archived orders for period: ${period}`);
    
    const processedOrders = archivedOrders.map(order => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      orderType: order.orderType,
      paymentMethod: order.paymentMethod,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerEmail: order.customerEmail,
      deliveryAddress: order.deliveryAddress,
      deliveryNotes: order.deliveryNotes,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      total: order.total,
      createdAt: order.createdAt,
      acceptedAt: order.acceptedAt,
      readyAt: order.readyAt,
      deliveredAt: order.deliveredAt,
      estimatedTime: order.estimatedTime,
      scheduledFor: order.scheduledFor,
      items: order.items.map(item => ({
        id: item.id,
        name: item.menuItem.translations[0]?.name || 'Unknown',
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        selectedSauce: item.selectedSauce,
        friesUpgrade: item.friesUpgrade,
        extras: item.extras,
        removeItems: item.removeItems || [],
        specialNotes: item.specialNotes || null
      }))
    }));

    res.json({
      success: true,
      data: {
        orders: processedOrders,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        period
      }
    });

  } catch (error) {
    console.error('❌ Error loading archived orders:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch archived orders'
    });
  }
}));

// Get single order details (protected)
app.get('/api/admin/orders/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const order = await prisma.order.findUnique({
    where: { id: parseInt(id) },
    include: {
      items: {
        include: {
          menuItem: {
            include: {
              translations: {
                where: { language: 'hu' }
              }
            }
          }
        }
      }
    }
  });

  if (!order) {
    return res.status(404).json({
      success: false,
      error: 'Order not found'
    });
  }

  res.json({
    success: true,
    data: order
  });
}));

// Update order status with email stub (protected)
app.patch('/api/admin/orders/:id/status', authenticateAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, estimatedTime } = req.body;

  const validStatuses = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'];
  
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid status'
    });
  }

  const updateData = { status };
  if (estimatedTime) {
    updateData.estimatedTime = new Date(estimatedTime);
  }
  
  if (status === 'CONFIRMED') {
    updateData.confirmedAt = new Date();
  } else if (status === 'PREPARING') {
    updateData.preparingAt = new Date();
  } else if (status === 'READY') {
    updateData.readyAt = new Date();
  } else if (status === 'DELIVERED') {
    updateData.deliveredAt = new Date();
  }

  const order = await prisma.order.update({
    where: { id: parseInt(id) },
    data: updateData
  });

  // Email notification stub (to be implemented later)
  const mailOptions = {
    from: 'your-email@example.com',
    to: order.customerEmail || 'admin@example.com',
    subject: `Order ${order.orderNumber} Status Updated to ${status}`,
    text: `Your order ${order.orderNumber} is now ${status}.`
  };

  //Emit status update with consistent payload INCLUDING orderNumber
  if (status === 'DELIVERED') {
    io.emit('orderCompleted', {
      id: order.id,
      orderNumber: order.orderNumber,  
      status: order.status,
      deliveredAt: order.deliveredAt
    });
  } else {
    io.emit('orderStatusUpdate', {
      id: order.id,
      orderNumber: order.orderNumber, 
      status: order.status,
      estimatedTime: order.estimatedTime,
      confirmedAt: order.confirmedAt,
      readyAt: order.readyAt
    });
  }

  console.log('📡 WebSocket emitted: orderStatusUpdate for', order.orderNumber);

  res.json({
    success: true,
    data: order,
    message: `Order status updated to ${status}`
  });
}));

// Get dashboard statistics (protected)
app.get('/api/admin/dashboard/stats', authenticateAdmin, asyncHandler(async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [
    todayOrders,
    pendingOrders,
    todayRevenue,
    totalOrders
  ] = await Promise.all([
    prisma.order.count({
      where: {
        createdAt: {
          gte: today,
          lt: tomorrow
        }
      }
    }),
    prisma.order.count({
      where: { status: 'PENDING' }
    }),
    prisma.order.aggregate({
      where: {
        createdAt: {
          gte: today,
          lt: tomorrow
        },
        status: { not: 'CANCELLED' }
      },
      _sum: { total: true }
    }),
    prisma.order.count()
  ]);

  res.json({
    success: true,
    data: {
      todayOrders,
      pendingOrders,
      todayRevenue: todayRevenue._sum.total || 0,
      totalOrders
    }
  });
}));

// Cancel order
app.put('/api/admin/orders/:id/cancel', authenticateAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const updatedOrder = await prisma.order.update({
    where: { id: parseInt(id) },
    data: {
      status: 'CANCELLED'
    }
  });

  //mit status update with consistent payload
  io.emit('orderStatusUpdate', {
    id: updatedOrder.id,
    orderNumber: updatedOrder.orderNumber,
    status: updatedOrder.status
  });

  console.log('📡 WebSocket emitted: orderStatusUpdate for', updatedOrder.orderNumber);

  res.json({
    success: true,
    data: updatedOrder
  });
}));


// ============================================
// WEBSOCKET ADMIN ORDER MANAGEMENT
// ============================================

// Accept order with time estimate
app.put('/api/admin/orders/:id/accept', authenticateAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { estimatedMinutes } = req.body;

  if (!estimatedMinutes || estimatedMinutes < 1) {
    return res.status(400).json({
      success: false,
      error: 'Valid estimated time is required'
    });
  }

  const now = new Date();
  const estimatedTime = new Date(now.getTime() + estimatedMinutes * 60000);

  const updatedOrder = await prisma.order.update({
    where: { id: parseInt(id) },
    data: {
      status: 'CONFIRMED',
      acceptedAt: now,
      estimatedTime: estimatedTime
    }
  });

  //Emit status update to all connected clients with consistent payload
  io.emit('orderStatusUpdate', {
    id: updatedOrder.id,
    orderNumber: updatedOrder.orderNumber, 
    status: updatedOrder.status,
    estimatedTime: updatedOrder.estimatedTime,
    confirmedAt: updatedOrder.acceptedAt
  });

  console.log('📡 WebSocket emitted: orderStatusUpdate for', updatedOrder.orderNumber);

  res.json({
    success: true,
    data: updatedOrder
  });
}));

// Mark order as ready
app.put('/api/admin/orders/:id/ready', authenticateAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const now = new Date();

  const updatedOrder = await prisma.order.update({
    where: { id: parseInt(id) },
    data: {
      status: 'READY',
      readyAt: now
    }
  });

  //Emit status update with consistent payload
  io.emit('orderStatusUpdate', {
    id: updatedOrder.id,
    orderNumber: updatedOrder.orderNumber,
    status: updatedOrder.status,
    readyAt: updatedOrder.readyAt
  });

  console.log('📡 WebSocket emitted: orderStatusUpdate for', updatedOrder.orderNumber);

  res.json({
    success: true,
    data: updatedOrder
  });
}));

app.put('/api/admin/orders/:id/delivery', authenticateAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const updatedOrder = await prisma.order.update({
    where: { id: parseInt(id) },
    data: {
      status: 'OUT_FOR_DELIVERY'
    }
  });

  //Emit status update with consistent payload
  io.emit('orderStatusUpdate', {
    id: updatedOrder.id,
    orderNumber: updatedOrder.orderNumber, 
    status: updatedOrder.status
  });

  console.log('📡 WebSocket emitted: orderStatusUpdate for', updatedOrder.orderNumber);

  res.json({
    success: true,
    data: updatedOrder
  });
}));

// Complete order
app.put('/api/admin/orders/:id/complete', authenticateAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const now = new Date();

  const updatedOrder = await prisma.order.update({
    where: { id: parseInt(id) },
    data: {
      status: 'DELIVERED',
      deliveredAt: now
    }
  });

  //Emit completion event with consistent payload
  io.emit('orderCompleted', {
    id: updatedOrder.id,
    orderNumber: updatedOrder.orderNumber,
    status: updatedOrder.status,
    deliveredAt: updatedOrder.deliveredAt
  });

  console.log('📡 WebSocket emitted: orderCompleted for', updatedOrder.orderNumber);

  res.json({
    success: true,
    data: updatedOrder
  });
}));


// ============================================
// RESTAURANT INFO API
// ============================================

app.get('/api/restaurant', asyncHandler(async (req, res) => {
  const restaurant = await prisma.restaurant.findFirst();
  
  if (!restaurant) {
    return res.status(404).json({
      success: false,
      error: 'Restaurant information not found'
    });
  }

  res.json({
    success: true,
    data: {
      name: restaurant.name,
      description: restaurant.description,
      phone: restaurant.phone,
      email: restaurant.email,
      address: restaurant.address,
      city: restaurant.city,
      deliveryFee: restaurant.deliveryFee,
      minimumOrder: restaurant.minimumOrder,
      deliveryTime: restaurant.deliveryTime,
      openingHours: restaurant.openingHours
    }
  });
}));

// ============================================
// ANALYTICS & STATS APIs
// ============================================

// Get dashboard statistics with date range
app.get('/api/admin/stats/overview', authenticateAdmin, asyncHandler(async (req, res) => {
  const { startDate, endDate, period = 'today' } = req.query;
  
  // Calculate date range based on period
  let dateFilter = {};
  const now = new Date();
  
  if (startDate && endDate) {
    dateFilter = {
      createdAt: {
        gte: new Date(startDate),
        lte: new Date(endDate)
      }
    };
  } else {
    switch (period) {
      case 'today':
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        dateFilter = {
          createdAt: {
            gte: today,
            lt: tomorrow
          }
        };
        break;
      case 'week':
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        weekStart.setHours(0, 0, 0, 0);
        dateFilter = {
          createdAt: {
            gte: weekStart
          }
        };
        break;
      case 'month':
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        dateFilter = {
          createdAt: {
            gte: monthStart
          }
        };
        break;
    }
  }

  try {
    const [
      totalRevenue,
      totalOrders,
      avgOrderValue,
      revenueByType,
      ordersByStatus
    ] = await Promise.all([
      // Total revenue
      prisma.order.aggregate({
        where: {
          ...dateFilter,
          status: { not: 'CANCELLED' }
        },
        _sum: { total: true }
      }),
      
      // Total orders count
      prisma.order.count({
        where: {
          ...dateFilter,
          status: { not: 'CANCELLED' }
        }
      }),
      
      // Average order value
      prisma.order.aggregate({
        where: {
          ...dateFilter,
          status: { not: 'CANCELLED' }
        },
        _avg: { total: true }
      }),
      
      // Revenue by order type
      prisma.order.groupBy({
        by: ['orderType'],
        where: {
          ...dateFilter,
          status: { not: 'CANCELLED' }
        },
        _sum: { total: true },
        _count: true
      }),
      
      // Orders by status
      prisma.order.groupBy({
        by: ['status'],
        where: dateFilter,
        _count: true
      })
    ]);

    res.json({
      success: true,
      data: {
        totalRevenue: totalRevenue._sum.total || 0,
        totalOrders,
        avgOrderValue: avgOrderValue._avg.total || 0,
        revenueByType,
        ordersByStatus,
        period,
        dateRange: dateFilter.createdAt
      }
    });

  } catch (error) {
    console.error('Stats overview error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stats overview'
    });
  }
}));

// Get revenue trends (for line charts)
app.get('/api/admin/stats/revenue-trends', authenticateAdmin, asyncHandler(async (req, res) => {
  const { period = 'week', groupBy = 'day' } = req.query;
  
  // Calculate date range
  let dateFilter = {};
  const now = new Date();
  
  switch (period) {
    case 'today':
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      dateFilter = {
        createdAt: {
          gte: today,
          lt: tomorrow
        }
      };
      break;
    case 'week':
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - 7);
      dateFilter = {
        createdAt: {
          gte: weekStart
        }
      };
      break;
    case 'month':
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      dateFilter = {
        createdAt: {
          gte: monthStart
        }
      };
      break;
  }
  
  try {
    // Get all orders in the period
    const orders = await prisma.order.findMany({
      where: {
        ...dateFilter,
        status: { not: 'CANCELLED' }
      },
      select: {
        createdAt: true,
        total: true
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    // Group by the specified period
    const trends = [];
    const groupedData = {};

    orders.forEach(order => {
      let key;
      const date = new Date(order.createdAt);
      
      switch (groupBy) {
        case 'hour':
          key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}`;
          break;
        case 'day':
          key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
          break;
        case 'week':
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = `${weekStart.getFullYear()}-${weekStart.getMonth() + 1}-${weekStart.getDate()}`;
          break;
        case 'month':
          key = `${date.getFullYear()}-${date.getMonth() + 1}`;
          break;
        default:
          key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
      }

      if (!groupedData[key]) {
        groupedData[key] = {
          date: key,
          revenue: 0,
          orderCount: 0
        };
      }
      
      groupedData[key].revenue += order.total;
      groupedData[key].orderCount += 1;
    });

    // Convert to array and sort
    const trendsArray = Object.values(groupedData).sort((a, b) => 
      new Date(a.date) - new Date(b.date)
    );

    res.json({
      success: true,
      data: {
        trends: trendsArray,
        period,
        groupBy
      }
    });

  } catch (error) {
    console.error('Revenue trends error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch revenue trends'
    });
  }
}));

// Get top selling items
app.get('/api/admin/stats/top-items', authenticateAdmin, asyncHandler(async (req, res) => {
  const { startDate, endDate, period = 'month', limit = 10, sortBy = 'revenue' } = req.query;
  
  // Calculate date filter
  let dateFilter = {};
  const now = new Date();
  
  if (startDate && endDate) {
    dateFilter = {
      createdAt: {
        gte: new Date(startDate),
        lte: new Date(endDate)
      }
    };
  } else {
    switch (period) {
      case 'today':
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        dateFilter = {
          createdAt: {
            gte: today,
            lt: tomorrow
          }
        };
        break;
      case 'week':
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - 7);
        dateFilter = {
          createdAt: {
            gte: weekStart
          }
        };
        break;
      case 'month':
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        dateFilter = {
          createdAt: {
            gte: monthStart
          }
        };
        break;
    }
  }
  
  try {
    // Get top items by revenue or quantity
    const topItems = await prisma.orderItem.groupBy({
      by: ['menuItemId'],
      where: {
        order: {
          ...dateFilter,
          status: { not: 'CANCELLED' }
        }
      },
      _sum: {
        totalPrice: true,
        quantity: true
      },
      _count: true,
      orderBy: sortBy === 'revenue' ? 
        { _sum: { totalPrice: 'desc' } } : 
        { _sum: { quantity: 'desc' } },
      take: parseInt(limit)
    });

    // Get menu item details
    const itemIds = topItems.map(item => item.menuItemId);
    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: itemIds } },
      include: {
        translations: {
          where: { language: 'hu' }
        }
      }
    });

    // Combine data
    const enrichedItems = topItems.map(item => {
      const menuItem = menuItems.find(mi => mi.id === item.menuItemId);
      return {
        id: item.menuItemId,
        name: menuItem?.translations[0]?.name || 'Unknown',
        totalRevenue: item._sum.totalPrice || 0,
        totalQuantity: item._sum.quantity || 0,
        orderCount: item._count
      };
    });

    res.json({
      success: true,
      data: {
        items: enrichedItems,
        period,
        sortBy,
        total: enrichedItems.length
      }
    });

  } catch (error) {
    console.error('Top items error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch top selling items'
    });
  }
}));

// Get order timing analytics
app.get('/api/admin/stats/order-timing', authenticateAdmin, asyncHandler(async (req, res) => {
  const { period = 'week' } = req.query;
  
  // Calculate date filter
  let dateFilter = {};
  const now = new Date();
  
  switch (period) {
    case 'today':
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      dateFilter = {
        createdAt: {
          gte: today,
          lt: tomorrow
        }
      };
      break;
    case 'week':
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - 7);
      dateFilter = {
        createdAt: {
          gte: weekStart
        }
      };
      break;
    case 'month':
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      dateFilter = {
        createdAt: {
          gte: monthStart
        }
      };
      break;
  }
  
  try {
    // Get orders for peak hours analysis
    const orders = await prisma.order.findMany({
      where: {
        ...dateFilter,
        status: { not: 'CANCELLED' }
      },
      select: {
        createdAt: true,
        acceptedAt: true,
        readyAt: true,
        total: true
      }
    });

    // Calculate peak hours (hour of day and day of week)
    const hourlyData = {};
    const avgPrepTimes = [];

    orders.forEach(order => {
      const date = new Date(order.createdAt);
      const hour = date.getHours();
      const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
      
      const key = `${dayOfWeek}-${hour}`;
      
      if (!hourlyData[key]) {
        hourlyData[key] = {
          dayOfWeek,
          hour,
          orderCount: 0,
          totalRevenue: 0,
          avgRevenue: 0
        };
      }
      
      hourlyData[key].orderCount++;
      hourlyData[key].totalRevenue += order.total;
      
      // Calculate prep time if available
      if (order.preparingAt && order.readyAt) {
        const prepTime = (new Date(order.readyAt) - new Date(order.preparingAt)) / (1000 * 60); // minutes
        avgPrepTimes.push({
          hour,
          prepTime,
          date: order.createdAt
        });
      }
    });

    // Convert to array and calculate averages
    const peakHours = Object.values(hourlyData).map(data => ({
      ...data,
      avgRevenue: data.orderCount > 0 ? data.totalRevenue / data.orderCount : 0
    }));

    res.json({
      success: true,
      data: {
        avgPrepTimes,
        peakHours,
        period
      }
    });

  } catch (error) {
    console.error('Order timing error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch order timing data'
    });
  }
}));

// Get payment method statistics
app.get('/api/admin/stats/payment-methods', authenticateAdmin, asyncHandler(async (req, res) => {
  const { startDate, endDate, period = 'month' } = req.query;
  
  // Calculate date filter
  let dateFilter = {};
  const now = new Date();
  
  if (startDate && endDate) {
    dateFilter = {
      createdAt: {
        gte: new Date(startDate),
        lte: new Date(endDate)
      }
    };
  } else {
    switch (period) {
      case 'today':
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        dateFilter = {
          createdAt: {
            gte: today,
            lt: tomorrow
          }
        };
        break;
      case 'week':
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - 7);
        dateFilter = {
          createdAt: {
            gte: weekStart
          }
        };
        break;
      case 'month':
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        dateFilter = {
          createdAt: {
            gte: monthStart
          }
        };
        break;
    }
  }
  
  try {
    const paymentStats = await prisma.order.groupBy({
      by: ['paymentMethod'],
      where: {
        ...dateFilter,
        status: { not: 'CANCELLED' }
      },
      _sum: { total: true },
      _count: true
    });

    res.json({
      success: true,
      data: {
        paymentMethods: paymentStats,
        period
      }
    });

  } catch (error) {
    console.error('Payment methods error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payment method stats'
    });
  }
}));

// ============================================
// MENU MANAGEMENT API ENDPOINTS
// Add these endpoints to your server.js file before the ERROR HANDLING section
// ============================================


// Configure multer with Cloudinary storage
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'palace-menu',
    allowed_formats: ['jpeg', 'jpg', 'png', 'webp'],
    transformation: [
      { width: 800, height: 600, crop: 'fill' },
      { quality: 85, format: 'auto' }
    ]
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Get all categories for management
app.get('/api/admin/menu/categories', authenticateAdmin, asyncHandler(async (req, res) => {
  console.log('📋 Loading categories for admin...');
  
  try {
    const categories = await prisma.category.findMany({
      include: {
        translations: true,
        _count: {
          select: { menuItems: true }
        }
      },
      orderBy: { displayOrder: 'asc' }
    });

    console.log(`✅ Found ${categories.length} categories`);

    const processedCategories = categories.map(category => ({
      id: category.id,
      slug: category.slug,
      isActive: category.isActive,
      isDeliverable: category.isDeliverable,
      displayOrder: category.displayOrder,
      itemCount: category._count.menuItems,
      translations: category.translations.reduce((acc, t) => {
        acc[t.language] = { name: t.name };
        return acc;
      }, {})
    }));

    res.json({
      success: true,
      data: processedCategories
    });

  } catch (error) {
    console.error('❌ Error loading categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load categories'
    });
  }
}));

// Get deliverable items for availability toggle
app.get('/api/admin/menu/deliverable-items', authenticateAdmin, asyncHandler(async (req, res) => {
  console.log('📋 Loading deliverable items for admin...');
  
  try {
    const items = await prisma.menuItem.findMany({
      where: {
        isDeleted: false,
        category: {
          isDeliverable: true,
          isActive: true
        }
      },
      include: {
        category: {
          include: {
            translations: {
              where: { language: 'hu' }
            }
          }
        },
        translations: {
          where: { language: 'hu' }
        }
      },
      orderBy: [
        { category: { displayOrder: 'asc' } },
        { id: 'asc' }
      ]
    });

    console.log(`✅ Found ${items.length} deliverable items`);

    // Group by category
    const groupedItems = {};
    
    items.forEach(item => {
      const categoryName = item.category.translations[0]?.name || 'Unknown';
      
      if (!groupedItems[categoryName]) {
        groupedItems[categoryName] = {
          categoryId: item.category.id,
          categorySlug: item.category.slug,
          items: []
        };
      }
      
      groupedItems[categoryName].items.push({
        id: item.id,
        slug: item.slug,
        name: item.translations[0]?.name || 'Unknown',
        price: item.price,
        imageUrl: item.imageUrl,
        isAvailable: item.isAvailable
      });
    });

    res.json({
      success: true,
      data: groupedItems
    });

  } catch (error) {
    console.error('❌ Error loading deliverable items:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load deliverable items'
    });
  }
}));

// Get all menu items for management (with pagination and filtering)
app.get('/api/admin/menu/items', authenticateAdmin, asyncHandler(async (req, res) => {
  console.log('📋 Loading all menu items for admin...');
  
  const { 
    page = 1, 
    limit = 20, 
    categoryId, 
    search, 
    availability, 
    sortBy = 'id',
    sortOrder = 'asc'
  } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  
  // Build where clause
  let whereClause = {};
  
  if (categoryId && categoryId !== 'all') {
    whereClause.categoryId = parseInt(categoryId);
  }
  
  if (search) {
    whereClause.OR = [
      {
        slug: {
          contains: search.toLowerCase()
        }
      },
      {
        translations: {
          some: {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } }
            ]
          }
        }
      }
    ];
  }
  
  if (availability === 'available') {
    whereClause.isAvailable = true;
  } else if (availability === 'unavailable') {
    whereClause.isAvailable = false;
  }

  // Build order clause
  const validSortFields = ['id', 'slug', 'price', 'createdAt', 'updatedAt'];
  const orderBy = validSortFields.includes(sortBy) ? 
    { [sortBy]: sortOrder === 'desc' ? 'desc' : 'asc' } : 
    { id: 'asc' };

  try {
    const [items, total] = await Promise.all([
      prisma.menuItem.findMany({
        where: whereClause,
        include: {
          category: {
            include: {
              translations: {
                where: { language: 'hu' }
              }
            }
          },
          translations: true
        },
        orderBy,
        take: parseInt(limit),
        skip
      }),
      prisma.menuItem.count({ where: whereClause })
    ]);

    console.log(`✅ Found ${items.length} items (${total} total)`);

    const processedItems = items.map(item => ({
      id: item.id,
      slug: item.slug,
      price: item.price,
      imageUrl: item.imageUrl,
      badge: item.badge,
      includesSides: item.includesSides,
      isAvailable: item.isAvailable,
      isPopular: item.isPopular,
      spicyLevel: item.spicyLevel,
      allergens: item.allergens,
      isDeleted: item.isDeleted,
      deletedAt: item.isDeleted,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      category: {
        id: item.category.id,
        slug: item.category.slug,
        name: item.category.translations[0]?.name || 'Unknown',
        isDeliverable: item.category.isDeliverable
      },
      translations: item.translations.reduce((acc, t) => {
        acc[t.language] = {
          name: t.name,
          description: t.description
        };
        return acc;
      }, {})
    }));

    res.json({
      success: true,
      data: {
        items: processedItems,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('❌ Error loading menu items:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch menu items'
    });
  }
}));

// Toggle item availability
app.patch('/api/admin/menu/items/:id/availability', authenticateAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isAvailable } = req.body;

  if (typeof isAvailable !== 'boolean') {
    return res.status(400).json({
      success: false,
      error: 'isAvailable must be a boolean value'
    });
  }

  const updatedItem = await prisma.menuItem.update({
    where: { id: parseInt(id) },
    data: { isAvailable },
    include: {
      translations: {
        where: { language: 'hu' }
      }
    }
  });

  res.json({
    success: true,
    data: {
      id: updatedItem.id,
      slug: updatedItem.slug,
      name: updatedItem.translations[0]?.name || 'Unknown',
      isAvailable: updatedItem.isAvailable
    },
    message: `Item ${isAvailable ? 'enabled' : 'disabled'} successfully`
  });
}));

// Bulk toggle availability
app.patch('/api/admin/menu/items/bulk-availability', authenticateAdmin, asyncHandler(async (req, res) => {
  const { itemIds, isAvailable } = req.body;

  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'itemIds must be a non-empty array'
    });
  }

  if (typeof isAvailable !== 'boolean') {
    return res.status(400).json({
      success: false,
      error: 'isAvailable must be a boolean value'
    });
  }

  const updatedItems = await prisma.menuItem.updateMany({
    where: {
      id: {
        in: itemIds.map(id => parseInt(id))
      }
    },
    data: { isAvailable }
  });

  res.json({
    success: true,
    data: {
      updatedCount: updatedItems.count
    },
    message: `${updatedItems.count} items ${isAvailable ? 'enabled' : 'disabled'} successfully`
  });
}));


// Get single menu item for editing
app.get('/api/admin/menu/items/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const item = await prisma.menuItem.findUnique({
    where: { id: parseInt(id) },
    include: {
      category: {
        include: {
          translations: {
            where: { language: 'hu' }
          }
        }
      },
      translations: true
    }
  });

  if (!item) {
    return res.status(404).json({
      success: false,
      error: 'Menu item not found'
    });
  }

  const processedItem = {
    id: item.id,
    slug: item.slug,
    price: item.price,
    imageUrl: item.imageUrl,
    badge: item.badge,
    includesSides: item.includesSides,
    isAvailable: item.isAvailable,
    isPopular: item.isPopular,
    spicyLevel: item.spicyLevel,
    allergens: item.allergens,
    category: {
      id: item.category.id,
      slug: item.category.slug,
      name: item.category.translations[0]?.name || 'Unknown'
    },
    translations: item.translations.reduce((acc, t) => {
      acc[t.language] = {
        name: t.name,
        description: t.description
      };
      return acc;
    }, {})
  };

  res.json({
    success: true,
    data: processedItem
  });
}));

// Create new menu item
app.post('/api/admin/menu/items', authenticateAdmin, upload.single('image'), asyncHandler(async (req, res) => {
  const {
    slug,
    price,
    categoryId,
    badge,
    spicyLevel = 0,
    allergens,
    includesSides,
    isPopular,
    nameHu,
    nameEn,
    nameSk,
    descriptionHu,
    descriptionEn,
    descriptionSk
  } = req.body;

  // Validation
  if (!slug || !price || !categoryId || !nameHu) {
    return res.status(400).json({
      success: false,
      error: 'Required fields: slug, price, categoryId, nameHu'
    });
  }

  // Validate slug format
  const slugRegex = /^[a-z0-9-]+$/;
  if (!slugRegex.test(slug)) {
    return res.status(400).json({
      success: false,
      error: 'Slug must contain only lowercase letters, numbers, and hyphens'
    });
  }

  // Check if slug already exists
  const existingItem = await prisma.menuItem.findUnique({
    where: { slug }
  });

  if (existingItem) {
    return res.status(400).json({
      success: false,
      error: 'Slug already exists. Please choose a different one.'
    });
  }

  // Verify category exists
  const category = await prisma.category.findUnique({
    where: { id: parseInt(categoryId) }
  });

  if (!category) {
    return res.status(400).json({
      success: false,
      error: 'Invalid category selected'
    });
  }

  // Process image upload if provided
  let imageUrl = null;

  if (req.file) {
    imageUrl = req.file.path; // Cloudinary provides the full URL
  } 

  try {
    // Create menu item with translations
    const newItem = await prisma.menuItem.create({
      data: {
        slug,
        price: parseFloat(price),
        categoryId: parseInt(categoryId),
        imageUrl,
        badge: badge || null,
        includesSides: includesSides === 'true' || includesSides === true,
        isAvailable: true, // New items are available by default
        isPopular: isPopular === 'true' || isPopular === true,
        spicyLevel: parseInt(spicyLevel) || 0,
        allergens: allergens ? allergens.split(',').map(a => a.trim()).filter(a => a) : [],
        translations: {
          create: [
            // Hungarian (required)
            {
              language: 'hu',
              name: nameHu.trim(),
              description: descriptionHu?.trim() || null
            },
            // English (optional)
            ...(nameEn ? [{
              language: 'en',
              name: nameEn.trim(),
              description: descriptionEn?.trim() || null
            }] : []),
            // Slovak (optional)
            ...(nameSk ? [{
              language: 'sk',
              name: nameSk.trim(),
              description: descriptionSk?.trim() || null
            }] : [])
          ]
        }
      },
      include: {
        category: {
          include: {
            translations: {
              where: { language: 'hu' }
            }
          }
        },
        translations: true
      }
    });

    res.status(201).json({
      success: true,
      data: {
        id: newItem.id,
        slug: newItem.slug,
        name: newItem.translations.find(t => t.language === 'hu')?.name || 'Unknown',
        price: newItem.price,
        category: newItem.category.translations[0]?.name || 'Unknown'
      },
      message: 'Menu item created successfully'
    });

  } catch (error) {

    console.error('Create menu item error:', error);
    
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        error: 'Slug already exists'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to create menu item'
    });
  }
}));

// Update existing menu item
app.put('/api/admin/menu/items/:id', authenticateAdmin, upload.single('image'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    slug,
    price,
    categoryId,
    badge,
    spicyLevel = 0,
    allergens,
    includesSides,
    isPopular,
    nameHu,
    nameEn,
    nameSk,
    descriptionHu,
    descriptionEn,
    descriptionSk
  } = req.body;

  // Check if item exists
  const existingItem = await prisma.menuItem.findUnique({
    where: { id: parseInt(id) },
    include: { translations: true }
  });

  if (!existingItem) {
    return res.status(404).json({
      success: false,
      error: 'Menu item not found'
    });
  }

  // Validation
  if (!slug || !price || !categoryId || !nameHu) {
    return res.status(400).json({
      success: false,
      error: 'Required fields: slug, price, categoryId, nameHu'
    });
  }

  // Validate slug format
  const slugRegex = /^[a-z0-9-]+$/;
  if (!slugRegex.test(slug)) {
    return res.status(400).json({
      success: false,
      error: 'Slug must contain only lowercase letters, numbers, and hyphens'
    });
  }

  // Check if slug conflicts with other items (excluding current item)
  if (slug !== existingItem.slug) {
    const conflictingItem = await prisma.menuItem.findUnique({
      where: { slug }
    });

    if (conflictingItem) {
      return res.status(400).json({
        success: false,
        error: 'Slug already exists. Please choose a different one.'
      });
    }
  }

  let imageUrl = existingItem.imageUrl;

  // Process new image upload if provided
  if (req.file) {
    // Delete old image from Cloudinary if exists
    if (existingItem.imageUrl && existingItem.imageUrl.includes('cloudinary.com')) {
      try {
        const publicId = existingItem.imageUrl.split('/').slice(-2).join('/').split('.')[0];
        await cloudinary.uploader.destroy(publicId);
      } catch (deleteError) {
        console.log('Old image deletion failed:', deleteError.message);
      }
    }
    imageUrl = req.file.path; // Cloudinary provides the full URL
  }

  try {
    // Update menu item
    const updatedItem = await prisma.menuItem.update({
      where: { id: parseInt(id) },
      data: {
        slug,
        price: parseFloat(price),
        categoryId: parseInt(categoryId),
        imageUrl,
        badge: badge || null,
        includesSides: includesSides === 'true' || includesSides === true,
        isPopular: isPopular === 'true' || isPopular === true,
        spicyLevel: parseInt(spicyLevel) || 0,
        allergens: allergens ? allergens.split(',').map(a => a.trim()).filter(a => a) : []
      },
      include: {
        category: {
          include: {
            translations: { where: { language: 'hu' } }
          }
        },
        translations: true
      }
    });

    // Update translations
    const translationUpdates = [
      { language: 'hu', name: nameHu?.trim(), description: descriptionHu?.trim() || null },
      ...(nameEn ? [{ language: 'en', name: nameEn.trim(), description: descriptionEn?.trim() || null }] : []),
      ...(nameSk ? [{ language: 'sk', name: nameSk.trim(), description: descriptionSk?.trim() || null }] : [])
    ];

    // Delete existing translations and create new ones
    await prisma.menuItemTranslation.deleteMany({
      where: { menuItemId: parseInt(id) }
    });

    await prisma.menuItemTranslation.createMany({
      data: translationUpdates.map(t => ({
        menuItemId: parseInt(id),
        language: t.language,
        name: t.name,
        description: t.description
      }))
    });

    res.json({
      success: true,
      data: {
        id: updatedItem.id,
        slug: updatedItem.slug,
        name: nameHu,
        price: updatedItem.price,
        category: updatedItem.category.translations[0]?.name || 'Unknown'
      },
      message: 'Menu item updated successfully'
    });

  } catch (error) {
    console.error('Update menu item error:', error);
    
    res.status(500).json({
      success: false,
      error: 'Failed to update menu item'
    });
  }
}));

// Delete menu item
app.delete('/api/admin/menu/items/:id', authenticateAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const item = await prisma.menuItem.findUnique({
    where: { id: parseInt(id) },
    include: {
      translations: true
    }
  });

  if (!item) {
    return res.status(404).json({
      success: false,
      error: 'Menu item not found'
    });
  }

  if (item.isDeleted) {
    return res.status(400).json({
      success: false,
      error: 'Menu item is already deleted'
    });
  }

  try {
    const updatedItem = await prisma.menuItem.update({
      where: { id: parseInt(id) },
      data: {
        isAvailable: false,
        isDeleted: true,
        deletedAt: new Date()
      }
    });

    res.json({
      success: true,
      data: {
        id: updatedItem.id,
        name: item.translations.find(t => t.language === 'hu')?.name || 'Unknown'
      },
      message: 'Menu item deleted successfully'
    });

  } catch (error) {
    console.error('Delete menu item error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete menu item'
    });
  }
}));

// Restore deleted menu item
app.patch('/api/admin/menu/items/:id/restore', authenticateAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const item = await prisma.menuItem.findUnique({
    where: { id: parseInt(id) },
    include: {
      translations: true
    }
  });

  if (!item) {
    return res.status(404).json({
      success: false,
      error: 'Menu item not found'
    });
  }

  if (!item.isDeleted) {
    return res.status(400).json({
      success: false,
      error: 'Menu item is not deleted'
    });
  }

  try {
    const restoredItem = await prisma.menuItem.update({
      where: { id: parseInt(id) },
      data: {
        isDeleted: false,
        deletedAt: null,
        isAvailable: true // Restore as available
      }
    });

    res.json({
      success: true,
      data: {
        id: restoredItem.id,
        name: item.translations.find(t => t.language === 'hu')?.name || 'Unknown'
      },
      message: 'Menu item restored successfully'
    });

  } catch (error) {
    console.error('Restore menu item error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to restore menu item'
    });
  }
}));

// ============================================
// ADMIN INVOICE MANAGEMENT APIs
// ============================================

// Get all invoices with filtering and pagination
app.get('/api/admin/invoices', authenticateAdmin, asyncHandler(async (req, res) => {
  const { 
    page = 1, 
    limit = 20, 
    paymentMethod, 
    month, 
    year = new Date().getFullYear(),
    search 
  } = req.query;

  console.log(`📋 Admin requesting invoices - Page: ${page}, Payment: ${paymentMethod}`);

  try {
    // Build filter conditions
    const where = {};
    
    if (paymentMethod && paymentMethod !== 'ALL') {
      where.paymentMethod = paymentMethod;
    }
    
    // Date filtering
    if (month && year) {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59);
      where.createdAt = {
        gte: startDate,
        lte: endDate
      };
    } else if (year) {
      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year, 11, 31, 23, 59, 59);
      where.createdAt = {
        gte: startDate,
        lte: endDate
      };
    }
    
    // Search by customer name or invoice number
    if (search) {
      where.OR = [
        { customerName: { contains: search, mode: 'insensitive' } },
        { invoiceNumber: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Get total count for pagination
    const totalCount = await prisma.invoice.count({ where });
    
    // Get invoices with pagination
    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        order: {
          select: {
            orderNumber: true,
            orderType: true,
            status: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit)
    });

    // Calculate summary stats for the filtered results
    const summaryStats = await prisma.invoice.aggregate({
      where,
      _sum: {
        totalGross: true,
        totalNet: true,
        vatAmount: true
      },
      _count: true
    });

    console.log(`✅ Retrieved ${invoices.length} invoices`);

    res.json({
      success: true,
      data: {
        invoices: invoices.map(invoice => ({
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          customerName: invoice.customerName,
          customerEmail: invoice.customerEmail,
          paymentMethod: invoice.paymentMethod,
          totalGross: invoice.totalGross,
          totalNet: invoice.totalNet,
          vatAmount: invoice.vatAmount,
          emailSent: invoice.emailSent,
          createdAt: invoice.createdAt,
          order: invoice.order
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          pages: Math.ceil(totalCount / parseInt(limit))
        },
        summary: {
          count: summaryStats._count,
          totalRevenue: summaryStats._sum.totalGross || 0,
          totalNet: summaryStats._sum.totalNet || 0,
          totalVAT: summaryStats._sum.vatAmount || 0
        }
      }
    });

  } catch (error) {
    console.error('❌ Failed to fetch invoices:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch invoices'
    });
  }
}));

// Download specific invoice PDF
app.get('/api/admin/invoices/:id/pdf', authenticateAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  console.log(`📄 Admin requesting PDF for invoice ID: ${id}`);

  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: parseInt(id) },
      include: {
        order: {
          include: {
            items: {
              include: {
                menuItem: {
                  include: {
                    translations: { where: { language: 'hu' } }
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: 'Invoice not found'
      });
    }

    console.log(`📋 Generating PDF for invoice ${invoice.invoiceNumber}`);

    // Generate PDF from stored data
    const pdfBuffer = await generateInvoicePDF({
      ...invoice,
      orderItems: invoice.orderItems // This is stored as JSON
    });

    // Set headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="faktura-${invoice.invoiceNumber}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);

    console.log(`✅ PDF generated and sent for ${invoice.invoiceNumber}`);
    res.send(pdfBuffer);

  } catch (error) {
    console.error('❌ Failed to generate invoice PDF:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate PDF'
    });
  }
}));

// Resend invoice email
app.post('/api/admin/invoices/:id/resend-email', authenticateAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { email } = req.body; // Optional: send to different email
  
  console.log(`📧 Admin requesting email resend for invoice ID: ${id}`);

  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: parseInt(id) },
      include: { order: true }
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: 'Invoice not found'
      });
    }

    const targetEmail = email || invoice.customerEmail;
    
    if (!targetEmail) {
      return res.status(400).json({
        success: false,
        error: 'No email address provided'
      });
    }

    // Generate PDF
    const pdfBuffer = await generateInvoicePDF({
      ...invoice,
      orderItems: invoice.orderItems
    });

    // Send email
    const emailResult = await sendInvoiceEmail(invoice, pdfBuffer, targetEmail);

    if (emailResult.success) {
      // Update invoice record
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          emailSent: true,
          emailSentAt: new Date(),
          emailAttempts: (invoice.emailAttempts || 0) + 1
        }
      });

      console.log(`✅ Invoice email resent to ${targetEmail}`);
      res.json({
        success: true,
        message: `Invoice email sent to ${targetEmail}`
      });
    } else {
      // Update failed attempt
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          emailAttempts: (invoice.emailAttempts || 0) + 1
        }
      });

      res.status(500).json({
        success: false,
        error: emailResult.error
      });
    }

  } catch (error) {
    console.error('❌ Failed to resend invoice email:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to resend email'
    });
  }
}));

// Generate monthly invoice report (Excel export)
app.get('/api/admin/invoices/export/monthly', authenticateAdmin, asyncHandler(async (req, res) => {
  const { month, year = new Date().getFullYear(), format = 'json' } = req.query;

  console.log(`📊 Admin requesting monthly report - ${month}/${year}`);

  try {
    // Date range
    const startDate = month 
      ? new Date(year, month - 1, 1) 
      : new Date(year, 0, 1);
    const endDate = month 
      ? new Date(year, month, 0, 23, 59, 59)
      : new Date(year, 11, 31, 23, 59, 59);

    // Get invoices for the period
    const invoices = await prisma.invoice.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        order: {
          select: {
            orderNumber: true,
            orderType: true
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    // Calculate summary by payment method
    const cashInvoices = invoices.filter(inv => inv.paymentMethod === 'CASH');
    const cardInvoices = invoices.filter(inv => inv.paymentMethod === 'CARD' || inv.paymentMethod === 'ONLINE');

    const summary = {
      period: month ? `${month}/${year}` : year.toString(),
      cash: {
        count: cashInvoices.length,
        totalNet: cashInvoices.reduce((sum, inv) => sum + inv.totalNet, 0),
        totalVAT: cashInvoices.reduce((sum, inv) => sum + inv.vatAmount, 0),
        totalGross: cashInvoices.reduce((sum, inv) => sum + inv.totalGross, 0),
        invoices: cashInvoices.map(inv => ({
          invoiceNumber: inv.invoiceNumber,
          date: inv.createdAt,
          customer: inv.customerName,
          orderNumber: inv.order?.orderNumber,
          net: inv.totalNet,
          vat: inv.vatAmount,
          gross: inv.totalGross
        }))
      },
      card: {
        count: cardInvoices.length,
        totalNet: cardInvoices.reduce((sum, inv) => sum + inv.totalNet, 0),
        totalVAT: cardInvoices.reduce((sum, inv) => sum + inv.vatAmount, 0),
        totalGross: cardInvoices.reduce((sum, inv) => sum + inv.totalGross, 0),
        invoices: cardInvoices.map(inv => ({
          invoiceNumber: inv.invoiceNumber,
          date: inv.createdAt,
          customer: inv.customerName,
          orderNumber: inv.order?.orderNumber,
          net: inv.totalNet,
          vat: inv.vatAmount,
          gross: inv.totalGross
        }))
      },
      totals: {
        count: invoices.length,
        totalNet: invoices.reduce((sum, inv) => sum + inv.totalNet, 0),
        totalVAT: invoices.reduce((sum, inv) => sum + inv.vatAmount, 0),
        totalGross: invoices.reduce((sum, inv) => sum + inv.totalGross, 0)
      }
    };

    console.log(`✅ Monthly report generated - ${invoices.length} invoices`);

    res.json({
      success: true,
      data: summary
    });

  } catch (error) {
    console.error('❌ Failed to generate monthly report:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate monthly report'
    });
  }
}));

// ============================================
// EMAIL SERVICE TEST APIs
// ============================================

// Test email configuration
app.get('/api/admin/email/test-config', authenticateAdmin, asyncHandler(async (req, res) => {
  console.log('🧪 Testing email configuration...');
  
  try {
    const testResult = await testEmailConfig();
    
    if (testResult.success) {
      console.log('✅ Email configuration test passed');
      res.json({
        success: true,
        message: 'Email configuration is valid',
        config: testResult.config
      });
    } else {
      console.log('❌ Email configuration test failed:', testResult.error);
      res.status(500).json({
        success: false,
        error: testResult.error
      });
    }
  } catch (error) {
    console.error('❌ Email test error:', error);
    res.status(500).json({
      success: false,
      error: 'Email configuration test failed'
    });
  }
}));

// Send test email
app.post('/api/admin/email/send-test', authenticateAdmin, asyncHandler(async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({
      success: false,
      error: 'Email address is required'
    });
  }

  console.log(`🧪 Sending test email to ${email}`);

  try {
    // Create a sample invoice for testing
    const testInvoiceData = {
      invoiceNumber: 'TEST-001',
      customerName: 'Test Customer',
      customerEmail: email,
      totalGross: 15.50,
      paymentMethod: 'CASH',
      orderItems: [
        {
          name: 'Palace Burger',
          quantity: 1,
          unitPrice: 8.50,
          totalPrice: 8.50,
          customizations: 'Extra cheese'
        },
        {
          name: 'Fanta',
          quantity: 1,
          unitPrice: 2.50,
          totalPrice: 2.50,
          customizations: ''
        }
      ],
      order: {
        orderNumber: 'TEST-001',
        orderType: 'PICKUP'
      },
      createdAt: new Date()
    };

    // Generate test PDF
    const pdfBuffer = await generateInvoicePDF(testInvoiceData);
    
    // Send test email
    const emailResult = await sendInvoiceEmail(testInvoiceData, pdfBuffer, email);

    if (emailResult.success) {
      console.log(`✅ Test email sent successfully to ${email}`);
      res.json({
        success: true,
        message: `Test email sent successfully to ${email}`,
        messageId: emailResult.messageId
      });
    } else {
      console.log(`❌ Test email failed: ${emailResult.error}`);
      res.status(500).json({
        success: false,
        error: emailResult.error
      });
    }

  } catch (error) {
    console.error('❌ Test email error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send test email'
    });
  }
}));


// ============================================
// ERROR HANDLING
// ============================================

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Global error handler
app.use(errorHandler);

// ============================================
// SERVER STARTUP
// ============================================

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

// Start server
//app.listen(PORT, () => {
//  console.log('🚀 Palace Cafe API Server running!');
//  console.log(`📍 Server: http://localhost:${PORT}`);
//  console.log(`🏥 Health: http://localhost:${PORT}/api/health`);
//  console.log(`📋 Menu: http://localhost:${PORT}/api/menu`);
//  console.log(`🛒 Orders: http://localhost:${PORT}/api/orders`);
//  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
//});

module.exports = app;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});






