const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();

// Your CSV data (paste this in)
const csvData = `Category;Name;Price;Description;includesSides;isDeliverable;badge;imageUrl
Smashburgers;Classic Cheese Burger;8,9;Angus Marhahús, 2x cheddar, olvasztott cheddar, majo, ketchup, mustár, savanyú uborka;1;1;;assets\\images\\menu\\classic-cheese.JPG
Smashburgers;Palace Burger ;11,9;Angus Marhahús, 2x cheddar, olvasztott cheddar, házi hagymalekvár, házi bacon  szósz, házi sweet chili, savanyú uborka, 2x bacon;1;1;Bestseller;assets\\images\\menu\\palace-burger.JPG
Hamburgers;Bacon Burger;12,9;150g Angus Marhahús, 4x bacon, cheddar, majo, bacon szósz, uborka, saláta lollo, hagyma, paradicsom, olvasztott cheddar;1;1;;assets\\images\\menu\\bacon-burger.JPG
Hamburgers;Simple Burger;10,9;150g Angus Marhahús, cheddar, majo, hot smokey szósz, uborka, saláta lollo, hagyma, paradicsom;1;1;;assets\\images\\menu\\simple-burger.JPG
Qurritos;Simple Qurrito;7,7;Tortilla, bbq honeq, cheddar, csirkemell;1;1;;assets\\images\\menu\\simple-qurrito.JPG
Qurritos;Hot Qurrito;7,9;Tortilla, samuraj, cheddar, csirkemell, paradicsom, rukkola;1;1;Spicy;assets\\images\\menu\\hot-qurrito.JPG
Mediterranean;Gyros;7,7;Pita, 150g gyros csirke, majo, tzatziki, paradicsom, uborka, hagyma;1;1;;assets\\images\\menu\\gyros.JPG
Mediterranean;Taco Beef;7,7;2x Tortilla, sriracha, cheddar, sörben pácolt házi tépetthús + házi chimichurri;0;1;;assets\\images\\menu\\taco-beef.JPG
Sides;Hasábburgonya;2,5;;0;1;;assets\\images\\menu\\fries.JPG
Sides ;Édesburgonya;3,5;;0;1;;assets\\images\\menu\\sweet-potato.JPG
Desserts;Churros;5,9;Churros, nutella, gyümölcsök, fahéj;0;0;;
Desserts;American Pancake;5,9;Amerikai palacsinta, csoki + karamel szósz, juharszirup, nutella, mandula, gyümölcsök, tejszínhab;0;0;;
Sauces ;Kecsup;1;;0;1;;assets\\images\\menu\\ketchup.JPG
Sauces ;BBQ Honey;1;;0;1;;assets\\images\\menu\\bbq-honey.JPG
NonAlcoholic;Coca Cola;2;;0;1;;assets\\images\\menu\\coca-cola.JPG
NonAlcoholic;Fanta;2;;0;1;;assets\\images\\menu\\fanta.JPG
Coffees;Espresso;2,2;;0;0;;
Coffees;Cappuccino;2,7;;0;0;;
Specialty;Matcha Latte;3,6;;0;0;;
Specialty;Matcha Tonic;3,6;;0;0;;
Lemonades;Epres Limonádé;3,7;;0;0;;
Lemonades;Mangós Limonádé;3,7;;0;0;;
Alcohol;Pilsner Urquell 0,5L;2,7;;0;0;;
Alcohol;Irsai Olivér 0,1L;1,5;Fehér száraz;0;0;;
Shots;Finlandia 0,04L;2,5;;0;0;;
Shots;Beefeater 0,04L;2,7;;0;0;;
Cocktails;Gintonic;5,4;4cl Gin, Tonic Classic/Mojito/Rose;0;0;;
Cocktails;Moscow Mule;5,4;6cl Vodka, limelé, áfony dzsúsz, gyömbér tonic;0;0;;`;

