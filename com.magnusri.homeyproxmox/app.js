'use strict';

const Homey = require('homey');

module.exports = class MyApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('MyApp has been initialized');
  }

  /**
   * Get stored Proxmox credentials from app settings
   * @returns {Object|null} Credentials object with host, port, tokenID, tokenSecret or null if not set
   */
  getCredentials() {
    try {
      const credentials = this.homey.settings.get('proxmox_credentials');
      if (credentials && credentials.host && credentials.tokenID && credentials.tokenSecret) {
        return credentials;
      }
      return null;
    } catch (error) {
      this.error('Error getting credentials:', error);
      return null;
    }
  }

  /**
   * Store Proxmox credentials in app settings
   * @param {Object} credentials - Credentials object with host, port, tokenID, tokenSecret
   * @returns {boolean} True if successful, false otherwise
   */
  setCredentials(credentials) {
    try {
      if (!credentials || !credentials.host || !credentials.tokenID || !credentials.tokenSecret) {
        this.error('Invalid credentials provided');
        return false;
      }

      // Ensure port has a default value
      const credentialsToStore = {
        host: credentials.host,
        port: credentials.port || '8006',
        tokenID: credentials.tokenID,
        tokenSecret: credentials.tokenSecret,
      };

      this.homey.settings.set('proxmox_credentials', credentialsToStore);
      this.log('Credentials stored successfully');
      return true;
    } catch (error) {
      this.error('Error storing credentials:', error);
      return false;
    }
  }

};
