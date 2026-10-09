import { Module } from '@nestjs/common';
import { OperationalWriteGateService } from './operational-write-gate.service.js';
@Module({
  providers: [OperationalWriteGateService],
  exports: [OperationalWriteGateService],
})
export class OperationControlModule {}
