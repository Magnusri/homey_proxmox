'use strict';

const Homey = require('homey');
const ProxmoxAPI = require('../../lib/proxmox-api');

module.exports = class ProxmoxDevice extends Homey.Device {

  /**
   * Helper function to round a number to 1 decimal place
   */
  roundToOneDecimal(value) {
    return Math.round(value * 10) / 10;
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('ProxmoxDevice has been initialized');

    const data = this.getData();

    this.log('Device type:', data.type);
    this.log('Device ID:', data.id);

    // Ensure capabilities exist for devices
    const requiredCapabilities = ['onoff', 'measure_cpu', 'measure_memory', 'measure_disk', 'sensor_uptime'];
    if (data.type === 'lxc' || data.type === 'vm' || data.type === 'node') {
      for (const capability of requiredCapabilities) {
        if (!this.hasCapability(capability)) {
          await this.addCapability(capability);
        }
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
        setable: false,
      }).catch(this.error);
      this.log('Node device - onoff is read-only (status display only)');
    }

    // Set up polling for status updates
    this.pollInterval = setInterval(() => {
      this.updateStatus().catch(this.error);
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
          settings.tokenID, settings.tokenSecret,
        );
        // console.log('Node status:', status);
        const isOnline = status.uptime > 0;
        await this.setCapabilityValue('onoff', isOnline);

        // Update resource metrics
        if (isOnline) {
          // CPU usage (cpu is a decimal like 0.14 for 14%)
          if (status.cpu !== undefined) {
            await this.setCapabilityValue('measure_cpu', this.roundToOneDecimal(status.cpu * 100));
          }

          // Memory usage percentage
          if (status.memory !== undefined && status.maxmem !== undefined && status.maxmem > 0) {
            const memPercent = (status.memory / status.maxmem) * 100;
            await this.setCapabilityValue('measure_memory', this.roundToOneDecimal(memPercent));
          }

          // Disk usage percentage (rootfs for nodes)
          if (status.rootfs !== undefined) {
            const diskUsed = status.rootfs.used || 0;
            const diskTotal = status.rootfs.total || 1;
            const diskPercent = (diskUsed / diskTotal) * 100;
            await this.setCapabilityValue('measure_disk', this.roundToOneDecimal(diskPercent));
          }

          // Uptime in hours
          if (status.uptime !== undefined) {
            const uptimeHours = status.uptime / 3600;
            await this.setCapabilityValue('sensor_uptime', this.roundToOneDecimal(uptimeHours));
          }
        }

        this.log(`Node ${data.node} status: ${status.uptime} (${isOnline ? 'ON' : 'OFF'})`);
      } else if (data.type === 'lxc') {
        const status = await ProxmoxAPI.getLXCStatus(
          settings.host, settings.port, data.node, data.vmid,
          settings.tokenID, settings.tokenSecret,
        );
        const isRunning = status.status === 'running';
        await this.setCapabilityValue('onoff', isRunning);

        // Update resource metrics if running
        if (isRunning) {
          // CPU usage (cpu is a decimal)
          if (status.cpu !== undefined) {
            await this.setCapabilityValue('measure_cpu', this.roundToOneDecimal(status.cpu * 100));
          }

          // Memory usage percentage
          if (status.mem !== undefined && status.maxmem !== undefined && status.maxmem > 0) {
            const memPercent = (status.mem / status.maxmem) * 100;
            await this.setCapabilityValue('measure_memory', this.roundToOneDecimal(memPercent));
          }

          // Disk usage percentage
          if (status.disk !== undefined && status.maxdisk !== undefined && status.maxdisk > 0) {
            const diskPercent = (status.disk / status.maxdisk) * 100;
            await this.setCapabilityValue('measure_disk', this.roundToOneDecimal(diskPercent));
          }

          // Uptime in hours
          if (status.uptime !== undefined) {
            const uptimeHours = status.uptime / 3600;
            await this.setCapabilityValue('sensor_uptime', this.roundToOneDecimal(uptimeHours));
          }
        } else {
          // When stopped, set metrics to 0
          await this.setCapabilityValue('measure_cpu', 0);
          await this.setCapabilityValue('measure_memory', 0);
          await this.setCapabilityValue('measure_disk', 0);
          await this.setCapabilityValue('sensor_uptime', 0);
        }

        this.log(`LXC ${data.vmid} status: ${status.status} (${isRunning ? 'ON' : 'OFF'})`);
      } else if (data.type === 'vm') {
        const status = await ProxmoxAPI.getVMStatus(
          settings.host, settings.port, data.node, data.vmid,
          settings.tokenID, settings.tokenSecret,
        );
        const isRunning = status.status === 'running';
        await this.setCapabilityValue('onoff', isRunning);

        // Update resource metrics if running
        if (isRunning) {
          // CPU usage (cpu is a decimal)
          if (status.cpu !== undefined) {
            await this.setCapabilityValue('measure_cpu', this.roundToOneDecimal(status.cpu * 100));
          }

          // Memory usage percentage
          if (status.mem !== undefined && status.maxmem !== undefined && status.maxmem > 0) {
            const memPercent = (status.mem / status.maxmem) * 100;
            await this.setCapabilityValue('measure_memory', this.roundToOneDecimal(memPercent));
          }

          // Disk usage percentage
          if (status.disk !== undefined && status.maxdisk !== undefined && status.maxdisk > 0) {
            const diskPercent = (status.disk / status.maxdisk) * 100;
            await this.setCapabilityValue('measure_disk', this.roundToOneDecimal(diskPercent));
          }

          // Uptime in hours
          if (status.uptime !== undefined) {
            const uptimeHours = status.uptime / 3600;
            await this.setCapabilityValue('sensor_uptime', this.roundToOneDecimal(uptimeHours));
          }
        } else {
          // When stopped, set metrics to 0
          await this.setCapabilityValue('measure_cpu', 0);
          await this.setCapabilityValue('measure_memory', 0);
          await this.setCapabilityValue('measure_disk', 0);
          await this.setCapabilityValue('sensor_uptime', 0);
        }

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
            settings.tokenID, settings.tokenSecret,
          );
          this.log(`LXC ${data.vmid} start command sent successfully`);
        } else {
          this.log(`Stopping LXC ${data.vmid} on node ${data.node}`);
          await ProxmoxAPI.stopLXC(
            settings.host, settings.port, data.node, data.vmid,
            settings.tokenID, settings.tokenSecret,
          );
          this.log(`LXC ${data.vmid} stop command sent successfully`);
        }
      } else if (data.type === 'vm') {
        if (value) {
          this.log(`Starting VM ${data.vmid} on node ${data.node}`);
          await ProxmoxAPI.startVM(
            settings.host, settings.port, data.node, data.vmid,
            settings.tokenID, settings.tokenSecret,
          );
          this.log(`VM ${data.vmid} start command sent successfully`);
        } else {
          this.log(`Stopping VM ${data.vmid} on node ${data.node}`);
          await ProxmoxAPI.stopVM(
            settings.host, settings.port, data.node, data.vmid,
            settings.tokenID, settings.tokenSecret,
          );
          this.log(`VM ${data.vmid} stop command sent successfully`);
        }
      }

      // Update status after a short delay to reflect the change
      setTimeout(() => {
        this.log('Updating status after power state change');
        this.updateStatus().catch(this.error);
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
