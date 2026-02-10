import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: ['error'],
    });
  }

  async onModuleInit() {
    await this.$connect();
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