function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(';');
  
  return lines.slice(1).map(line => {
    const values = line.split(';');
    const item = {};
    
    headers.forEach((header, index) => {
      let value = values[index] || '';
      
      // Clean up the value
      if (header === 'Price') {
        value = parseFloat(value.replace(',', '.')) || 0;
      } else if (header === 'includesSides' || header === 'isDeliverable') {
        value = value === '1';
      } else {
        value = value.trim();
      }
      
      item[header.trim()] = value;
    });
    
    return item;
  });
}

function createSlug(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main() {
  console.log('🌱 Starting Palace Cafe data import...');

  // Clear existing data
  console.log('🧹 Cleaning existing data...');
  await prisma.orderItem.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.order.deleteMany();
  await prisma.customerAddress.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.menuItemTranslation.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.categoryTranslation.deleteMany();
  await prisma.category.deleteMany();
  await prisma.sauceTranslation.deleteMany();
  await prisma.sauce.deleteMany();
  await prisma.friesOptionTranslation.deleteMany();
  await prisma.friesOption.deleteMany();
  await prisma.adminUser.deleteMany();
  await prisma.restaurant.deleteMany();
  await prisma.setting.deleteMany();

  // 1. Create Restaurant Info
  console.log('🏪 Creating restaurant info...');
  const restaurant = await prisma.restaurant.create({
    data: {
      name: 'Palace Cafe & Bar',
      description: 'Autentikus ízek 2016 óta',
      phone: '+421 XXX XXX XXX',
      email: 'info@palacecafe.sk',
      address: 'Your Address',
      city: 'Bratislava',
      postalCode: '81101',
      country: 'Slovakia',
      deliveryFee: 2.50,
      minimumOrder: 5.00,
      deliveryTime: '30-45 min',
      dic: '2122291578',
      ico: '56384840',
      vatNumber: 'SK2122291578',
      vatRate: 19.0
    }
  });

  // 2. Parse CSV data
  console.log('📋 Parsing menu data...');
  const menuData = parseCSV(csvData);
  
  // Get unique categories
  const uniqueCategories = [...new Set(menuData.map(item => item.Category.trim()))];
  
  // 3. Create categories
  console.log('📂 Creating categories...');
  const categoryMap = new Map();
  
  for (let i = 0; i < uniqueCategories.length; i++) {
    const categoryName = uniqueCategories[i];
    const sampleItem = menuData.find(item => item.Category.trim() === categoryName);
    
    const category = await prisma.category.create({
      data: {
        slug: createSlug(categoryName),
        displayOrder: i + 1,
        isActive: true,
        isDeliverable: sampleItem.isDeliverable,
        translations: {
          create: [
            { 
              language: 'hu', 
              name: categoryName,
              description: `${categoryName} kategória`
            },
            { 
              language: 'en', 
              name: categoryName,
              description: `${categoryName} category`
            },
            { 
              language: 'sk', 
              name: categoryName,
              description: `${categoryName} kategória`
            }
          ]
        }
      }
    });
    
    categoryMap.set(categoryName, category.id);
  }

  // 4. Create menu items
  console.log('🍔 Creating menu items...');
  for (const item of menuData) {
    const categoryId = categoryMap.get(item.Category.trim());
    
    await prisma.menuItem.create({
      data: {
        slug: createSlug(item.Name),
        price: item.Price,
        imageUrl: item.imageUrl || null,
        badge: item.badge || null,
        includesSides: item.includesSides,
        isAvailable: true,
        isPopular: item.badge === 'Bestseller',
        spicyLevel: item.badge === 'Spicy' ? 3 : 0,
        categoryId: categoryId,
        isDeleted: false,
        deletedAt: null,
        translations: {
          create: [
            {
              language: 'hu',
              name: item.Name.trim(),
              description: item.Description || ''
            },
            {
              language: 'en',
              name: item.Name.trim(),
              description: item.Description || ''
            },
            {
              language: 'sk',
              name: item.Name.trim(),
              description: item.Description || ''
            }
          ]
        }
      }
    });
  }

  // 5. Create sauce options
  console.log('🥫 Creating sauce options...');
  const sauces = [
    { name: 'Majonéz', nameEn: 'Mayo', default: true },
    { name: 'Ketchup', nameEn: 'Ketchup', default: false },
    { name: 'BBQ Honey', nameEn: 'BBQ Honey', default: false },
    { name: 'Hot Smokey', nameEn: 'Hot Smokey', default: false },
    { name: 'Szamurai', nameEn: 'Samurai', default: false },
    { name: 'Édes Chili', nameEn: 'Sweet Chili', default: false }
  ];

  for (const sauce of sauces) {
    await prisma.sauce.create({
      data: {
        slug: createSlug(sauce.nameEn),
        price: 0.00,
        isDefault: sauce.default,
        isActive: true,
        translations: {
          create: [
            { language: 'hu', name: sauce.name },
            { language: 'en', name: sauce.nameEn },
            { language: 'sk', name: sauce.name }
          ]
        }
      }
    });
  }

  // 6. Create fries options
  console.log('🍟 Creating fries options...');
  const friesOptions = [
    { name: 'Sima hasábburgonya', nameEn: 'Regular Fries', addon: 0.00, default: true },
    { name: 'Édesburgonya hasáb', nameEn: 'Sweet Potato Fries', addon: 1.30, default: false }
  ];

  for (const fries of friesOptions) {
    await prisma.friesOption.create({
      data: {
        slug: createSlug(fries.nameEn),
        priceAddon: fries.addon,
        isDefault: fries.default,
        isActive: true,
        translations: {
          create: [
            { language: 'hu', name: fries.name },
            { language: 'en', name: fries.nameEn },
            { language: 'sk', name: fries.name }
          ]
        }
      }
    });
  }

  // 7. Create sample admin user
  console.log('👤 Creating admin user...');
  const bcrypt = require('bcryptjs');
  const hashedPassword = await bcrypt.hash('Becherovka123', 10);
  
  await prisma.adminUser.create({
    data: {
      email: 'admin@palacecafe.sk',
      firstName: 'Admin',
      lastName: 'User',
      password: hashedPassword,
      role: 'SUPER_ADMIN',
      isActive: true
    }
  });

  console.log('✅ Database seeded successfully!');
  console.log(`📊 Created: ${uniqueCategories.length} categories, ${menuData.length} menu items`);
  console.log('🔐 Admin login: admin@palacecafe.sk / admin123');
}

async function shouldSeed() {
  try {
    const [categoryCount, menuItemCount, adminCount] = await Promise.all([
      prisma.category.count(),
      prisma.menuItem.count(), 
      prisma.adminUser.count()
    ]);

    const isEmpty = categoryCount === 0 && menuItemCount === 0 && adminCount === 0;
    
    if (!isEmpty) {
      console.log(`📊 Database has data: ${categoryCount} categories, ${menuItemCount} menu items, ${adminCount} admins`);
      console.log('⏭️  Skipping seeding - database already initialized');
      return false;
    }
    
    console.log('🌱 Database is empty - proceeding with seeding');
    return true;
  } catch (error) {
    console.error('❌ Error checking database state:', error.message);
    return false;
  }
}

async function checkEnvironment() {
  const isProduction = process.env.NODE_ENV === 'production';
  const isRailway = process.env.RAILWAY_ENVIRONMENT_NAME !== undefined;
  const forceReset = process.env.FORCE_SEED === 'true';
  
  // Railway production: only allow seeding empty databases
  if (isProduction && isRailway && !forceReset) {
    console.log('🔒 Railway production mode - only seeding empty database');
    return true; // Allow checking if database is empty
  }
  
  // Local development: always allow
  if (!isProduction && !isRailway) {
    console.log('🛠️ Local development mode - seeding allowed');
    return true;
  }
  
  return forceReset;
}

// Smart initialization
async function initializeDatabase() {
  try {
    // Check environment first
    if (!(await checkEnvironment())) {
      return;
    }
    
    // Check if seeding is needed
    if (!(await shouldSeed())) {
      return;
    }
    
    // Run the seeding
    console.log('🚀 Starting database seeding...');
    await main();
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    
    // Don't exit process in production
    if (process.env.NODE_ENV !== 'production') {
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Only run if called directly (not imported)
if (require.main === module) {
  initializeDatabase();
}

// Export for manual use
module.exports = { main, shouldSeed, initializeDatabase };