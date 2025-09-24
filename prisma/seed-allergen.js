const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const allergens = [
  {
    code: "1",
    displayOrder: 1,
    translations: {
      hu: "Glutént tartalmazó gabona",
      en: "Cereals containing gluten", 
      sk: "Obilniny obsahujúce lepok"
    }
  },
  {
    code: "2", 
    displayOrder: 2,
    translations: {
      hu: "Rákfélék",
      en: "Crustaceans",
      sk: "Kôrovce"
    }
  },
  {
    code: "3",
    displayOrder: 3,
    translations: {
      hu: "Tojás",
      en: "Eggs",
      sk: "Vajcia"
    }
  },
  {
    code: "4",
    displayOrder: 4, 
    translations: {
      hu: "Hal",
      en: "Fish",
      sk: "Ryby"
    }
  },
  {
    code: "5",
    displayOrder: 5,
    translations: {
      hu: "Földimogyoró", 
      en: "Peanuts",
      sk: "Arašidy"
    }
  },
  {
    code: "6",
    displayOrder: 6,
    translations: {
      hu: "Szójabab",
      en: "Soybeans", 
      sk: "Sójové bôby"
    }
  },
  {
    code: "7", 
    displayOrder: 7,
    translations: {
      hu: "Tej (laktóz)",
      en: "Milk (lactose)",
      sk: "Mlieko (laktóza)"
    }
  },
  {
    code: "8",
    displayOrder: 8,
    translations: {
      hu: "Dióféle",
      en: "Tree nuts",
      sk: "Orechy"
    }
  },
  {
    code: "9",
    displayOrder: 9,
    translations: {
      hu: "Zeller", 
      en: "Celery",
      sk: "Zeler"
    }
  },
  {
    code: "10",
    displayOrder: 10,
    translations: {
      hu: "Mustár",
      en: "Mustard",
      sk: "Horčica" 
    }
  },
  {
    code: "11",
    displayOrder: 11,
    translations: {
      hu: "Szezámmag",
      en: "Sesame seeds", 
      sk: "Sezamové semená"
    }
  },
  {
    code: "12", 
    displayOrder: 12,
    translations: {
      hu: "Kén-dioxid és szulfitok",
      en: "Sulphur dioxide and sulphites",
      sk: "Oxid siričitý a siričitany"
    }
  },
  {
    code: "13",
    displayOrder: 13,
    translations: {
      hu: "Csillagfürt",
      en: "Lupin",
      sk: "Vlčí bob"
    }
  },
  {
    code: "14",
    displayOrder: 14, 
    translations: {
      hu: "Puhatestűek",
      en: "Molluscs", 
      sk: "Mäkkýše"
    }
  }
];

async function seedAllergens() {
  console.log('🌱 Seeding allergens...');
  
  try {
    // Clear existing allergen data
    await prisma.allergenTranslation.deleteMany({});
    await prisma.allergen.deleteMany({});
    console.log('🗑️ Cleared existing allergen data');

    // Create allergens with translations
    for (const allergenData of allergens) {
      const { translations, ...allergenInfo } = allergenData;
      
      const allergen = await prisma.allergen.create({
        data: {
          ...allergenInfo,
          translations: {
            create: Object.entries(translations).map(([language, name]) => ({
              language,
              name
            }))
          }
        }
      });
      
      console.log(`✅ Created allergen ${allergen.code}: ${translations.hu}`);
    }

    console.log('🎉 Allergen seeding completed successfully!');
    console.log(`📊 Created ${allergens.length} allergens with translations`);
    
  } catch (error) {
    console.error('❌ Error seeding allergens:', error);
    throw error;
  }
}

seedAllergens()
  .catch((e) => {
    console.error('❌ Allergen seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });