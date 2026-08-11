import { Module } from "@nestjs/common";
import { QuizzesController } from "./quizzes.controller";
import { QuizzesService } from "./quizzes.service";
import { PermissionModule } from "../meetings/permission.module";
import { RealtimeBroadcastModule } from "../realtime/realtime-broadcast.module";

@Module({
  imports: [PermissionModule, RealtimeBroadcastModule],
  controllers: [QuizzesController],
  providers: [QuizzesService],
  exports: [QuizzesService],
})
export class QuizzesModule {}
