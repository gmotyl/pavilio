import { getConfig } from "../config.js";
import { machineIdFrom } from "./machineName.js";

export { machineHostname, sanitizeHostname } from "./machineName.js";

/** Panel config `machineId` (sanitized) when set, else machineHostname(). */
export function machineId(): string {
  return machineIdFrom(getConfig().machineId);
}
