import { ConsoleLogger } from '@nestjs/common';

type PersistentAuditLoggerOptions = {
  source: string;
};

export class PersistentAuditLogger extends ConsoleLogger {
  constructor(options: PersistentAuditLoggerOptions) {
    super(options.source);
  }
}
