'use strict';
const Homey = require('homey');
const ProxmoxAPI = require('../../lib/proxmox-api');

module.exports = class ProxmoxDriver extends Homey.Driver {
  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('ProxmoxDriver has been initialized');
  }

  async onPair(session) {
    let host = "";
    let port = "";
    let tokenID = "";
    let tokenSecret = "";

    session.setHandler("login", async (data) => {
      host = data.host;
      port = data.port || "8006";
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

    session.setHandler("list_devices", async () => {
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
          for (const storage of storages.filter(s => s.type === 'cephfs')) {
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

};
