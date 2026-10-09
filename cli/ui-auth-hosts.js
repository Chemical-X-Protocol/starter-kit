/**
 * Host allow-list for the chemx UI (DNS-rebinding defence).
 * Loopback names and the bind address are always allowed. A wildcard bind
 * (0.0.0.0 or ::) also allows this machine's interface addresses, its hostname
 * and <hostname>.local, so the UI works from the LAN. --allow-host adds names.
 */
import os from 'node:os';

const WILDCARD_HOSTS = new Set(['', '0.0.0.0', '::', '[::]']);
const LOOPBACK_NAMES = ['127.0.0.1', 'localhost', '::1', '[::1]'];

export const isWildcardHost = (host = '') => WILDCARD_HOSTS.has(String(host).toLowerCase());

const bracketIpv6 = (address) => {
  const isBareIpv6 = address.includes(':') && !address.startsWith('[');
  return isBareIpv6 ? `[${address}]` : address;
};

/** Non-internal addresses of this machine's network interfaces. */
export const listInterfaceAddresses = () => Object.values(os.networkInterfaces())
  .flat()
  .filter((entry) => Boolean(entry) && !entry.internal)
  .map((entry) => entry.address);

export const buildAllowedHosts = (options = {}) => {
  const bindHost = String(options.bindHost || '127.0.0.1').toLowerCase();
  const allowed = new Set([...LOOPBACK_NAMES, bindHost, bracketIpv6(bindHost)]);
  const isWildcard = isWildcardHost(bindHost);
  if (isWildcard) {
    const addresses = options.interfaceAddresses || listInterfaceAddresses();
    const hostName = String(options.hostName || os.hostname()).toLowerCase();
    for (const address of addresses) allowed.add(bracketIpv6(String(address).toLowerCase()));
    allowed.add(hostName);
    allowed.add(`${hostName}.local`);
  }
  for (const extra of options.allowHosts || []) allowed.add(String(extra).toLowerCase());
  return allowed;
};

/** Host to print in the UI URL: a reachable LAN IPv4 for a wildcard bind, else the bind host. */
export const resolveUiUrlHost = (bindHost = '127.0.0.1', interfaceAddresses = listInterfaceAddresses()) => {
  const isWildcard = isWildcardHost(bindHost);
  if (!isWildcard) return bracketIpv6(bindHost);
  const lanIpv4 = interfaceAddresses.find((address) => /^\d+\.\d+\.\d+\.\d+$/.test(address));
  return lanIpv4 || '127.0.0.1';
};
