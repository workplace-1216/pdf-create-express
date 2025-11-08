const { sequelize } = require('../config/database');

async function removeGptColumns() {
  try {
    console.log('🔄 Starting migration to remove GPT columns...\n');

    // Drop gpt_title column
    console.log('📝 Dropping gpt_title column...');
    await sequelize.query(`
      ALTER TABLE document_processeds
      DROP COLUMN IF EXISTS gpt_title;
    `);
    console.log('✅ gpt_title column dropped\n');

    // Drop gpt_summary column
    console.log('📝 Dropping gpt_summary column...');
    await sequelize.query(`
      ALTER TABLE document_processeds
      DROP COLUMN IF EXISTS gpt_summary;
    `);
    console.log('✅ gpt_summary column dropped\n');

    // Drop gpt_contact_information column
    console.log('📝 Dropping gpt_contact_information column...');
    await sequelize.query(`
      ALTER TABLE document_processeds
      DROP COLUMN IF EXISTS gpt_contact_information;
    `);
    console.log('✅ gpt_contact_information column dropped\n');

    console.log('🎉 Migration completed successfully!');
    console.log('✅ All GPT columns have been removed from document_processeds table.');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// Run the migration
if (require.main === module) {
  removeGptColumns()
    .then(() => {
      console.log('\n✨ Migration script finished.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = removeGptColumns;
