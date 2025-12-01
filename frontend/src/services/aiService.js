import api from './api';
import { auth } from '../config/firebase';

class AIService {
  constructor() {
    this.baseUrl = '/api/ai';
  }

  async getAuthHeaders() {
    const user = auth.currentUser;
    if (!user) throw new Error('User not authenticated');
    
    const token = await user.getIdToken();
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Get available AI models
   */
  async getAvailableModels() {
    try {
      const headers = await this.getAuthHeaders();
      const response = await api.get(`${this.baseUrl}/models`, { headers });
      return response.data;
    } catch (error) {
      console.error('Error fetching available models:', error);
      throw error;
    }
  }

  /**
   * Set default AI model for all clients (Super Admin only)
   */
  async setDefaultModel(modelId) {
    try {
      const headers = await this.getAuthHeaders();
      const response = await api.post(
        `${this.baseUrl}/models/default`,
        { modelId },
        { headers }
      );
      return response.data;
    } catch (error) {
      console.error('Error setting default model:', error);
      throw error;
    }
  }

  /**
   * Enhance text with AI
   */
  async enhanceText(data) {
    try {
      const response = await api.post(`${this.baseUrl}/enhance-text`, data);
      return response.data;
    } catch (error) {
      console.error('Error enhancing text:', error);
      throw error;
    }
  }

  /**
   * Enhance review with specific model
   */
  async enhanceReview(reviewId, data) {
    try {
      const headers = await this.getAuthHeaders();
      const response = await api.post(
        `${this.baseUrl}/enhance-review/${reviewId}`,
        data,
        { headers }
      );
      return response.data;
    } catch (error) {
      console.error('Error enhancing review:', error);
      throw error;
    }
  }

  /**
   * Get AI health status
   */
  async getHealthStatus() {
    try {
      const response = await api.get(`${this.baseUrl}/health`);
      return response.data;
    } catch (error) {
      console.error('Error getting AI health status:', error);
      throw error;
    }
  }
}

export default new AIService();