'use strict';

const Homey = require('homey');
const ProxmoxAPI = require('../../lib/proxmox-api');

module.exports = class ProxmoxDevice extends Homey.Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('ProxmoxDevice has been initialized');
    
    const data = this.getData();
    const settings = this.getSettings();
    
    this.log('Device type:', data.type);
    this.log('Device ID:', data.id);
    
    // Ensure onoff capability exists for controllable devices
    if (data.type === 'lxc' || data.type === 'vm' || data.type === 'node') {
      if (!this.hasCapability('onoff')) {
        await this.addCapability('onoff');
      }
    }
    
    // Register capability listeners ONLY for LXC and VM (nodes are read-only)
    // Nodes display status but cannot be controlled from Homey
    if (data.type === 'lxc' || data.type === 'vm') {
      this.registerCapabilityListener('onoff', this.onCapabilityOnoff.bind(this));
      this.log(`Registered onoff capability for ${data.type} - can be controlled`);
    } else if (data.type === 'node') {
      // Make the capability read-only for nodes
      this.setCapabilityOptions('onoff', {
        setable: false
      }).catch(this.error);
      this.log(`Node device - onoff is read-only (status display only)`);
    }
    
    // Set up polling for status updates
    this.pollInterval = setInterval(() => {
      this.updateStatus();
    }, 30000); // Poll every 30 seconds
    
    // Initial status update
    await this.updateStatus();
  }

  /**
   * Update device status
   */
  async updateStatus() {
    try {
      const data = this.getData();
      const settings = this.getSettings();
      
      if (data.type === 'node') {
        const status = await ProxmoxAPI.getNodeStatus(
          settings.host, settings.port, data.node, 
          settings.tokenID, settings.tokenSecret
        );
        //console.log('Node status:', status);
        const isOnline = status.uptime > 0;
        await this.setCapabilityValue('onoff', isOnline);
        this.log(`Node ${data.node} status: ${status.uptime} (${isOnline ? 'ON' : 'OFF'})`);
      } else if (data.type === 'lxc') {
        const status = await ProxmoxAPI.getLXCStatus(
          settings.host, settings.port, data.node, data.vmid,
          settings.tokenID, settings.tokenSecret
        );
        const isRunning = status.status === 'running';
        await this.setCapabilityValue('onoff', isRunning);
        this.log(`LXC ${data.vmid} status: ${status.status} (${isRunning ? 'ON' : 'OFF'})`);
      } else if (data.type === 'vm') {
        const status = await ProxmoxAPI.getVMStatus(
          settings.host, settings.port, data.node, data.vmid,
          settings.tokenID, settings.tokenSecret
        );
        const isRunning = status.status === 'running';
        await this.setCapabilityValue('onoff', isRunning);
        this.log(`VM ${data.vmid} status: ${status.status} (${isRunning ? 'ON' : 'OFF'})`);
      }
    } catch (error) {
      this.error('Failed to update status:', error.message);
    }
  }

  /**
   * Handle onoff capability changes
   */
  async onCapabilityOnoff(value) {
    const data = this.getData();
    const settings = this.getSettings();
    
    this.log(`${data.type} ${data.id}: Changing power state to ${value ? 'ON' : 'OFF'}`);
    
    try {
      if (data.type === 'lxc') {
        if (value) {
          this.log(`Starting LXC ${data.vmid} on node ${data.node}`);
          await ProxmoxAPI.startLXC(
            settings.host, settings.port, data.node, data.vmid,
            settings.tokenID, settings.tokenSecret
          );
          this.log(`LXC ${data.vmid} start command sent successfully`);
        } else {
          this.log(`Stopping LXC ${data.vmid} on node ${data.node}`);
          await ProxmoxAPI.stopLXC(
            settings.host, settings.port, data.node, data.vmid,
            settings.tokenID, settings.tokenSecret
          );
          this.log(`LXC ${data.vmid} stop command sent successfully`);
        }
      } else if (data.type === 'vm') {
        if (value) {
          this.log(`Starting VM ${data.vmid} on node ${data.node}`);
          await ProxmoxAPI.startVM(
            settings.host, settings.port, data.node, data.vmid,
            settings.tokenID, settings.tokenSecret
          );
          this.log(`VM ${data.vmid} start command sent successfully`);
        } else {
          this.log(`Stopping VM ${data.vmid} on node ${data.node}`);
          await ProxmoxAPI.stopVM(
            settings.host, settings.port, data.node, data.vmid,
            settings.tokenID, settings.tokenSecret
          );
          this.log(`VM ${data.vmid} stop command sent successfully`);
        }
      }
      
      // Update status after a short delay to reflect the change
      setTimeout(() => {
        this.log('Updating status after power state change');
        this.updateStatus();
      }, 3000);
      
      return true;
    } catch (error) {
      this.error('Failed to change power state:', error.message);
      throw new Error(`Failed to ${value ? 'start' : 'stop'} ${data.type}: ${error.message}`);
    }
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('ProxmoxDevice has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('ProxmoxDevice settings where changed');
    
    // Re-fetch status with new settings
    await this.updateStatus();
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name) {
    this.log('ProxmoxDevice was renamed to:', name);
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('ProxmoxDevice has been deleted');
    
    // Clear polling interval
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
  }

};
