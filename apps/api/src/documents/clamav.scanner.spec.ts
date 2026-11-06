import { createServer, Server, Socket } from 'net';
import type { AddressInfo } from 'net';
import { ClamAvScanner, parseReply } from './clamav.scanner';

/**
 * In-process fake clamd: parses the real zINSTREAM framing, reassembles the
 * streamed bytes, and hands them to `reply` to decide the answer — so the
 * test exercises the actual wire protocol, not a mocked socket.
 */
function fakeClamd(reply: (received: Buffer) => string | null) {
  let received = Buffer.alloc(0);
  const server: Server = createServer((socket: Socket) => {
    let buf = Buffer.alloc(0);
    let commandRead = false;
    const chunks: Buffer[] = [];
    socket.on('data', (data) => {
      buf = Buffer.concat([buf, data]);
      if (!commandRead) {
        const nul = buf.indexOf(0);
        if (nul === -1) return;
        expect(buf.subarray(0, nul).toString()).toBe('zINSTREAM');
        buf = buf.subarray(nul + 1);
        commandRead = true;
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          received = Buffer.concat(chunks);
          const answer = reply(received);
          if (answer === null) socket.destroy();
          else socket.end(`${answer}\0`);
          return;
        }
        if (buf.length < 4 + len) return;
        chunks.push(buf.subarray(4, 4 + len));
        buf = buf.subarray(4 + len);
      }
    });
  });
  return {
    server,
    received: () => received,
    listen: () =>
      new Promise<number>((resolve) =>
        server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)),
      ),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function scannerFor(port: number, timeoutMs = 2000) {
  const config = { get: () => ({ host: '127.0.0.1', port, timeoutMs }) };
  return new ClamAvScanner(config as any);
}

describe('ClamAvScanner (against a fake clamd)', () => {
  it('streams the whole file across multiple chunks and reports OK as clean', async () => {
    const clamd = fakeClamd(() => 'stream: OK');
    const port = await clamd.listen();
    const content = Buffer.alloc(200 * 1024, 7); // > one 64 KB chunk
    try {
      await expect(scannerFor(port).scan(content)).resolves.toEqual({ clean: true });
      expect(clamd.received().equals(content)).toBe(true);
    } finally {
      await clamd.close();
    }
  });

  it('reports FOUND with the signature name', async () => {
    const clamd = fakeClamd(() => 'stream: Eicar-Signature FOUND');
    const port = await clamd.listen();
    try {
      await expect(scannerFor(port).scan(Buffer.from('x'))).resolves.toEqual({
        clean: false,
        signature: 'Eicar-Signature',
      });
    } finally {
      await clamd.close();
    }
  });

  it('rejects on an ERROR reply — never reports an unscanned file clean', async () => {
    const clamd = fakeClamd(() => 'INSTREAM size limit exceeded. ERROR');
    const port = await clamd.listen();
    try {
      await expect(scannerFor(port).scan(Buffer.from('x'))).rejects.toThrow(
        /Unexpected clamd reply/,
      );
    } finally {
      await clamd.close();
    }
  });

  it('rejects when clamd drops the connection without replying', async () => {
    const clamd = fakeClamd(() => null);
    const port = await clamd.listen();
    try {
      await expect(scannerFor(port).scan(Buffer.from('x'))).rejects.toThrow();
    } finally {
      await clamd.close();
    }
  });

  it('rejects when clamd is unreachable', async () => {
    const clamd = fakeClamd(() => 'stream: OK');
    const port = await clamd.listen();
    await clamd.close(); // nothing listening on this port now
    await expect(scannerFor(port).scan(Buffer.from('x'))).rejects.toThrow();
  });
});

describe('parseReply', () => {
  it('parses OK, FOUND and rejects anything else', () => {
    expect(parseReply('stream: OK\0')).toEqual({ clean: true });
    expect(parseReply('stream: Win.Test.EICAR_HDB-1 FOUND\0')).toEqual({
      clean: false,
      signature: 'Win.Test.EICAR_HDB-1',
    });
    expect(() => parseReply('')).toThrow();
    expect(() => parseReply('stream: lstat() failed ERROR')).toThrow();
  });
});
