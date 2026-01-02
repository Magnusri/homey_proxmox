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
   * Get storage status
   */
  static async getStorageStatus(host, port, node, storage, tokenID, tokenSecret) {
    return this.request(host, port, `/nodes/${node}/storage/${storage}/status`, tokenID, tokenSecret);
  }
}

module.exports = ProxmoxAPI;
