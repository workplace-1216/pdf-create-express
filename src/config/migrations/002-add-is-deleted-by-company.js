const { DataTypes } = require('sequelize');

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add isDeletedByCompany column to document_processeds table
    await queryInterface.addColumn('document_processeds', 'is_deleted_by_company', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });

    console.log('✅ Added is_deleted_by_company column to document_processeds table');
  },

  async down(queryInterface, Sequelize) {
    // Remove isDeletedByCompany column from document_processeds table
    await queryInterface.removeColumn('document_processeds', 'is_deleted_by_company');

    console.log('✅ Removed is_deleted_by_company column from document_processeds table');
  }
};
