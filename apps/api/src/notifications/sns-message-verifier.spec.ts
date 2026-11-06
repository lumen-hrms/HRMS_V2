import { createSign, generateKeyPairSync } from 'crypto';
import {
  isSnsUrl,
  parseSnsMessage,
  SnsMessage,
  SnsMessageVerifier,
  stringToSign,
} from './sns-message-verifier';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const CERT_URL = 'https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-abc.pem';

function signed(overrides: Partial<SnsMessage> = {}, version: '1' | '2' = '2'): SnsMessage {
  const msg: SnsMessage = {
    Type: 'Notification',
    MessageId: 'm-1',
    TopicArn: 'arn:aws:sns:ap-south-1:123:ses-events',
    Message: '{"eventType":"Bounce"}',
    Timestamp: '2026-11-02T10:00:00.000Z',
    SignatureVersion: version,
    Signature: '',
    SigningCertURL: CERT_URL,
    ...overrides,
  };
  msg.Signature = createSign(version === '1' ? 'RSA-SHA1' : 'RSA-SHA256')
    .update(stringToSign(msg))
    .sign(privateKey, 'base64');
  return msg;
}

function verifier() {
  const v = new SnsMessageVerifier();
  const fetchText = jest.spyOn(v, 'fetchText').mockResolvedValue(PUBLIC_PEM);
  return { v, fetchText };
}

describe('SnsMessageVerifier', () => {
  it.each(['1', '2'] as const)(
    'accepts a correctly signed SignatureVersion %s message',
    async (ver) => {
      const { v } = verifier();
      await expect(v.verify(signed({}, ver))).resolves.toBe(true);
    },
  );

  it('rejects a message whose content was changed after signing', async () => {
    const { v } = verifier();
    const msg = signed();
    msg.Message = '{"eventType":"Complaint"}';
    await expect(v.verify(msg)).resolves.toBe(false);
  });

  it('rejects a cert URL that is not on an amazonaws SNS host, without fetching it', async () => {
    const { v, fetchText } = verifier();
    for (const url of [
      'https://evil.example/cert.pem',
      'http://sns.ap-south-1.amazonaws.com/cert.pem',
      'https://sns.ap-south-1.amazonaws.com.evil.example/cert.pem',
      'https://sns.ap-south-1.amazonaws.com/not-a-cert',
    ]) {
      await expect(v.verify(signed({ SigningCertURL: url }))).resolves.toBe(false);
    }
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('rejects an unknown SignatureVersion', async () => {
    const { v } = verifier();
    await expect(v.verify({ ...signed(), SignatureVersion: '3' })).resolves.toBe(false);
  });

  it('caches the signing certificate per URL', async () => {
    const { v, fetchText } = verifier();
    await v.verify(signed());
    await v.verify(signed({ MessageId: 'm-2' }));
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it('signs the confirmation key set for SubscriptionConfirmation', () => {
    const msg = signed({
      Type: 'SubscriptionConfirmation',
      SubscribeURL: 'https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription',
      Token: 'tok',
    });
    expect(stringToSign(msg)).toContain('SubscribeURL\nhttps://sns');
    expect(stringToSign(msg)).toContain('Token\ntok\n');
  });

  it('fetchText refuses non-SNS URLs', async () => {
    await expect(new SnsMessageVerifier().fetchText('https://evil.example/x')).rejects.toThrow(
      /non-SNS URL/,
    );
  });
});

describe('parseSnsMessage / isSnsUrl', () => {
  it('parses a text/plain string, a Buffer and an object', () => {
    const msg = signed();
    expect(parseSnsMessage(JSON.stringify(msg))).toEqual(msg);
    expect(parseSnsMessage(Buffer.from(JSON.stringify(msg)))).toEqual(msg);
    expect(parseSnsMessage(msg)).toEqual(msg);
  });

  it.each([undefined, '', 'not json', '{}', { Type: 'Notification' }])('rejects %j', (body) => {
    expect(parseSnsMessage(body)).toBeNull();
  });

  it('only accepts https SNS hosts', () => {
    expect(isSnsUrl('https://sns.us-east-1.amazonaws.com/x')).toBe(true);
    expect(isSnsUrl('https://sqs.us-east-1.amazonaws.com/x')).toBe(false);
    expect(isSnsUrl(undefined)).toBe(false);
  });
});
