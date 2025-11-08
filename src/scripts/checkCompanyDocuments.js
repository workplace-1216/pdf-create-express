require('dotenv').config();
const { sequelize } = require('../config/database');
const { User, Company, DocumentProcessed, DocumentOriginal } = require('../models');

/**
 * Diagnostic script to check why a company is not seeing documents
 * Usage: node src/scripts/checkCompanyDocuments.js company@email.com
 */

async function checkCompanyDocuments() {
  try {
    const companyEmail = process.argv[2];
    
    if (!companyEmail) {
      console.log('❌ Please provide company email');
      console.log('Usage: node src/scripts/checkCompanyDocuments.js company@email.com');
      process.exit(1);
    }

    console.log('🔍 Checking documents for company:', companyEmail);
    console.log('='.repeat(60));
    
    await sequelize.authenticate();
    console.log('✓ Database connected\n');

    // Get company
    const company = await Company.findOne({ 
      where: { email: companyEmail },
      include: [{ model: User, as: 'user' }]
    });
    
    if (!company) {
      console.log('❌ Company not found');
      process.exit(1);
    }

    console.log('Company Information:');
    console.log(`  ID: ${company.id}`);
    console.log(`  Name: ${company.name}`);
    console.log(`  RFC: ${company.rfc}`);
    console.log(`  Status: ${company.status}`);
    console.log(`  User ID: ${company.userId || 'NULL'}`);
    console.log(`  User Email: ${company.user?.email || 'No user account'}`);
    console.log(`  User Role: ${company.user?.role || 'N/A'}\n`);

    if (company.status !== 'approved') {
      console.log('⚠️  Company is not approved. Documents can only be sent to approved companies.\n');
    }

    if (!company.userId) {
      console.log('⚠️  Company has no user account. User cannot log in.\n');
    }

    // Check documents sent to this company
    console.log('📋 Checking documents sent to this company...\n');

    const sentDocuments = await DocumentProcessed.findAll({
      where: {
        isSentToCompany: true,
        sentToCompanyId: company.id
      },
      include: [{
        model: DocumentOriginal,
        as: 'sourceDocument',
        include: [{ model: User, as: 'uploader' }]
      }],
      order: [['sentToCompanyAt', 'DESC']]
    });

    console.log(`✅ Found ${sentDocuments.length} documents sent to this company\n`);

    if (sentDocuments.length > 0) {
      console.log('Documents:');
      sentDocuments.forEach((doc, index) => {
        console.log(`\n  ${index + 1}. Document ID: ${doc.id}`);
        console.log(`     File: ${doc.sourceDocument?.originalFileName || 'unknown'}`);
        console.log(`     Client: ${doc.sourceDocument?.uploader?.email || 'unknown'}`);
        console.log(`     Sent At: ${doc.sentToCompanyAt}`);
        console.log(`     Storage Path: ${doc.filePathFinalPdf}`);
      });
      console.log('');
    } else {
      console.log('ℹ️  No documents have been sent to this company yet.\n');
    }

    // Check all documents marked as sent to any company
    console.log('🔍 Checking ALL documents marked as sent to any company...\n');

    const allSentToCompany = await DocumentProcessed.findAll({
      where: { isSentToCompany: true },
      attributes: ['id', 'sentToCompanyId', 'sentToCompanyAt'],
      include: [{
        model: DocumentOriginal,
        as: 'sourceDocument',
        attributes: ['originalFileName']
      }]
    });

    console.log(`Total documents sent to any company: ${allSentToCompany.length}\n`);

    if (allSentToCompany.length > 0) {
      console.log('Documents sent to companies:');
      allSentToCompany.forEach(doc => {
        const isThisCompany = doc.sentToCompanyId === company.id;
        console.log(`  ${isThisCompany ? '✅' : '  '} Doc ${doc.id}: sentToCompanyId=${doc.sentToCompanyId}${isThisCompany ? ' (THIS COMPANY)' : ''}, file=${doc.sourceDocument?.originalFileName || 'unknown'}`);
      });
      console.log('');
    }

    // Check company notifications
    console.log('🔔 Checking notifications...\n');

    const notifications = await sequelize.query(`
      SELECT id, company_id, client_user_id, document_count, sent_at, is_read
      FROM company_notifications
      WHERE company_id = :companyId
      ORDER BY created_at DESC
      LIMIT 5;
    `, {
      replacements: { companyId: company.id },
      type: sequelize.QueryTypes.SELECT
    });

    console.log(`Notifications for this company: ${notifications.length}\n`);

    if (notifications.length > 0) {
      notifications.forEach((notif, index) => {
        console.log(`  ${index + 1}. Notification ID: ${notif.id}`);
        console.log(`     Document Count: ${notif.document_count}`);
        console.log(`     Sent At: ${notif.sent_at}`);
        console.log(`     Is Read: ${notif.is_read}`);
      });
      console.log('');
    }

    // Summary
    console.log('='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`Company: ${company.name} (ID: ${company.id})`);
    console.log(`Status: ${company.status}`);
    console.log(`Has User Account: ${company.userId ? 'Yes' : 'No'}`);
    console.log(`Documents Received: ${sentDocuments.length}`);
    console.log(`Notifications: ${notifications.length}`);
    console.log('='.repeat(60));

    if (sentDocuments.length === 0) {
      console.log('\n❓ Why no documents?');
      console.log('\nPossible reasons:');
      console.log('  1. No client has sent documents to this company yet');
      console.log('  2. Documents were sent but not properly marked in database');
      console.log('  3. sentToCompanyId mismatch (check other company IDs above)');
      console.log('\n📋 To test:');
      console.log('  1. Login as a client');
      console.log('  2. Upload and process some PDFs');
      console.log('  3. Select PDFs and click "Enviar"');
      console.log(`  4. Select this company: ${company.name}`);
      console.log('  5. Click send');
      console.log('  6. Check backend logs for:');
      console.log(`     [SendByEmail] Sending to company: true, Selected company ID: ${company.id}`);
      console.log('     [DocumentController] 📝 Update result: X rows affected');
      console.log('  7. Run this script again to verify\n');
    } else {
      console.log('\n✅ Documents are in the database!');
      console.log('\nIf company page shows empty:');
      console.log('  1. Check company is logged in (not client)');
      console.log('  2. Check backend logs when loading /company page');
      console.log('  3. Verify JWT token has role: "Company"');
      console.log('  4. Check browser console for errors');
      console.log('  5. Try logout and login again\n');
    }

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

checkCompanyDocuments();

