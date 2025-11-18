/**
 * TypeScript Type Definitions for WhatsApp 24-Hour Window Implementation
 *
 * Use these types in your TypeScript projects
 */

// =============================================================================
// Window Helper Types
// =============================================================================

/**
 * Result of checking remaining time in 24-hour window
 */
export interface RemainingWindowTime {
  hours: number;
  minutes: number;
  seconds: number;
  isExpired: boolean;
  formatted: string;
  expiresAt?: Date;
}

/**
 * Result of validating if a message can be sent
 */
export interface MessageValidationResult {
  canSend: boolean;
  reason: string;
  requiresTemplate: boolean;
  expiresAt?: Date;
}

/**
 * Window status information for a phone number
 */
export interface WindowStatus {
  phoneNumber: string;
  canSendFreeform: boolean;
  requiresTemplate: boolean;
  lastIncomingMessage: Date | null;
  windowStatus: string;
  timeRemaining: string;
  expiresAt: Date | null;
}

// =============================================================================
// Conversation Tracker Types
// =============================================================================

/**
 * Tracking mode for conversation tracker
 */
export type TrackingMode = 'memory' | 'database';

/**
 * Conversation information
 */
export interface ConversationInfo {
  phoneNumber: string;
  lastIncomingMessageAt: Date;
  lastMessageId: string;
  messageCount: number;
  isWithinWindow: boolean;
}

/**
 * Result of tracking an incoming message
 */
export interface TrackingResult {
  success: boolean;
  phoneNumber: string;
  lastMessageAt: Date;
  error?: string;
}

/**
 * Conversation statistics
 */
export interface ConversationStats {
  totalConversations: number;
  activeWindows: number;
  expiredWindows: number;
  trackingMode: TrackingMode;
}

// =============================================================================
// WhatsApp Service Types
// =============================================================================

/**
 * Parameters for sending document notification
 */
export interface DocumentNotificationParams {
  toWhatsApp: string;
  companyName: string;
  fromName: string;
  documentCount: number;
  forceTemplate?: boolean;
  skipWindowCheck?: boolean;
}

/**
 * Parameters for sending template message
 */
export interface TemplateMessageParams {
  toWhatsApp: string;
  templateName: string;
  languageCode?: string;
  components?: TemplateComponent[];
}

/**
 * Template component structure
 */
export interface TemplateComponent {
  type: 'header' | 'body' | 'button';
  parameters: TemplateParameter[];
}

/**
 * Template parameter
 */
export interface TemplateParameter {
  type: 'text' | 'currency' | 'date_time' | 'image' | 'document' | 'video';
  text?: string;
  currency?: {
    fallback_value: string;
    code: string;
    amount_1000: number;
  };
  date_time?: {
    fallback_value: string;
  };
  image?: {
    link: string;
  };
  document?: {
    link: string;
    filename?: string;
  };
  video?: {
    link: string;
  };
}

/**
 * WhatsApp send result
 */
export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  recipientNumber?: string;
  error?: string;
  requiresTemplate?: boolean;
  suggestion?: string;
  message?: string;
}

// =============================================================================
// Webhook Types
// =============================================================================

/**
 * WhatsApp webhook message object
 */
export interface WhatsAppWebhookMessage {
  id: string;
  from: string;
  timestamp: string;
  type: 'text' | 'image' | 'document' | 'audio' | 'video' | 'location' | 'contacts';
  text?: {
    body: string;
  };
  image?: {
    id: string;
    mime_type: string;
    sha256: string;
  };
  document?: {
    id: string;
    filename: string;
    mime_type: string;
    sha256: string;
  };
}

/**
 * WhatsApp webhook status object
 */
export interface WhatsAppWebhookStatus {
  id: string;
  recipient_id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  errors?: Array<{
    code: number;
    title: string;
    message: string;
  }>;
}

/**
 * WhatsApp webhook payload
 */
export interface WhatsAppWebhookPayload {
  object: 'whatsapp_business_account';
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: 'whatsapp';
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: Array<{
          profile: {
            name: string;
          };
          wa_id: string;
        }>;
        messages?: WhatsAppWebhookMessage[];
        statuses?: WhatsAppWebhookStatus[];
      };
      field: 'messages';
    }>;
  }>;
}

