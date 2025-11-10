const { Sequelize } = require('sequelize');

// Use environment variable for DATABASE_URL
// Railway will provide this automatically when PostgreSQL is linked
const DATABASE_URL = 'postgresql://postgres:QlpNvsLeiCtWutsBcpxdltoYitwrzTUc@postgres.railway.internal:5432/railway';
// const DATABASE_URL = 'postgresql://postgres:123@localhost:5432/pdfportal'

// const sequelize = new Sequelize(DATABASE_URL, {
//   dialect: 'postgres',
//   logging: false,
//   dialectOptions: {
//     ssl: false // Railway internal network doesn't need SSL
//   },
//   pool: {
//     max: 5,
//     min: 0,
//     acquire: 30000,
//     idle: 10000
//   }
// });
const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: {
    ssl: false // Railway internal network doesn't need SSL
  },
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

// Test connection
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('✓ Database connection has been established successfully.');
  } catch (error) {
    console.error('✗ Unable to connect to the database:', error);
  }
};

module.exports = { sequelize, testConnection };

