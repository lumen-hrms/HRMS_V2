import { ConsoleLogger, type LogLevel } from '@nestjs/common';

/**
 * Nest's console logger, reshaped into the one-line format Spring/SLF4J
 * users expect:
 *
 *   2026-10-30 13:06:23.123  INFO 3331854 --- [LeaveService          ] : Leave request approved
 *
 * and with the framework's startup chatter (one line per module and per
 * route mapped) dropped, so what's left is the app's own events. Those
 * startup lines are still printed if they're warnings or errors.
 */
const STARTUP_NOISE = new Set(['InstanceLoader', 'RoutesResolver', 'RouterExplorer']);
const CONTEXT_WIDTH = 22;

const LEVEL_LABEL: Record<LogLevel, string> = {
  log: 'INFO',
  error: 'ERROR',
  warn: 'WARN',
  debug: 'DEBUG',
  verbose: 'TRACE',
  fatal: 'FATAL',
};

export class AppLogger extends ConsoleLogger {
  protected printMessages(
    messages: unknown[],
    context = '',
    logLevel: LogLevel = 'log',
    writeStreamType?: 'stdout' | 'stderr',
  ) {
    if (logLevel === 'log' && STARTUP_NOISE.has(context)) return;
    super.printMessages(messages, context, logLevel, writeStreamType);
  }

  protected getTimestamp(): string {
    const d = new Date();
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return (
      `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
      `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
    );
  }

  protected formatContext(context: string): string {
    const name =
      context.length > CONTEXT_WIDTH
        ? context.slice(0, CONTEXT_WIDTH)
        : context.padEnd(CONTEXT_WIDTH);
    return `--- [${name}] : `;
  }

  protected formatMessage(
    logLevel: LogLevel,
    message: unknown,
    _pidMessage: string,
    _formattedLogLevel: string,
    contextMessage: string,
  ): string {
    const level = this.colorize(LEVEL_LABEL[logLevel].padStart(5), logLevel);
    const output = this.stringifyMessage(message, logLevel);
    return `${this.getTimestamp()} ${level} ${process.pid} ${contextMessage || '--- : '}${output}\n`;
  }
}
