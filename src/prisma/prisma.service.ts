import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: ['error'],
    });

    this.$use(async (params, next) => {
      if (params.action === 'create' || params.action === 'createMany') {
        const fillTimestamp = (item: any, model?: string) => {
          if (!item || typeof item !== 'object' || !model) {
            return;
          }

          if (model === 'AuditLog' && !item.timestamp) {
            item.timestamp = new Date();
          }

          if (model === 'AdminLoginHistory' && !item.loginTime) {
            item.loginTime = new Date();
          }

          if (model === 'EmployeeLoginHistory' && !item.loginTime) {
            item.loginTime = new Date();
          }
        };

        const payload = params.args?.data;
        if (Array.isArray(payload)) {
          payload.forEach((item) => fillTimestamp(item, params.model));
        } else {
          fillTimestamp(payload, params.model);
        }
      }

      return next(params);
    });
  }

  async onModuleInit() {
    await this.$connect();

    // Keep session timezone deterministic so NOW()/CURRENT_TIMESTAMP are UTC.
    await this.$executeRawUnsafe("SET TIME ZONE 'UTC'");
    const timezoneRow = await this.$queryRawUnsafe<Array<Record<string, unknown>>>('SHOW TIME ZONE');
    const timezone = String(Object.values(timezoneRow?.[0] ?? {})[0] ?? '');
    if (timezone.toUpperCase() !== 'UTC') {
      this.logger.warn(`Database session timezone is not UTC (current: ${timezone}).`);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Clean database for testing purposes
   * WARNING: This will delete all data!
   */
  async cleanDatabase() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Cannot clean database in production');
    }

    const models = Reflect.ownKeys(this).filter(
      (key) => 
        typeof key === 'string' && 
        !key.startsWith('_') && 
        !key.startsWith('$') &&
        typeof this[key as keyof this] === 'object'
    );

    return Promise.all(
      models.map((model) => {
        const delegate = this[model as keyof this];
        if (delegate && typeof delegate === 'object' && 'deleteMany' in delegate) {
          return (delegate as any).deleteMany();
        }
        return Promise.resolve();
      })
    );
  }
}
