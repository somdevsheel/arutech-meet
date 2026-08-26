import { Module } from "@nestjs/common";
import { WhiteboardController } from "./whiteboard.controller";
import { WhiteboardService } from "./whiteboard.service";
import { PermissionModule } from "../meetings/permission.module";
import { FeatureFlagsModule } from "../feature-flags/feature-flags.module";

@Module({
  imports: [PermissionModule, FeatureFlagsModule],
  controllers: [WhiteboardController],
  providers: [WhiteboardService],
  exports: [WhiteboardService],
})
export class WhiteboardModule {}
