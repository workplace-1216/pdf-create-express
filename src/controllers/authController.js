const authService = require('../services/authService');
const { User, AdminNotification } = require('../models');
const { getCurrentUserId } = require('../utils/helpers');

class AuthController {
  async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required' });
      }

      const result = await authService.login(email, password);
      
      return res.status(200).json({
        token: result.token,
        role: result.role
      });
    } catch (error) {
      if (error.message === 'Invalid email or password') {
        return res.status(401).json({ message: error.message });
      }
      if (error.message.includes('inactive')) {
        return res.status(403).json({ message: 'Su cuenta está inactiva. Contacte al administrador.' });
      }
      if (error.isPending) {
        return res.status(403).json({ 
          message: error.message,
          isPending: true,
          companyName: error.companyName
        });
      }
      if (error.message.includes('rejected')) {
        return res.status(403).json({ message: error.message });
      }
      console.error('Login error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  async register(req, res) {
    try {
      const { email, tempPassword, rfc, whatsappNumber } = req.body;

      if (!email || !tempPassword) {
        return res.status(400).json({ message: 'Email and password are required' });
      }

      // Validate RFC if provided
      if (rfc) {
        const rfcPattern = /^[A-Z]{4}[0-9]{6}[A-Z0-9]{3}$/;
        if (!rfcPattern.test(rfc)) {
          return res.status(400).json({
            message: 'RFC inválido. Formato: 4 letras, 6 números, 3 alfanuméricos (Ej: AAAA123456ABC)'
          });
        }
      }

      // Create Client users by default
      const user = await authService.registerUser(email, tempPassword, User.ROLES.CLIENT, rfc, whatsappNumber);
      
      if (!user) {
        return res.status(400).json({ message: 'Email already exists' });
      }

      // Create admin notification for new client registration
      await AdminNotification.create({
        notificationType: AdminNotification.TYPES.NEW_USER,
        relatedUserId: user.id,
        message: `Nuevo cliente registrado: ${user.email}`,
        isRead: false,
        createdAt: new Date()
      });

      return res.status(200).json({
        userId: user.id,
        email: user.email,
        role: User.getRoleName(user.role),
        createdAt: user.createdAt
      });
    } catch (error) {
      console.error('Register error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  async getCurrentUser(req, res) {
    try {
      const userId = getCurrentUserId(req);
      const user = await authService.getUserById(userId);

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      return res.status(200).json({
        id: user.id,
        email: user.email,
        role: User.getRoleName(user.role),
        createdAt: user.createdAt
      });
    } catch (error) {
      console.error('Get current user error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }
}

module.exports = new AuthController();

