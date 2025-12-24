/**
 * Token Encryption Module
 * Handles OAuth token encryption/decryption using OS keychain
 */

import { safeStorage } from 'electron';

/**
 * Encrypt a token using the OS keychain (safeStorage API).
 * Returns base64-encoded encrypted data, or the raw token if encryption unavailable.
 */
export function encryptToken(token: string): string {
  const encryptionAvailable = safeStorage.isEncryptionAvailable();
  console.warn('[TokenEncryption] encryptToken:', {
    tokenLength: token.length,
    encryptionAvailable
  });

  try {
    if (encryptionAvailable) {
      const encrypted = safeStorage.encryptString(token);
      const result = 'enc:' + encrypted.toString('base64');
      console.warn('[TokenEncryption] Token encrypted successfully, result length:', result.length);
      return result;
    }
  } catch (error) {
    console.error('[TokenEncryption] Encryption failed:', error);
  }

  console.warn('[TokenEncryption] Storing token unencrypted (encryption not available)');
  return token;
}

/**
 * Decrypt a token. Handles both encrypted (enc:...) and legacy plain tokens.
 */
export function decryptToken(storedToken: string): string {
  const isEncrypted = storedToken.startsWith('enc:');
  const encryptionAvailable = safeStorage.isEncryptionAvailable();

  console.warn('[TokenEncryption] decryptToken:', {
    storedTokenLength: storedToken.length,
    isEncrypted,
    encryptionAvailable
  });

  try {
    if (isEncrypted && encryptionAvailable) {
      const encryptedData = Buffer.from(storedToken.slice(4), 'base64');
      const decrypted = safeStorage.decryptString(encryptedData);
      console.warn('[TokenEncryption] Token decrypted successfully, length:', decrypted.length);
      return decrypted;
    } else if (isEncrypted && !encryptionAvailable) {
      console.error('[TokenEncryption] Token is encrypted but encryption is not available!');
      return ''; // Can't decrypt - encryption API not available
    }
  } catch (error) {
    console.error('[TokenEncryption] Failed to decrypt token:', error);
    return ''; // Return empty string on decryption failure
  }

  // Return as-is for legacy unencrypted tokens
  console.warn('[TokenEncryption] Token is unencrypted, returning as-is');
  return storedToken;
}

/**
 * Check if a token is encrypted
 */
export function isTokenEncrypted(storedToken: string): boolean {
  return storedToken.startsWith('enc:');
}
