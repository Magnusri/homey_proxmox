'use strict';

const https = require('https');

/**
 * Shared Proxmox API utility
 */
class ProxmoxAPI {

  /**
   * Make an API request to Proxmox
   */
  static async request(host, port, endpoint, tokenID, tokenSecret, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: host,
        port: port || 8006,
        path: `/api2/json${endpoint}`,
        method,
        headers: {
          Authorization: `PVEAPIToken=${tokenID}=${tokenSecret}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        rejectUnauthorized: false, // Accept self-signed certificates
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(jsonData.data);
            } else {
              reject(new Error(`API request failed: ${res.statusCode} - ${jsonData.errors || data}`));
            }
          } catch (error) {
            reject(new Error(`Failed to parse API response: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`API request error: ${error.message}`));
      });

      if (body) {
        req.write(body);
      }

      req.end();
    });
  }

  /**
   * Test connection to Proxmox server
   */
  static async testConnection(host, port, tokenID, tokenSecret) {
    const nodes = await this.request(host, port, '/nodes', tokenID, tokenSecret);
    return nodes && nodes.length > 0;
  }

  /**
   * Get all nodes
   */
  static async getNodes(host, port, tokenID, tokenSecret) {
    return this.request(host, port, '/nodes', tokenID, tokenSecret);
  }

  /**
   * Get LXC containers for a node
   */
  static async getLXCs(host, port, node, tokenID, tokenSecret) {
    return this.request(host, port, `/nodes/${node}/lxc`, tokenID, tokenSecret);
  }

  /**
   * Get VMs for a node
   */
  static async getVMs(host, port, node, tokenID, tokenSecret) {
    return this.request(host, port, `/nodes/${node}/qemu`, tokenID, tokenSecret);
  }

  /**
   * Get all storage
   */
  static async getStorage(host, port, tokenID, tokenSecret) {
    return this.request(host, port, '/storage', tokenID, tokenSecret);
  }

  /**
   * Get node status
   */
  static async getNodeStatus(host, port, node, tokenID, tokenSecret) {
    return this.request(host, port, `/nodes/${node}/status`, tokenID, tokenSecret);
  }

  /**
   * Get LXC status
   */
  static async getLXCStatus(host, port, node, vmid, tokenID, tokenSecret) {
    return this.request(host, port, `/nodes/${node}/lxc/${vmid}/status/current`, tokenID, tokenSecret);
  }

  /**
   * Get VM status
   */
  static async getVMStatus(host, port, node, vmid, tokenID, tokenSecret) {
    return this.request(host, port, `/nodes/${node}/qemu/${vmid}/status/current`, tokenID, tokenSecret);
  }

  /**
   * Start LXC container
   */
  static async startLXC(host, port, node, vmid, tokenID, tokenSecret) {
    return this.request(host, port, `/nodes/${node}/lxc/${vmid}/status/start`, tokenID, tokenSecret, 'POST');
  }

  /**
   * Stop LXC container
   */
  static async stopLXC(host, port, node, vmid, tokenID, tokenSecret) {
    return this.request(host, port, `/nodes/${node}/lxc/${vmid}/status/stop`, tokenID, tokenSecret, 'POST');
  }

  /**
   * Restart LXC container
   */
  static async restartLXC(host, port, node, vmid, tokenID, tokenSecret) {
    return this.request(host, port, `/nodes/${node}/lxc/${vmid}/status/reboot`, tokenID, tokenSecret, 'POST');
  }

  /**
   * Start VM
   */
  static async startVM(host, port, node, vmid, tokenID, tokenSecret) {
    return this.request(host, port, `/nodes/${node}/qemu/${vmid}/status/start`, tokenID, tokenSecret, 'POST');
  }

  /**
   * Stop VM
   */
  static async stopVM(host, port, node, vmid, tokenID, tokenSecret) {
    return this.request(host, port, `/nodes/${node}/qemu/${vmid}/status/stop`, tokenID, tokenSecret, 'POST');
  }

  /**
   * Restart VM
   */
  static async restartVM(host, port, node, vmid, tokenID, tokenSecret) {
    return this.request(host, port, `/nodes/${node}/qemu/${vmid}/status/reboot`, tokenID, tokenSecret, 'POST');
  }

  /**
   * Get storage status
   */
  static async getStorageStatus(host, port, node, storage, tokenID, tokenSecret) {
    return this.request(host, port, `/nodes/${node}/storage/${storage}/status`, tokenID, tokenSecret);
  }

  /**
   * Find which node currently hosts a VM or LXC container
   * Searches all nodes in the cluster to locate the VM/LXC by VMID
   * @param {string} host - Proxmox host
   * @param {string} port - Proxmox port
   * @param {number} vmid - VM/LXC ID to find
   * @param {string} type - Type ('lxc' or 'vm')
   * @param {string} tokenID - API token ID
   * @param {string} tokenSecret - API token secret
   * @returns {Promise<string|null>} Node name where VM/LXC is located, or null if not found
   */
  static async findVMNode(host, port, vmid, type, tokenID, tokenSecret) {
    try {
      const nodes = await this.getNodes(host, port, tokenID, tokenSecret);

      for (const node of nodes) {
        try {
          if (type === 'lxc') {
            const lxcs = await this.getLXCs(host, port, node.node, tokenID, tokenSecret);
            if (lxcs.find((lxc) => lxc.vmid === vmid)) {
              return node.node;
            }
          } else if (type === 'vm') {
            const vms = await this.getVMs(host, port, node.node, tokenID, tokenSecret);
            if (vms.find((vm) => vm.vmid === vmid)) {
              return node.node;
            }
          }
        } catch (error) {
          // Node might be unreachable, continue checking other nodes
          // This is expected in clusters with offline nodes
        }
      }
      return null;
    } catch (error) {
      // Failed to get nodes list - cluster connectivity issue
      return null;
    }
  }
}

module.exports = ProxmoxAPI;
