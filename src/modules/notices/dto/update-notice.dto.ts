import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { CreateNoticeDto } from './create-notice.dto';

export class UpdateNoticeDto extends PartialType(CreateNoticeDto) {
	@ApiPropertyOptional({ description: '적용 공지 양식 ID', nullable: true })
	@IsOptional()
	@IsUUID()
	declare noticeTemplateId?: string | null;
}
