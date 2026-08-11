import { Module } from "@nestjs/common";
import { ClassesController } from "./classes.controller";
import { ClassesService } from "./classes.service";
import { AttendanceController } from "./attendance.controller";
import { AttendanceService } from "./attendance.service";

@Module({
  controllers: [ClassesController, AttendanceController],
  providers: [ClassesService, AttendanceService],
  exports: [ClassesService, AttendanceService],
})
export class ClassesModule {}
