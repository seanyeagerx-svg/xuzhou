const path = require('node:path');
const crypto = require('node:crypto');

const MIN_DISK_BYTES = 1024 ** 3;
const MIN_MEMORY_BYTES = 128 * 1024 ** 2;
const MAX_FILE_BYTES = 2 * 1024 ** 2;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function fail(code) { throw new Error('XUZHOU_DEVICE_' + code); }
function capacity(value) {
  if (!value || !['diskFree', 'diskTotal', 'memoryAvailable', 'memoryTotal'].every(k => Number.isSafeInteger(value[k]) && value[k] >= 0) || value.diskTotal < 1 || value.memoryTotal < 1 || value.diskFree > value.diskTotal || value.memoryAvailable > value.memoryTotal) return { usable: false, reason: 'CAPACITY_UNKNOWN' };
  if (value.diskFree < MIN_DISK_BYTES || value.diskFree / value.diskTotal < 0.05) return { usable: false, reason: 'CLOUD_SPACE_LOW' };
  if (value.memoryAvailable < MIN_MEMORY_BYTES) return { usable: false, reason: 'CLOUD_MEMORY_LOW' };
  return { usable: true, reason: null };
}
function relativeName(value = '') {
  if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x1f:]/.test(value) || path.isAbsolute(value) || /^[\\/]/.test(value)) fail('PATH_OUTSIDE');
  const parts = value.replaceAll('\\', '/').split('/').filter(p => p && p !== '.');
  if (parts.some(p => p === '..')) fail('PATH_OUTSIDE');
  return parts.join('/');
}
function commandRequest(data) {
  if (typeof data.command !== 'string' || !data.command.trim() || data.command.length > 12000 || data.command.includes('\0')) fail('COMMAND_INVALID');
  const timeoutMs = data.timeoutMs ?? 30000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) fail('TIMEOUT_INVALID');
  return { command: data.command, timeoutMs };
}
function fileRequest(data) {
  if (!['list', 'read', 'write', 'mkdir'].includes(data.operation)) fail('FILE_OPERATION_INVALID');
  const name = relativeName(data.path);
  if (data.operation !== 'list' && !name) fail('PATH_INVALID');
  if (data.operation === 'write') {
    if (typeof data.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.base64)) fail('FILE_INVALID');
    if (Buffer.byteLength(data.base64, 'base64') > MAX_FILE_BYTES) fail('FILE_TOO_LARGE');
    if (data.expectedSha256 !== null && !/^[a-f0-9]{64}$/.test(data.expectedSha256 || '')) fail('FILE_VERSION_REQUIRED');
  }
  return { ...data, path: name };
}
module.exports = { capacity, commandRequest, fileRequest, relativeName, fail, hash, MIN_DISK_BYTES, MIN_MEMORY_BYTES, MAX_FILE_BYTES };
