import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;

function getEncryptionKey(): Buffer {
  const envKey = process.env.BANK_ENCRYPTION_KEY?.trim();
  if (envKey && /^[0-9a-fA-F]{64}$/.test(envKey)) {
    return Buffer.from(envKey, 'hex');
  }
  // Ephemeral deterministic fallback key derived strictly for non-production environments
  // when BANK_ENCRYPTION_KEY is not configured in Secrets. System Health flags this explicitly.
  const seed = process.env.SQL_DB_NAME || 'forgex-4xpay-dev-fallback-key';
  return crypto.createHash('sha256').update(`4xpay:aes256:${seed}`).digest();
}

export function isProductionEncryptionKeyConfigured(): boolean {
  const envKey = process.env.BANK_ENCRYPTION_KEY?.trim();
  return Boolean(envKey && /^[0-9a-fA-F]{64}$/.test(envKey));
}

export function encryptSensitive(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: authTag.toString('base64'),
    ct: encrypted.toString('base64'),
  });
}

export function decryptSensitive(payload: string): string {
  const parsed = JSON.parse(payload) as { iv: string; tag: string; ct: string };
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(parsed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.ct, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function maskAccountNumber(accountNumber: string): string {
  const cleaned = accountNumber.replace(/\s+/g, '');
  if (cleaned.length <= 4) {
    return 'X'.repeat(cleaned.length);
  }
  return `${'X'.repeat(cleaned.length - 4)}${cleaned.slice(-4)}`;
}

export function generateApiKey(): { rawKey: string; keyPrefix: string; keyHash: string } {
  const randomPart = crypto.randomBytes(24).toString('base64url');
  const rawKey = `fx4x_live_${randomPart}`;
  const keyPrefix = rawKey.slice(0, 16);
  const keyHash = hashApiKey(rawKey);
  return { rawKey, keyPrefix, keyHash };
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

export function verifyApiKeyHash(rawKey: string, storedHash: string): boolean {
  const computed = Buffer.from(hashApiKey(rawKey), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  if (computed.length !== expected.length) return false;
  return crypto.timingSafeEqual(computed, expected);
}

// HMAC-SHA256 expiring download token for receipts and invoices
function getReceiptSigningSecret(): string {
  return (
    process.env.RECEIPT_SIGNING_SECRET?.trim() ||
    crypto
      .createHash('sha256')
      .update(`4xpay:receipt:${process.env.SQL_DB_NAME || 'dev'}`)
      .digest('hex')
  );
}

export function createDocumentDownloadToken(
  docType: 'receipt' | 'invoice',
  resourceId: string,
  userId: string,
  ttlSeconds = 300
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = Buffer.from(JSON.stringify({ docType, resourceId, userId, exp })).toString(
    'base64url'
  );
  const sig = crypto
    .createHmac('sha256', getReceiptSigningSecret())
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyDocumentDownloadToken(
  token: string,
  expectedType: 'receipt' | 'invoice'
): { resourceId: string; userId: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getReceiptSigningSecret())
    .update(payload)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      docType: string;
      resourceId: string;
      userId: string;
      exp: number;
    };
    if (data.docType !== expectedType) return null;
    if (Date.now() / 1000 > data.exp) return null;
    return { resourceId: data.resourceId, userId: data.userId };
  } catch {
    return null;
  }
}

// RFC 6238 TOTP MFA using standard HMAC-SHA1 (zero custom crypto)
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  let output = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpCode(secretBase32: string, timestampMs = Date.now()): string {
  const counter = Math.floor(timestampMs / 1000 / 30);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);
  const key = base32Decode(secretBase32);
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(secretBase32: string, code: string, windowSteps = 1): boolean {
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  const now = Date.now();
  for (let delta = -windowSteps; delta <= windowSteps; delta++) {
    const expected = generateTotpCode(secretBase32, now + delta * 30_000);
    if (crypto.timingSafeEqual(Buffer.from(normalized), Buffer.from(expected))) {
      return true;
    }
  }
  return false;
}

export function buildTotpUri(secretBase32: string, email: string): string {
  const issuer = 'ForgeX 4XPay';
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// Validation utilities
export function validateIfsc(ifsc: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase());
}

export function validateUpiId(upiId: string): boolean {
  return /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/.test(upiId.trim());
}

export function validateBankAccountNumber(acc: string): boolean {
  return /^[0-9]{9,18}$/.test(acc.trim());
}

export function validateUtr(utr: string): boolean {
  return /^[A-Za-z0-9]{6,35}$/.test(utr.trim());
}

// Human-readable unique public references (internal PK remains UUID)
function randomAlphaNum(len: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

export function generatePaymentRef(): string {
  const year = new Date().getUTCFullYear();
  return `FXPAY-${year}-${randomAlphaNum(6)}`;
}

export function generatePaymentRequestRef(): string {
  const year = new Date().getUTCFullYear();
  return `FXREQ-${year}-${randomAlphaNum(5)}`;
}

export function generateCustomerRef(): string {
  return `FXC-${randomAlphaNum(5)}`;
}

export function generateProjectRef(): string {
  return `FXPR-${randomAlphaNum(5)}`;
}

export function generateInvoiceRef(): string {
  return `FXINV-${randomAlphaNum(6)}`;
}

export function generateReceiptRef(): string {
  const year = new Date().getUTCFullYear();
  return `FXRCPT-${year}-${randomAlphaNum(6)}`;
}

export function generateLedgerRef(): string {
  const year = new Date().getUTCFullYear();
  return `FXLED-${year}-${randomAlphaNum(6)}`;
}

export function generateDisputeRef(): string {
  const year = new Date().getUTCFullYear();
  return `FXDSP-${year}-${randomAlphaNum(5)}`;
}

export function generateImportRef(): string {
  const year = new Date().getUTCFullYear();
  return `FXIMP-${year}-${randomAlphaNum(5)}`;
}

export function generateAccountCode(): string {
  return `FXACC-${randomAlphaNum(4)}`;
}

export function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}
