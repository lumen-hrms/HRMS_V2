import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect } from 'net';
import type { AppConfig } from '../config/configuration';

export type ScanResult = { clean: true } | { clean: false; signature: string };

const CHUNK_SIZE = 64 * 1024;

/**
 * Minimal clamd client over TCP using the `zINSTREAM` command — no npm
 * dependency. Protocol: send `zINSTREAM\0`, then the file as
 * `<uint32 BE length><bytes>` chunks, then a zero-length chunk; clamd
 * replies with one NUL-terminated line: `stream: OK`,
 * `stream: <signature> FOUND`, or `... ERROR`.
 *
 * Throws on any connection/protocol error or ERROR reply, so the caller's
 * BullMQ job retries — a scan that didn't happen is never reported clean.
 */
@Injectable()
export class ClamAvScanner {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<AppConfig, true>) {
    const clamav = config.get('clamav', { infer: true });
    this.host = clamav.host;
    this.port = clamav.port;
    this.timeoutMs = clamav.timeoutMs;
  }

  scan(content: Buffer): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      const replyChunks: Buffer[] = [];
      let settled = false;
      const finish = (err: Error | null, result?: ScanResult) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (err) reject(err);
        else resolve(result!);
      };

      socket.setTimeout(this.timeoutMs, () => finish(new Error('clamd scan timed out')));
      socket.on('error', (err) => finish(err));
      socket.on('data', (chunk) => replyChunks.push(chunk));
      socket.on('end', () => {
        try {
          finish(null, parseReply(Buffer.concat(replyChunks).toString('utf8')));
        } catch (err) {
          finish(err as Error);
        }
      });

      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        for (let offset = 0; offset < content.length; offset += CHUNK_SIZE) {
          const chunk = content.subarray(offset, offset + CHUNK_SIZE);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(chunk.length, 0);
          socket.write(len);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4)); // zero-length chunk = end of stream
      });
    });
  }
}

export function parseReply(raw: string): ScanResult {
  const reply = raw.replace(/\0/g, '').trim();
  if (/:\s*OK$/.test(reply)) return { clean: true };
  const found = /:\s*(.+)\s+FOUND$/.exec(reply);
  if (found) return { clean: false, signature: found[1] };
  throw new Error(`Unexpected clamd reply: "${reply || '<empty>'}"`);
}
