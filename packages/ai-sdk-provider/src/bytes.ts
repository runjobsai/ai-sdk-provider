/**
 * Base64 decoding that works in both halves of the runtime.
 *
 * `Buffer` is Node-only and `atob` was browser-only until Node 16, so
 * neither is safe on its own for a package that ships to both. `atob`
 * is the one both platforms now agree on.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
