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
   * Helper function to round a number to 2 decimal places
   */
  roundToTwoDecimals(value) {
    return Math.round(value * 100) / 100;
  }

  /**
   * Helper function to calculate rate from cumulative counters
   */
  calculateRate(currentValue, previousValue, intervalSeconds) {
    if (previousValue === undefined || previousValue === null) {
      return 0;
    }
    const delta = currentValue - previousValue;
    if (delta < 0) {
      // Counter reset (e.g., VM restarted), return 0
      return 0;
    }
    // Convert bytes to MB/s
    const bytesPerSecond = delta / intervalSeconds;
    const mbPerSecond = bytesPerSecond / (1024 * 1024);
    return this.roundToTwoDecimals(mbPerSecond);
  }

  /**
   * Check and update alarm states based on thresholds
   */
  async updateAlarms(cpuPercent, memPercent, isOnline) {
    // alarm_heat: Trigger when CPU or memory exceeds 90%
    const isOverheating = (cpuPercent > 90 || memPercent > 90);
    if (this.hasCapability('alarm_heat')) {
      await this.setCapabilityValue('alarm_heat', isOverheating);
    }

    // alarm_connectivity: Trigger when device is offline/unreachable
    if (this.hasCapability('alarm_connectivity')) {
      await this.setCapabilityValue('alarm_connectivity', !isOnline);
    }
  }

  /**
   * Update I/O metrics (network and disk) from status data
   */
  async updateIOMetrics(status) {
    const currentTime = Date.now();
    const intervalSeconds = (currentTime - this.previousCounters.timestamp) / 1000;

    if (intervalSeconds > 0) {
      // Network I/O rates
      if (status.netin !== undefined) {
        const netInRate = this.calculateRate(status.netin, this.previousCounters.netin, intervalSeconds);
        if (this.hasCapability('measure_network_in')) {
          await this.setCapabilityValue('measure_network_in', netInRate);
        }
        this.previousCounters.netin = status.netin;
      }

      if (status.netout !== undefined) {
        const netOutRate = this.calculateRate(status.netout, this.previousCounters.netout, intervalSeconds);
        if (this.hasCapability('measure_network_out')) {
          await this.setCapabilityValue('measure_network_out', netOutRate);
        }
        this.previousCounters.netout = status.netout;
      }

      // Disk I/O rates
      if (status.diskread !== undefined) {
        const diskReadRate = this.calculateRate(status.diskread, this.previousCounters.diskread, intervalSeconds);
        if (this.hasCapability('measure_disk_read')) {
          await this.setCapabilityValue('measure_disk_read', diskReadRate);
        }
        this.previousCounters.diskread = status.diskread;
      }

      if (status.diskwrite !== undefined) {
        const diskWriteRate = this.calculateRate(status.diskwrite, this.previousCounters.diskwrite, intervalSeconds);
        if (this.hasCapability('measure_disk_write')) {
          await this.setCapabilityValue('measure_disk_write', diskWriteRate);
        }
        this.previousCounters.diskwrite = status.diskwrite;
      }

      this.previousCounters.timestamp = currentTime;
    }
  }

  /**
   * Check metrics and trigger flow cards when thresholds are crossed
   */
  async checkAndTriggerFlowCards(isRunning, cpuPercent, memPercent) {
    // Skip if driver or triggers are not available
    if (!this.driver) {
      return;
    }

    // Trigger VM started/stopped
    if (this.previousState.isRunning !== null && this.previousState.isRunning !== isRunning) {
      if (isRunning && this.driver.vmStartedTrigger) {
        this.driver.vmStartedTrigger.trigger(this).catch(this.error);
      } else if (!isRunning && this.driver.vmStoppedTrigger) {
        this.driver.vmStoppedTrigger.trigger(this).catch(this.error);
      }
    }
    this.previousState.isRunning = isRunning;

    // Trigger CPU threshold (only when crossing threshold, not continuously)
    if (cpuPercent > 90 && !this.thresholdTracking.cpu.above) {
      this.thresholdTracking.cpu.above = true;
      if (this.driver.cpuAboveThresholdTrigger) {
        this.driver.cpuAboveThresholdTrigger.trigger(this, { cpu_usage: cpuPercent }).catch(this.error);
      }
    } else if (cpuPercent <= 85) {
      // Reset when below 85% to add hysteresis
      this.thresholdTracking.cpu.above = false;
    }

    // Trigger memory threshold
    if (memPercent > 90 && !this.thresholdTracking.memory.above) {
      this.thresholdTracking.memory.above = true;
      if (this.driver.memoryAboveThresholdTrigger) {
        this.driver.memoryAboveThresholdTrigger.trigger(this, { memory_usage: memPercent }).catch(this.error);
      }
    } else if (memPercent <= 85) {
      this.thresholdTracking.memory.above = false;
    }

    // Trigger network traffic threshold
    const netIn = this.getCapabilityValue('measure_network_in') || 0;
    const netOut = this.getCapabilityValue('measure_network_out') || 0;
    const totalNetwork = netIn + netOut;

    if (totalNetwork > 10 && !this.thresholdTracking.network.above) {
      this.thresholdTracking.network.above = true;
      if (this.driver.highNetworkTrafficTrigger) {
        this.driver.highNetworkTrafficTrigger.trigger(this, {
          network_in: netIn,
          network_out: netOut,
        }).catch(this.error);
      }
    } else if (totalNetwork <= 8) {
      this.thresholdTracking.network.above = false;
    }

    // Trigger disk I/O threshold
    const diskRead = this.getCapabilityValue('measure_disk_read') || 0;
    const diskWrite = this.getCapabilityValue('measure_disk_write') || 0;
    const totalDiskIO = diskRead + diskWrite;

    if (totalDiskIO > 50 && !this.thresholdTracking.diskIO.above) {
      this.thresholdTracking.diskIO.above = true;
      if (this.driver.highDiskIOTrigger) {
        this.driver.highDiskIOTrigger.trigger(this, {
          disk_read: diskRead,
          disk_write: diskWrite,
        }).catch(this.error);
      }
    } else if (totalDiskIO <= 40) {
      this.thresholdTracking.diskIO.above = false;
    }
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('ProxmoxDevice has been initialized');

    const data = this.getData();

    this.log('Device type:', data.type);
    this.log('Device ID:', data.id);

    // Initialize previous counter values for rate calculations
    this.previousCounters = {
      netin: null,
      netout: null,
      diskread: null,
      diskwrite: null,
      timestamp: Date.now(),
    };

    // Initialize previous state for detecting changes
    this.previousState = {
      isRunning: null,
      cpuPercent: 0,
      memPercent: 0,
      networkTotal: 0,
      diskIOTotal: 0,
    };

    // Initialize threshold tracking for triggers
    this.thresholdTracking = {
      cpu: { above: false, threshold: 90 },
      memory: { above: false, threshold: 90 },
      network: { above: false, threshold: 10 },
      diskIO: { above: false, threshold: 50 },
    };

    // Ensure capabilities exist for devices
    const requiredCapabilities = [
      'onoff',
      'measure_cpu',
      'measure_memory',
      'measure_disk',
      'sensor_uptime',
      'measure_network_in',
      'measure_network_out',
      'measure_disk_read',
      'measure_disk_write',
      'alarm_connectivity',
      'alarm_heat',
      'alarm_generic',
    ];
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

        let cpuPercent = 0;
        let memPercent = 0;

        // Update resource metrics
        if (isOnline) {
          // CPU usage (cpu is a decimal like 0.14 for 14%)
          if (status.cpu !== undefined) {
            cpuPercent = this.roundToOneDecimal(status.cpu * 100);
            await this.setCapabilityValue('measure_cpu', cpuPercent);
          }

          // Memory usage percentage
          if (status.memory !== undefined && status.maxmem !== undefined && status.maxmem > 0) {
            memPercent = this.roundToOneDecimal((status.memory / status.maxmem) * 100);
            await this.setCapabilityValue('measure_memory', memPercent);
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

          // Update I/O metrics
          await this.updateIOMetrics(status);
        } else {
          // Reset I/O rates when offline
          await this.setCapabilityValue('measure_network_in', 0);
          await this.setCapabilityValue('measure_network_out', 0);
          await this.setCapabilityValue('measure_disk_read', 0);
          await this.setCapabilityValue('measure_disk_write', 0);
        }

        // Update alarms
        await this.updateAlarms(cpuPercent, memPercent, isOnline);

        // Check and trigger flow cards
        await this.checkAndTriggerFlowCards(isOnline, cpuPercent, memPercent);

        this.log(`Node ${data.node} status: ${status.uptime} (${isOnline ? 'ON' : 'OFF'})`);
      } else if (data.type === 'lxc') {
        const status = await ProxmoxAPI.getLXCStatus(
          settings.host, settings.port, data.node, data.vmid,
          settings.tokenID, settings.tokenSecret,
        );
        const isRunning = status.status === 'running';
        await this.setCapabilityValue('onoff', isRunning);

        let cpuPercent = 0;
        let memPercent = 0;

        // Update resource metrics if running
        if (isRunning) {
          // CPU usage (cpu is a decimal)
          if (status.cpu !== undefined) {
            cpuPercent = this.roundToOneDecimal(status.cpu * 100);
            await this.setCapabilityValue('measure_cpu', cpuPercent);
          }

          // Memory usage percentage
          if (status.mem !== undefined && status.maxmem !== undefined && status.maxmem > 0) {
            memPercent = this.roundToOneDecimal((status.mem / status.maxmem) * 100);
            await this.setCapabilityValue('measure_memory', memPercent);
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

          // Update I/O metrics
          await this.updateIOMetrics(status);
        } else {
          // When stopped, set metrics to 0
          await this.setCapabilityValue('measure_cpu', 0);
          await this.setCapabilityValue('measure_memory', 0);
          await this.setCapabilityValue('measure_disk', 0);
          await this.setCapabilityValue('sensor_uptime', 0);
          await this.setCapabilityValue('measure_network_in', 0);
          await this.setCapabilityValue('measure_network_out', 0);
          await this.setCapabilityValue('measure_disk_read', 0);
          await this.setCapabilityValue('measure_disk_write', 0);
        }

        // Update alarms
        await this.updateAlarms(cpuPercent, memPercent, isRunning);

        // Check and trigger flow cards
        await this.checkAndTriggerFlowCards(isRunning, cpuPercent, memPercent);

        this.log(`LXC ${data.vmid} status: ${status.status} (${isRunning ? 'ON' : 'OFF'})`);
      } else if (data.type === 'vm') {
        const status = await ProxmoxAPI.getVMStatus(
          settings.host, settings.port, data.node, data.vmid,
          settings.tokenID, settings.tokenSecret,
        );
        const isRunning = status.status === 'running';
        await this.setCapabilityValue('onoff', isRunning);

        let cpuPercent = 0;
        let memPercent = 0;

        // Update resource metrics if running
        if (isRunning) {
          // CPU usage (cpu is a decimal)
          if (status.cpu !== undefined) {
            cpuPercent = this.roundToOneDecimal(status.cpu * 100);
            await this.setCapabilityValue('measure_cpu', cpuPercent);
          }

          // Memory usage percentage
          if (status.mem !== undefined && status.maxmem !== undefined && status.maxmem > 0) {
            memPercent = this.roundToOneDecimal((status.mem / status.maxmem) * 100);
            await this.setCapabilityValue('measure_memory', memPercent);
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

          // Update I/O metrics
          await this.updateIOMetrics(status);
        } else {
          // When stopped, set metrics to 0
          await this.setCapabilityValue('measure_cpu', 0);
          await this.setCapabilityValue('measure_memory', 0);
          await this.setCapabilityValue('measure_disk', 0);
          await this.setCapabilityValue('sensor_uptime', 0);
          await this.setCapabilityValue('measure_network_in', 0);
          await this.setCapabilityValue('measure_network_out', 0);
          await this.setCapabilityValue('measure_disk_read', 0);
          await this.setCapabilityValue('measure_disk_write', 0);
        }

        // Update alarms
        await this.updateAlarms(cpuPercent, memPercent, isRunning);

        // Check and trigger flow cards
        await this.checkAndTriggerFlowCards(isRunning, cpuPercent, memPercent);

        this.log(`VM ${data.vmid} status: ${status.status} (${isRunning ? 'ON' : 'OFF'})`);
      }
    } catch (error) {
      this.error('Failed to update status:', error.message);
      // Trigger alarm_generic on error
      if (this.hasCapability('alarm_generic')) {
        await this.setCapabilityValue('alarm_generic', true).catch(this.error);
      }
      // Trigger alarm_connectivity on error (likely connection issue)
      if (this.hasCapability('alarm_connectivity')) {
        await this.setCapabilityValue('alarm_connectivity', true).catch(this.error);
      }
      // Trigger unreachable flow card
      if (this.driver && this.driver.deviceUnreachableTrigger) {
        this.driver.deviceUnreachableTrigger.trigger(this).catch(this.error);
      }
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
