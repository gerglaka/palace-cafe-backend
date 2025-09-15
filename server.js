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
    'https://palacebar.sk',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'file://' 
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token']
}));

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

  console.log('Extracted fields:');
  console.log('- customerName:', customerName);
  console.log('- items:', items);
  console.log('- deliveryNotes:', deliveryNotes);  

    // Log each item's structure
  items.forEach((item, index) => {
    console.log(`Item ${index}:`, {
      menuItemId: item.menuItemId,
      removeItems: item.removeItems,
      specialNotes: item.specialNotes
    });
  });

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

  // Get restaurant settings for delivery fee
  const restaurant = await prisma.restaurant.findFirst();
  const deliveryFee = (orderType === 'DELIVERY') ? restaurant?.deliveryFee || 2.50 : 0;

  // Calculate totals
  let subtotal = 0;
  const orderItems = [];

  for (const item of items) {
    const menuItem = await prisma.menuItem.findUnique({
      where: { id: item.menuItemId }
    });

    if (!menuItem) {
      return res.status(400).json({
        success: false,
        error: `Menu item with ID ${item.menuItemId} not found`
      });
    }

    let itemTotal = menuItem.price * item.quantity;
    
    // Add fries upgrade cost - check if sides are included
    if (item.friesUpgrade) {
      const friesOption = await prisma.friesOption.findFirst({
        where: { slug: item.friesUpgrade }
      });
      
      if (friesOption) {
        if (menuItem.includesSides) {
          // Items WITH sides included - regular fries are FREE, only charge for upgrades
          if (friesOption.slug !== 'regular' && friesOption.slug !== 'regular-fries') {
            itemTotal += friesOption.priceAddon * item.quantity;
            console.log(`Added fries upgrade: ${friesOption.slug} (+€${friesOption.priceAddon})`);
          } else {
            console.log(`Regular fries included for free (includesSides: true)`);
          }
        } else {
          // Items WITHOUT sides included - charge full price for any fries
          itemTotal += friesOption.priceAddon * item.quantity;
          console.log(`Added fries addon: ${friesOption.slug} (+€${friesOption.priceAddon})`);
        }
      }
    }

    // Add extras cost (assuming €0.30 per extra)
    if (item.extras && item.extras.length > 0) {
      itemTotal += (item.extras.length * 0.30) * item.quantity;
    }

    subtotal += itemTotal;
    
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
  }

  const total = subtotal + deliveryFee;

  // Create order
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

  res.status(201).json({
    success: true,
    data: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      estimatedTime: order.estimatedTime,
      total: order.total
    },
    message: 'Order placed successfully!'
  });
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


// Static file serving for menu images
app.use('/images/menu', express.static('C:\\Users\\gergi\\OneDrive\\Desktop\\Palace2\\Frontend\\assets\\images\\menu'));

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = 'C:\\Users\\gergi\\OneDrive\\Desktop\\Palace2\\Frontend\\assets\\images\\menu';
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${Date.now()}${path.extname(file.originalname).toLowerCase()}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
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

  let imageUrl = null;

  // Process image upload if provided
  if (req.file) {
    try {
      const processedImagePath = path.join(
        'C:\\Users\\gergi\\OneDrive\\Desktop\\Palace2\\Frontend\\assets\\images\\menu',
        `processed-${req.file.filename}`
      );

      // Process image with sharp (resize and optimize)
      await sharp(req.file.path)
        .resize(800, 600, { 
          fit: 'cover',
          withoutEnlargement: true 
        })
        .jpeg({ 
          quality: 85,
          progressive: true 
        })
        .toFile(processedImagePath);

      // Remove original file
      await fs.unlink(req.file.path);

      // Set image URL for database
      imageUrl = `assets/images/menu/processed-${req.file.filename}`;

    } catch (imageError) {
      console.error('Image processing error:', imageError);
      // Clean up files
      try {
        await fs.unlink(req.file.path);
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError);
      }
      
      return res.status(400).json({
        success: false,
        error: 'Failed to process image'
      });
    }
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
    // Clean up uploaded image if database operation fails
    if (imageUrl) {
      try {
        const imagePath = path.join(
          'C:\\Users\\gergi\\OneDrive\\Desktop\\Palace2\\Frontend\\assets\\images\\menu',
          path.basename(imageUrl)
        );
        await fs.unlink(imagePath);
      } catch (cleanupError) {
        console.error('Image cleanup error:', cleanupError);
      }
    }

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
    try {
      const processedImagePath = path.join(
        'C:\\Users\\gergi\\OneDrive\\Desktop\\Palace2\\Frontend\\assets\\images\\menu',
        `processed-${req.file.filename}`
      );

      // Process image with sharp
      await sharp(req.file.path)
        .resize(800, 600, { 
          fit: 'cover',
          withoutEnlargement: true 
        })
        .jpeg({ 
          quality: 85,
          progressive: true 
        })
        .toFile(processedImagePath);

      // Remove original file
      await fs.unlink(req.file.path);

      // Delete old image if exists
      if (existingItem.imageUrl) {
        try {
          const oldImagePath = path.join(
            'C:\\Users\\gergi\\OneDrive\\Desktop\\Palace2\\Frontend\\assets\\images\\menu',
            path.basename(existingItem.imageUrl)
          );
          await fs.unlink(oldImagePath);
        } catch (deleteError) {
          console.log('Old image deletion failed (may not exist):', deleteError.message);
        }
      }

      imageUrl = `assets/images/menu/processed-${req.file.filename}`;

    } catch (imageError) {
      console.error('Image processing error:', imageError);
      return res.status(400).json({
        success: false,
        error: 'Failed to process image'
      });
    }
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



