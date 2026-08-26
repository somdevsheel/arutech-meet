import { Module } from "@nestjs/common";
import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";
import { StorageModule } from "../storage/storage.module";
import { PermissionModule } from "../meetings/permission.module";
import { OrganizationsModule } from "../organizations/organizations.module";

@Module({
  imports: [StorageModule, PermissionModule, OrganizationsModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