// =============================================================================
// Function Signatures
// =============================================================================

/**
 * Check if a timestamp is within 24 hours
 */
export function isWithin24Hours(lastMessageAt: Date | null): boolean;

/**
 * Get remaining time in the 24-hour window
 */
export function getRemainingWindowTime(lastMessageAt: Date | null): RemainingWindowTime;

/**
 * Get expiration time for a 24-hour window
 */
export function getWindowExpirationTime(lastMessageAt: Date | null): Date | null;

/**
 * Check if template is required
 */
export function requiresTemplate(lastMessageAt: Date | null): boolean;

/**
 * Clean phone number to standard format
 */
export function cleanPhoneNumber(phoneNumber: string): string;

/**
 * Validate if a message can be sent
 */
export function canSendMessage(
  lastMessageAt: Date | null,
  isTemplate?: boolean
): MessageValidationResult;

// =============================================================================
// Service Interfaces
// =============================================================================

/**
 * WhatsApp Conversation Tracker Service
 */
export interface IWhatsAppConversationTracker {
  /**
   * Set tracking mode
   */
  setTrackingMode(mode: TrackingMode): void;

  /**
   * Track an incoming message
   */
  trackIncomingMessage(
    phoneNumber: string,
    messageId: string,
    timestamp?: Date
  ): Promise<TrackingResult>;

  /**
   * Get last message timestamp for a user
   */
  getLastMessageTimestamp(phoneNumber: string): Promise<Date | null>;

  /**
   * Check if user is within 24-hour window
   */
  isWithinWindow(phoneNumber: string): Promise<boolean>;

  /**
   * Get conversation info for a user
   */
  getConversationInfo(phoneNumber: string): Promise<ConversationInfo | null>;

  /**
   * Clear all conversation data
   */
  clearAll(): Promise<void>;

  /**
   * Get conversation statistics
   */
  getStats(): Promise<ConversationStats>;
}

/**
 * WhatsApp Service
 */
export interface IWhatsAppService {
  /**
   * Send document notification
   */
  sendDocumentNotification(
    params: DocumentNotificationParams
  ): Promise<WhatsAppSendResult>;

  /**
   * Send template message
   */
  sendTemplateMessage(params: TemplateMessageParams): Promise<WhatsAppSendResult>;

  /**
   * Test WhatsApp connection
   */
  testConnection(): Promise<boolean>;

  /**
   * Check messaging window for a phone number
   */
  checkMessagingWindow(phoneNumber: string): Promise<WindowStatus>;

  /**
   * Get conversation info
   */
  getConversationInfo(phoneNumber: string): Promise<ConversationInfo | null>;

  /**
   * Get conversation statistics
   */
  getConversationStats(): Promise<ConversationStats>;
}

// =============================================================================
// Usage Examples (for IDE autocomplete)
// =============================================================================

/**
 * Example usage in TypeScript
 *
 * ```typescript
 * import { isWithin24Hours, canSendMessage } from './utils/whatsappWindowHelper';
 * import whatsappService from './services/whatsappService';
 *
 * // Check if timestamp is within 24 hours
 * const lastMessage = new Date('2025-01-18T10:00:00Z');
 * const isValid: boolean = isWithin24Hours(lastMessage);
 *
 * // Send document notification
 * const result: WhatsAppSendResult = await whatsappService.sendDocumentNotification({
 *   toWhatsApp: '+52 55 1234 5678',
 *   companyName: 'Acme Corp',
 *   fromName: 'John Doe',
 *   documentCount: 3
 * });
 *
 * if (result.success) {
 *   console.log('Message sent!', result.messageId);
 * } else if (result.requiresTemplate) {
 *   console.log('Use template message instead');
 * }
 *
 * // Check window status
 * const status: WindowStatus = await whatsappService.checkMessagingWindow('+52 55 1234 5678');
 * console.log('Can send:', status.canSendFreeform);
 * console.log('Time left:', status.timeRemaining);
 * ```
 */
