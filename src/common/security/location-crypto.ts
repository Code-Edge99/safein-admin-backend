import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

type CoordinatePair = {
  latitude: number;
  longitude: number;
};

type EncryptedLocationColumns = {
  locationCiphertext: string;
  locationIv: string;
  locationTag: string;
  locationKeyVersion: number;
};

type MaybeEncryptedLocation = {
  locationCiphertext?: string | null;
  locationIv?: string | null;
  locationTag?: string | null;
  locationKeyVersion?: number | null;
};

let cachedKey: Buffer | null = null;
let cachedKeyVersion: number | null = null;

function decodeKey(rawKey: string): Buffer {
  const trimmed = rawKey.trim();

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  const base64Buffer = Buffer.from(trimmed, 'base64');
  if (base64Buffer.length === 32) {
    return base64Buffer;
  }

  const utf8Buffer = Buffer.from(trimmed, 'utf8');
  if (utf8Buffer.length === 32) {
    return utf8Buffer;
  }

  throw new Error('LOCATION_ENCRYPTION_KEY must decode to 32 bytes.');
}

function getKey(): Buffer {
  if (cachedKey) {
    return cachedKey;
  }

  const rawKey = process.env.LOCATION_ENCRYPTION_KEY;
  if (!rawKey) {
    throw new Error('LOCATION_ENCRYPTION_KEY is required.');
  }

  cachedKey = decodeKey(rawKey);
  return cachedKey;
}

function getKeyVersion(): number {
  if (cachedKeyVersion !== null) {
    return cachedKeyVersion;
  }

  const parsed = Number.parseInt(process.env.LOCATION_ENCRYPTION_KEY_VERSION ?? '1', 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('LOCATION_ENCRYPTION_KEY_VERSION must be a positive integer.');
  }

  cachedKeyVersion = parsed;
  return parsed;
}

function assertFiniteCoordinate(value: number, fieldName: 'latitude' | 'longitude'): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number.`);
  }
}

export function encryptLocation(location: CoordinatePair): EncryptedLocationColumns {
  assertFiniteCoordinate(location.latitude, 'latitude');
  assertFiniteCoordinate(location.longitude, 'longitude');

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(location), 'utf8'),
    cipher.final(),
  ]);

  return {
    locationCiphertext: ciphertext.toString('base64'),
    locationIv: iv.toString('base64'),
    locationTag: cipher.getAuthTag().toString('base64'),
    locationKeyVersion: getKeyVersion(),
  };
}

export function decryptLocation(location: MaybeEncryptedLocation): CoordinatePair | undefined {
  if (!location.locationCiphertext && !location.locationIv && !location.locationTag) {
    return undefined;
  }

  if (!location.locationCiphertext || !location.locationIv || !location.locationTag) {
    return undefined;
  }

  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(location.locationIv, 'base64'));
  decipher.setAuthTag(Buffer.from(location.locationTag, 'base64'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(location.locationCiphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');

  const parsed = JSON.parse(plaintext) as CoordinatePair;
  assertFiniteCoordinate(parsed.latitude, 'latitude');
  assertFiniteCoordinate(parsed.longitude, 'longitude');
  return parsed;
}