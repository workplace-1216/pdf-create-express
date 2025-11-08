const { TemplateRuleSet } = require('../models');
const pdfProcessingService = require('../services/pdfProcessingService');
const { getCurrentUserId } = require('../utils/helpers');

class TemplateController {
  async getTemplates(req, res) {
    try {
      const templates = await TemplateRuleSet.findAll({
        where: { isActive: true },
        order: [['createdAt', 'DESC']]
      });

      const templateDtos = templates.map(t => ({
        id: t.id,
        name: t.name,
        jsonDefinition: t.jsonDefinition,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        isActive: t.isActive
      }));

      return res.status(200).json(templateDtos);
    } catch (error) {
      console.error('Get templates error:', error);
      return res.status(500).json({ message: `Error retrieving templates: ${error.message}` });
    }
  }

  async getTemplate(req, res) {
    try {
      const id = parseInt(req.params.id);
      const template = await TemplateRuleSet.findByPk(id);

      if (!template) {
        return res.status(404).json({ message: 'Template not found' });
      }

      return res.status(200).json({
        id: template.id,
        name: template.name,
        jsonDefinition: template.jsonDefinition,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
        isActive: template.isActive
      });
    } catch (error) {
      console.error('Get template error:', error);
      return res.status(500).json({ message: `Error retrieving template: ${error.message}` });
    }
  }

  async createTemplate(req, res) {
    try {
      const { name, jsonDefinition } = req.body;

      if (!name || !jsonDefinition) {
        return res.status(400).json({ message: 'Name and jsonDefinition are required' });
      }

      const userId = getCurrentUserId(req);

      const template = await TemplateRuleSet.create({
        name,
        jsonDefinition,
        createdByUserId: userId,
        isActive: true
      });

      return res.status(201).json({
        id: template.id,
        name: template.name,
        jsonDefinition: template.jsonDefinition,
        createdAt: template.createdAt,
        isActive: template.isActive
      });
    } catch (error) {
      console.error('Create template error:', error);
      return res.status(500).json({ message: `Error creating template: ${error.message}` });
    }
  }

  async updateTemplate(req, res) {
    try {
      const id = parseInt(req.params.id);
      const { name, jsonDefinition, isActive } = req.body;

      const template = await TemplateRuleSet.findByPk(id);

      if (!template) {
        return res.status(404).json({ message: 'Template not found' });
      }

      if (jsonDefinition) {
        template.jsonDefinition = jsonDefinition;
      }

      if (name) template.name = name;
      if (typeof isActive !== 'undefined') template.isActive = isActive;

      await template.save();

      return res.status(200).json({
        id: template.id,
        name: template.name,
        jsonDefinition: template.jsonDefinition,
        updatedAt: template.updatedAt,
        isActive: template.isActive
      });
    } catch (error) {
      console.error('Update template error:', error);
      return res.status(500).json({ message: `Error updating template: ${error.message}` });
    }
  }

  async deleteTemplate(req, res) {
    try {
      const id = parseInt(req.params.id);
      const template = await TemplateRuleSet.findByPk(id);

      if (!template) {
        return res.status(404).json({ message: 'Template not found' });
      }

      // Soft delete - just mark as inactive
      template.isActive = false;
      await template.save();

      return res.status(204).send();
    } catch (error) {
      console.error('Delete template error:', error);
      return res.status(500).json({ message: `Error deleting template: ${error.message}` });
    }
  }
}

module.exports = new TemplateController();

