import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ReturnReviewDecision } from '../../generated/prisma/client.js';
export class ReviewReturnDto {
  @ApiProperty({ enum: ReturnReviewDecision })
  @IsEnum(ReturnReviewDecision)
  decision!: ReturnReviewDecision;
  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;
}
