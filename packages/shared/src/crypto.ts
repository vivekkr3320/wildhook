import * as crypto from 'crypto';

export function signPayload(payload: string, secret: string, timestamp: number): string {
  const data = `${timestamp}.${payload}`;
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

export function generateSignatureHeader(payload: string, secret: string): { signature: string; header: string; timestamp: number } {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signPayload(payload, secret, timestamp);
  return {
    signature,
    header: `t=${timestamp},v1=${signature}`,
    timestamp
  };
}

export function verifySignature(payload: string, header: string, secret: string, toleranceSeconds = 300): boolean {
  try {
    if (!header || !secret) return false;

    const parts = header.split(',');
    const tPart = parts.find(p => p.startsWith('t='));
    const v1Part = parts.find(p => p.startsWith('v1='));
    if (!tPart || !v1Part) return false;

    const timestamp = parseInt(tPart.split('=')[1], 10);
    const signature = v1Part.split('=')[1];

    if (isNaN(timestamp)) return false;

    // Verify replay window
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > toleranceSeconds) {
      return false;
    }

    const expectedSignature = signPayload(payload, secret, timestamp);

    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expectedSignature, 'hex');

    if (sigBuf.length !== expBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch (err) {
    return false;
  }
}
