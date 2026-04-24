import { Global, Module } from '@nestjs/common';
import { ContentTranslationService } from './translation.service';

@Global()
@Module({
  providers: [ContentTranslationService],
  exports: [ContentTranslationService],
})
export class TranslationModule {}