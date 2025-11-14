require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { testConnection, syncDatabase } = require('./models');

// Import routes
const authRoutes = require('./routes/authRoutes');
const documentRoutes = require('./routes/documentRoutes');
const adminRoutes = require('./routes/adminRoutes');
const templateRoutes = require('./routes/templateRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const companyRoutes = require('./routes/companyRoutes');
const companyNotificationRoutes = require('./routes/companyNotificationRoutes');
const adminNotificationRoutes = require('./routes/adminNotificationRoutes');
const webhookRoutes = require('./routes/webhookRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS configuration - Allow all origins
app.use(cors({
  origin: '*',
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/notification', notificationRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/company-notifications', companyNotificationRoutes);
app.use('/api/admin-notifications', adminNotificationRoutes);

// Webhook Routes (no /api prefix for webhooks - external services need direct access)
app.use('/webhook', webhookRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Initialize server
const startServer = async () => {
  try {
    // Test database connection
    await testConnection();
    
    // Sync database models (create tables if they don't exist)
    await syncDatabase();
    
    // Start server
    app.listen(PORT, () => {
      console.log('='.repeat(60));
      console.log('✓ PDF Portal API Server - Express/Node.js');
      console.log(`✓ Server is running on port ${PORT}`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('='.repeat(60));
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
  process.exit(1);
});

// Start the server
startServer();

