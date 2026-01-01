'use strict';

const Homey = require('homey');
const ProxmoxAPI = require('../../lib/proxmox-api');

module.exports = class ProxmoxDriver extends Homey.Driver {
  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('ProxmoxDriver has been initialized');

    // Register flow card triggers
    this.vmStartedTrigger = this.homey.flow.getDeviceTriggerCard('vm_started');
    this.vmStoppedTrigger = this.homey.flow.getDeviceTriggerCard('vm_stopped');
    this.cpuAboveThresholdTrigger = this.homey.flow.getDeviceTriggerCard('cpu_above_threshold');
    this.memoryAboveThresholdTrigger = this.homey.flow.getDeviceTriggerCard('memory_above_threshold');
    this.deviceUnreachableTrigger = this.homey.flow.getDeviceTriggerCard('device_unreachable');
    this.highNetworkTrafficTrigger = this.homey.flow.getDeviceTriggerCard('high_network_traffic');
    this.highDiskIOTrigger = this.homey.flow.getDeviceTriggerCard('high_disk_io');
    this.diskSpaceLowTrigger = this.homey.flow.getDeviceTriggerCard('disk_space_low');

    // Register run listeners for triggers with arguments
    this.cpuAboveThresholdTrigger.registerRunListener(async (args, state) => {
      // Check if actual CPU usage is above the user-specified threshold
      return state.cpu_usage > args.threshold;
    });

    this.memoryAboveThresholdTrigger.registerRunListener(async (args, state) => {
      // Check if actual memory usage is above the user-specified threshold
      return state.memory_usage > args.threshold;
    });

    this.highNetworkTrafficTrigger.registerRunListener(async (args, state) => {
      // Check if total network traffic is above the user-specified threshold
      const totalTraffic = state.network_in + state.network_out;
      return totalTraffic > args.threshold;
    });

    this.highDiskIOTrigger.registerRunListener(async (args, state) => {
      // Check if total disk I/O is above the user-specified threshold
      const totalIO = state.disk_read + state.disk_write;
      return totalIO > args.threshold;
    });

    this.diskSpaceLowTrigger.registerRunListener(async (args, state) => {
      // Check if free disk space is below the user-specified threshold
      return state.disk_free < args.threshold;
    });

    // Register flow card conditions
    this.homey.flow.getConditionCard('is_running')
      .registerRunListener(async (args) => {
        const onoffValue = args.device.getCapabilityValue('onoff');
        return onoffValue === true;
      });

    this.homey.flow.getConditionCard('cpu_above')
      .registerRunListener(async (args) => {
        const cpuUsage = args.device.getCapabilityValue('measure_cpu');
        if (cpuUsage === null || cpuUsage === undefined) {
          return false;
        }
        return cpuUsage > args.threshold;
      });

    this.homey.flow.getConditionCard('memory_above')
      .registerRunListener(async (args) => {
        const memUsage = args.device.getCapabilityValue('measure_memory');
        if (memUsage === null || memUsage === undefined) {
          return false;
        }
        return memUsage > args.threshold;
      });

    this.homey.flow.getConditionCard('uptime_greater')
      .registerRunListener(async (args) => {
        const uptime = args.device.getCapabilityValue('sensor_uptime');
        if (uptime === null || uptime === undefined) {
          return false;
        }
        return uptime > args.hours;
      });

    this.homey.flow.getConditionCard('network_above')
      .registerRunListener(async (args) => {
        const netIn = args.device.getCapabilityValue('measure_network_in') || 0;
        const netOut = args.device.getCapabilityValue('measure_network_out') || 0;
        const totalTraffic = netIn + netOut;
        return totalTraffic > args.threshold;
      });

    // Register flow card actions
    this.homey.flow.getActionCard('start_vm')
      .registerRunListener(async (args) => {
        const data = args.device.getData();
        // Only allow start/stop for VMs and LXCs, not nodes or storage
        if (data.type !== 'vm' && data.type !== 'lxc') {
          throw new Error('This device cannot be started');
        }
        await args.device.setCapabilityValue('onoff', true);
      });

    this.homey.flow.getActionCard('stop_vm')
      .registerRunListener(async (args) => {
        const data = args.device.getData();
        // Only allow start/stop for VMs and LXCs, not nodes or storage
        if (data.type !== 'vm' && data.type !== 'lxc') {
          throw new Error('This device cannot be stopped');
        }
        await args.device.setCapabilityValue('onoff', false);
      });

    this.homey.flow.getActionCard('restart_vm')
      .registerRunListener(async (args) => {
        const data = args.device.getData();
        // Only allow start/stop for VMs and LXCs, not nodes or storage
        if (data.type !== 'vm' && data.type !== 'lxc') {
          throw new Error('This device cannot be restarted');
        }
        // Stop then start
        await args.device.setCapabilityValue('onoff', false);
        // Wait a bit before starting
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await args.device.setCapabilityValue('onoff', true);
      });
  }

  async onPair(session) {
    let host = '';
    let port = '';
    let tokenID = '';
    let tokenSecret = '';

    session.setHandler('login', async (data) => {
      host = data.host;
      port = data.port || '8006';
      tokenID = data.tokenID;
      tokenSecret = data.tokenSecret;

      try {
        const result = await ProxmoxAPI.testConnection(host, port, tokenID, tokenSecret);
        return result;
      } catch (error) {
        this.error('Login failed:', error.message);
        throw new Error(`Failed to connect to Proxmox: ${error.message}`);
      }
    });

    session.setHandler('list_devices', async () => {
      try {
        const devices = [];
        const nodeDevices = [];
        const lxcDevices = [];
        const vmDevices = [];
        const storageDevices = [];

        // Get all nodes
        const nodes = await ProxmoxAPI.getNodes(host, port, tokenID, tokenSecret);

        // Collect nodes
        for (const node of nodes) {
          nodeDevices.push({
            name: `Node: ${node.node}`,
            data: {
              id: `node-${node.node}`,
              type: 'node',
              node: node.node,
            },
            settings: {
              host,
              port,
              tokenID,
              tokenSecret,
            },
          });

          // Get LXC containers for each node
          try {
            const lxcs = await ProxmoxAPI.getLXCs(host, port, node.node, tokenID, tokenSecret);
            for (const lxc of lxcs) {
              lxcDevices.push({
                name: `${lxc.vmid} - ${lxc.name}`,
                data: {
                  id: `lxc-${node.node}-${lxc.vmid}`,
                  type: 'lxc',
                  node: node.node,
                  vmid: lxc.vmid,
                },
                settings: {
                  host,
                  port,
                  tokenID,
                  tokenSecret,
                },
              });
            }
          } catch (error) {
            this.log(`Could not get LXCs for node ${node.node}:`, error.message);
          }

          // Get VMs (QEMU) for each node
          try {
            const vms = await ProxmoxAPI.getVMs(host, port, node.node, tokenID, tokenSecret);
            for (const vm of vms) {
              vmDevices.push({
                name: `${vm.vmid} - ${vm.name}`,
                data: {
                  id: `vm-${node.node}-${vm.vmid}`,
                  type: 'vm',
                  node: node.node,
                  vmid: vm.vmid,
                },
                settings: {
                  host,
                  port,
                  tokenID,
                  tokenSecret,
                },
              });
            }
          } catch (error) {
            this.log(`Could not get VMs for node ${node.node}:`, error.message);
          }
        }

        // Get storage
        try {
          const storages = await ProxmoxAPI.getStorage(host, port, tokenID, tokenSecret);
          for (const storage of storages.filter((s) => s.type === 'cephfs')) {
            storageDevices.push({
              name: `CephFS: ${storage.storage}`,
              data: {
                id: `storage-${storage.storage}`,
                type: 'storage',
                storageType: storage.type,
                storage: storage.storage,
              },
              settings: {
                host,
                port,
                tokenID,
                tokenSecret,
              },
            });
          }
        } catch (error) {
          this.log('Could not get storage:', error.message);
        }

        // Add devices in the requested order: Nodes -> LXC -> VMs -> Storage
        devices.push(...nodeDevices, ...lxcDevices, ...vmDevices, ...storageDevices);

        return devices;
      } catch (error) {
        this.error('Failed to list devices:', error.message);
        throw new Error(`Failed to get resources: ${error.message}`);
      }
    });
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    return [];
  }

  async onRepair(session, device) {
    let host = '';
    let port = '';
    let tokenID = '';
    let tokenSecret = '';

    session.setHandler('login', async (data) => {
      host = data.host;
      port = data.port || '8006';
      tokenID = data.tokenID;
      tokenSecret = data.tokenSecret;

      try {
        const result = await ProxmoxAPI.testConnection(host, port, tokenID, tokenSecret);

        // Update device settings with new credentials
        await device.setSettings({
          host,
          port,
          tokenID,
          tokenSecret,
        });

        // Mark device as available
        await device.setAvailable();

        // Trigger an immediate status update
        await device.updateStatus();

        return result;
      } catch (error) {
        this.error('Repair login failed:', error.message);
        throw new Error(`Failed to connect to Proxmox: ${error.message}`);
      }
    });
  }

};
