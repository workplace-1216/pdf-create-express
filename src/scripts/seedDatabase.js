require('dotenv').config();
const { sequelize, User, TemplateRuleSet, testConnection } = require('../models');
const authService = require('../services/authService');

console.log('='.repeat(60));
console.log('🌱 PDF Portal - Database Seeding');
console.log('='.repeat(60));
console.log();

async function seedDatabase() {
  try {
    // Test database connection
    console.log('📡 Testing database connection...');
    await testConnection();
    
    // Sync database (create tables if they don't exist)
    console.log('📊 Synchronizing database schema...');
    await sequelize.sync({ alter: false });
    console.log('✅ Database schema synchronized');
    console.log();

    // Seed Admin User
    console.log('👤 Seeding Admin User...');
    const adminEmail = 'ddolmatovtech@gmail.com';
    const adminPassword = 'pon87654321';

    const existingAdmin = await User.findOne({ where: { email: adminEmail } });
    
    if (existingAdmin) {
      console.log(`⚠️  Admin user already exists: ${adminEmail}`);

      // Auto-verify existing admin if not verified
      if (!existingAdmin.isEmailVerified) {
        await existingAdmin.update({
          isEmailVerified: true,
          otpCode: null,
          otpExpiry: null,
          otpAttempts: 0
        });
        console.log('✅ Existing admin email auto-verified');
      }
    } else {
      const adminUser = await authService.registerUser(
        adminEmail,
        adminPassword,
        User.ROLES.ADMIN
      );

      if (adminUser) {
        // Auto-verify ONLY the initial seeded admin (for system setup)
        // All other admins created later will require email verification
        await adminUser.update({
          isEmailVerified: true,
          otpCode: null,
          otpExpiry: null,
          otpAttempts: 0
        });

        console.log('✅ Admin user created and auto-verified successfully!');
        console.log(`   Email: ${adminEmail}`);
        console.log(`   Password: ${adminPassword}`);
        console.log(`   Role: Admin`);
        console.log('   ⚠️  Note: This is the only auto-verified admin. New admins will require email verification.');
      } else {
        console.log('❌ Failed to create admin user');
      }
    }
    console.log();

    // Seed Default Template
    console.log('📋 Seeding Default Template...');
    
    const existingTemplate = await TemplateRuleSet.findOne({ 
      where: { name: 'Default PDF Processing Template' } 
    });

    if (existingTemplate) {
      console.log('⚠️  Default template already exists');
    } else {
      // Get admin user ID for template creation
      const admin = await User.findOne({ where: { role: User.ROLES.ADMIN } });
      
      if (!admin) {
        console.log('❌ Cannot create template: No admin user found');
      } else {
        const defaultTemplate = await TemplateRuleSet.create({
          name: 'Default PDF Processing Template',
          jsonDefinition: JSON.stringify({
            metadataRules: {
              RFC: '(?:RFC|R\\.F\\.C\\.?)[\\s:]*([A-Z0-9]{12,13})'
            },
            pageRules: {
              keepPages: [1, 2, 3],
              footerText: 'Processed: {{now}} | By: {{vendor.email}}'
            },
            coverPage: {
              enabled: false
            }
          }, null, 2),
          createdByUserId: admin.id,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        console.log('✅ Default template created successfully!');
        console.log(`   Template ID: ${defaultTemplate.id}`);
        console.log(`   Template Name: ${defaultTemplate.name}`);
      }
    }
    console.log();

    // Summary
    console.log('='.repeat(60));
    console.log('📊 SEEDING SUMMARY');
    console.log('='.repeat(60));
    
    const totalUsers = await User.count();
    const totalAdmins = await User.count({ where: { role: User.ROLES.ADMIN } });
    const totalClients = await User.count({ where: { role: User.ROLES.CLIENT } });
    const totalTemplates = await TemplateRuleSet.count({ where: { isActive: true } });

    console.log();
    console.log(`👥 Total Users: ${totalUsers}`);
    console.log(`   - Admins: ${totalAdmins}`);
    console.log(`   - Clients: ${totalClients}`);
    console.log();
    console.log(`📋 Total Templates: ${totalTemplates}`);
    console.log();
    
    console.log('✅ Database seeding completed successfully!');
    console.log();
    console.log('🚀 Default Login Credentials:');
    console.log('   Admin:');
    console.log(`     Email: ${adminEmail}`);
    console.log(`     Password: ${adminPassword}`);
    console.log();
    console.log('⚠️  IMPORTANT: Change these credentials in production!');
    console.log();
    
    process.exit(0);
  } catch (error) {
    console.error();
    console.error('❌ Database seeding failed:', error.message);
    console.error();
    console.error('Stack trace:', error.stack);
    console.error();
    process.exit(1);
  }
}

// Run seeding
seedDatabase();

