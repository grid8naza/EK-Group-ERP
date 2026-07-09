import { Module } from '@nestjs/common';
import { DocumentNumberingController } from './document-numbering.controller';
import { DocumentNumberingService } from './document-numbering.service';

@Module({
  controllers: [DocumentNumberingController],
  providers: [DocumentNumberingService],
})
export class DocumentNumberingModule {}
