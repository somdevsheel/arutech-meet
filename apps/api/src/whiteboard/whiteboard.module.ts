import { Module } from "@nestjs/common";
import { WhiteboardController } from "./whiteboard.controller";
import { WhiteboardService } from "./whiteboard.service";
import { PermissionModule } from "../meetings/permission.module";

@Module({
  imports: [PermissionModule],
  controllers: [WhiteboardController],
  providers: [WhiteboardService],
  exports: [WhiteboardService],
})
export class WhiteboardModule {}
