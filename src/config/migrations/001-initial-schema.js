require('dotenv').config();
const { sequelize } = require('../database');

/**
 * Complete Database Migration
 * Creates all tables and relationships for the PDF Portal system
 * This is the ONLY migration file needed
 */

async function runMigration() {
  try {
    console.log('='.repeat(80));
    console.log('🚀 Starting Complete Database Migration');
    console.log('='.repeat(80));
    console.log();

    // Test connection
    console.log('📡 Testing database connection...');
    await sequelize.authenticate();
    console.log('✅ Database connection established');
    console.log();

    // ============================================
    // 1. Create users table
    // ============================================
    console.log('📋 Step 1: Creating users table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        rfc VARCHAR(13),
        password_hash VARCHAR(255) NOT NULL,
        role INTEGER NOT NULL DEFAULT 2 CHECK (role IN (1, 2, 3)),
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      COMMENT ON COLUMN users.role IS '1=Admin, 2=Client, 3=Company';
    `);
    console.log('✅ users table created/verified');
    console.log();

    // ============================================
    // 2. Create companies table
    // ============================================
    console.log('📋 Step 2: Creating companies table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        rfc VARCHAR(13) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        phone VARCHAR(20),
        password_hash VARCHAR(255),
        user_id INTEGER,
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        approved_at TIMESTAMP,
        approved_by_admin_id INTEGER,
        rejection_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (approved_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
      );
      
      COMMENT ON COLUMN companies.password_hash IS 'Temporary password hash until company is approved';
      COMMENT ON COLUMN companies.user_id IS 'User account for company login (created when approved)';
      COMMENT ON COLUMN companies.status IS 'pending, approved, rejected';
    `);
    console.log('✅ companies table created/verified');
    console.log();

    // ============================================
    // 3. Create client_companies junction table
    // ============================================
    console.log('📋 Step 3: Creating client_companies table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS client_companies (
        id SERIAL PRIMARY KEY,
        client_user_id INTEGER NOT NULL,
        company_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
      );
      
      CREATE UNIQUE INDEX IF NOT EXISTS unique_client_company 
        ON client_companies(client_user_id, company_id);
    `);
    console.log('✅ client_companies table created/verified');
    console.log();

    // ============================================
    // 4. Create template_rule_sets table
    // ============================================
    console.log('📋 Step 4: Creating template_rule_sets table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS template_rule_sets (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        json_definition TEXT NOT NULL,
        created_by_user_id INTEGER NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    console.log('✅ template_rule_sets table created/verified');
    console.log();

    // ============================================
    // 5. Create document_originals table
    // ============================================
    console.log('📋 Step 5: Creating document_originals table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS document_originals (
        id SERIAL PRIMARY KEY,
        uploader_user_id INTEGER NOT NULL,
        file_path VARCHAR(500),
        original_file_name VARCHAR(255) NOT NULL,
        file_size_bytes BIGINT NOT NULL DEFAULT 0,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        upload_batch_id VARCHAR(100),
        status INTEGER NOT NULL DEFAULT 1 CHECK (status IN (1, 2, 3, 4, 5)),
        FOREIGN KEY (uploader_user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    
    // Add missing columns if table already exists (for existing deployments)
    console.log('🔧 Checking for missing columns in document_originals...');
    await sequelize.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name='document_originals' AND column_name='file_path') THEN
          ALTER TABLE document_originals ADD COLUMN file_path VARCHAR(500);
          RAISE NOTICE 'Added file_path column';
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name='document_originals' AND column_name='upload_batch_id') THEN
          ALTER TABLE document_originals ADD COLUMN upload_batch_id VARCHAR(100);
          RAISE NOTICE 'Added upload_batch_id column';
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name='document_originals' AND column_name='status') THEN
          ALTER TABLE document_originals ADD COLUMN status INTEGER NOT NULL DEFAULT 1;
          RAISE NOTICE 'Added status column';
        END IF;
      END $$;
    `);
    
    console.log('✅ document_originals table created/verified');
    console.log();

    // ============================================
    // 6. Create document_processeds table
    // ============================================
    console.log('📋 Step 6: Creating document_processeds table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS document_processeds (
        id SERIAL PRIMARY KEY,
        source_document_id INTEGER NOT NULL,
        template_rule_set_id INTEGER,
        file_path_final_pdf VARCHAR(500) NOT NULL,
        extracted_json_data TEXT NOT NULL DEFAULT '{}',
        approved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status INTEGER NOT NULL DEFAULT 1 CHECK (status IN (1, 2, 3)),
        is_deleted_by_client BOOLEAN NOT NULL DEFAULT false,
        is_sent_to_admin BOOLEAN NOT NULL DEFAULT false,
        sent_to_admin_at TIMESTAMP,
        is_sent_to_company BOOLEAN NOT NULL DEFAULT false,
        sent_to_company_id INTEGER,
        sent_to_company_at TIMESTAMP,
        FOREIGN KEY (source_document_id) REFERENCES document_originals(id) ON DELETE CASCADE,
        FOREIGN KEY (template_rule_set_id) REFERENCES template_rule_sets(id) ON DELETE SET NULL,
        FOREIGN KEY (sent_to_company_id) REFERENCES companies(id) ON DELETE SET NULL
      );
      
      COMMENT ON COLUMN document_processeds.status IS '1=Pending, 2=Approved, 3=Rejected';
    `);
    
    // Add missing columns if table already exists (for existing deployments)
    console.log('🔧 Checking for missing columns in document_processeds...');
    await sequelize.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name='document_processeds' AND column_name='is_deleted_by_client') THEN
          ALTER TABLE document_processeds ADD COLUMN is_deleted_by_client BOOLEAN NOT NULL DEFAULT false;
          RAISE NOTICE 'Added is_deleted_by_client column';
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name='document_processeds' AND column_name='is_sent_to_admin') THEN
          ALTER TABLE document_processeds ADD COLUMN is_sent_to_admin BOOLEAN NOT NULL DEFAULT false;
          RAISE NOTICE 'Added is_sent_to_admin column';
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name='document_processeds' AND column_name='sent_to_admin_at') THEN
          ALTER TABLE document_processeds ADD COLUMN sent_to_admin_at TIMESTAMP;
          RAISE NOTICE 'Added sent_to_admin_at column';
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name='document_processeds' AND column_name='is_sent_to_company') THEN
          ALTER TABLE document_processeds ADD COLUMN is_sent_to_company BOOLEAN NOT NULL DEFAULT false;
          RAISE NOTICE 'Added is_sent_to_company column';
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name='document_processeds' AND column_name='sent_to_company_id') THEN
          ALTER TABLE document_processeds ADD COLUMN sent_to_company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;
          RAISE NOTICE 'Added sent_to_company_id column';
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name='document_processeds' AND column_name='sent_to_company_at') THEN
          ALTER TABLE document_processeds ADD COLUMN sent_to_company_at TIMESTAMP;
          RAISE NOTICE 'Added sent_to_company_at column';
        END IF;
      END $$;
    `);
    
    console.log('✅ document_processeds table created/verified');
    console.log();

    // ============================================
    // 7. Create document_history table
    // ============================================
    console.log('📋 Step 7: Creating document_history table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS document_history (
        id SERIAL PRIMARY KEY,
        action_type VARCHAR(50) NOT NULL,
        document_id INTEGER,
        user_id INTEGER NOT NULL,
        user_role VARCHAR(20) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_size_bytes BIGINT,
        batch_id VARCHAR(100),
        processing_time_ms INTEGER,
        error_message TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      
      COMMENT ON COLUMN document_history.action_type IS 'UPLOADED, PROCESSED, SENT_TO_ADMIN, DELETED_BY_ADMIN, UPLOAD_FAILED, PROCESSING_FAILED';
      COMMENT ON COLUMN document_history.user_role IS 'Client or Admin';
      COMMENT ON COLUMN document_history.document_id IS 'Nullable because document may be deleted';
      COMMENT ON COLUMN document_history.processing_time_ms IS 'Time taken to process document in milliseconds';
      COMMENT ON COLUMN document_history.metadata IS 'Additional data: RFC, folio, fecha, etc.';
      
      CREATE INDEX IF NOT EXISTS idx_document_history_action_type ON document_history(action_type);
      CREATE INDEX IF NOT EXISTS idx_document_history_user_id ON document_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_document_history_created_at ON document_history(created_at);
      CREATE INDEX IF NOT EXISTS idx_document_history_batch_id ON document_history(batch_id);
    `);
    console.log('✅ document_history table created/verified');
    console.log();

    // ============================================
    // 8. Create notifications table
    // ============================================
    console.log('📋 Step 8: Creating notifications table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        client_user_id INTEGER NOT NULL,
        admin_user_id INTEGER,
        document_count INTEGER NOT NULL,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_read BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      
      COMMENT ON COLUMN notifications.admin_user_id IS 'Which admin this notification is for';
    `);
    console.log('✅ notifications table created/verified');
    console.log();

    // ============================================
    // 9. Create admin_notifications table
    // ============================================
    console.log('📋 Step 9: Creating admin_notifications table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS admin_notifications (
        id SERIAL PRIMARY KEY,
        notification_type VARCHAR(50) NOT NULL,
        related_user_id INTEGER,
        related_company_id INTEGER,
        message TEXT NOT NULL,
        is_read BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (related_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (related_company_id) REFERENCES companies(id) ON DELETE SET NULL
      );
      
      COMMENT ON COLUMN admin_notifications.notification_type IS 'NEW_USER, NEW_COMPANY, DOCUMENT_SENT';
    `);
    console.log('✅ admin_notifications table created/verified');
    console.log();

    // ============================================
    // 10. Create company_notifications table
    // ============================================
    console.log('📋 Step 10: Creating company_notifications table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS company_notifications (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        client_user_id INTEGER NOT NULL,
        document_count INTEGER NOT NULL,
        sent_at TIMESTAMP NOT NULL,
        is_read BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
        FOREIGN KEY (client_user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    console.log('✅ company_notifications table created/verified');
    console.log();

    // ============================================
    // Final verification
    // ============================================
    console.log('🔍 Verifying all tables exist...');
    const [tables] = await sequelize.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    
    const tableNames = tables.map(t => t.table_name);
    const requiredTables = [
      'users',
      'companies',
      'client_companies',
      'template_rule_sets',
      'document_originals',
      'document_processeds',
      'document_history',
      'notifications',
      'admin_notifications',
      'company_notifications'
    ];

    console.log(`✅ Found ${tableNames.length} tables in database`);
    console.log(`   Tables: ${tableNames.join(', ')}`);
    console.log();
    
    const missingTables = requiredTables.filter(t => !tableNames.includes(t));
    if (missingTables.length > 0) {
      console.log(`⚠️  Missing tables: ${missingTables.join(', ')}`);
      throw new Error(`Missing required tables: ${missingTables.join(', ')}`);
    } else {
      console.log('✅ All 10 required tables exist');
    }

    console.log();
    console.log('='.repeat(80));
    console.log('🎉 Database Migration Completed Successfully!');
    console.log('='.repeat(80));
    console.log();
    
    return true;
  } catch (error) {
    console.error();
    console.error('='.repeat(80));
    console.error('❌ Migration Failed');
    console.error('='.repeat(80));
    console.error('Error:', error.message);
    console.error();
    console.error('Stack trace:');
    console.error(error.stack);
    console.error();
    throw error;
  }
}

// Export for use in other scripts
module.exports = { runMigration };

// Run if called directly
if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

