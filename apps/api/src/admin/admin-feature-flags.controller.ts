import { Body, Controller, Delete, Get, Param, Put, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { setFeatureFlagSchema, type SetFeatureFlagDto } from "@arutech/validation";
import { FeatureFlagsService, KNOWN_FEATURE_FLAG_KEYS } from "../feature-flags/feature-flags.service";
import { SystemAdminGuard } from "../common/guards/system-admin.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";

@ApiTags("admin")
@UseGuards(SystemAdminGuard)
@Controller("admin/feature-flags")
export class AdminFeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get()
  async list() {
    const flags = await this.flags.listAll();
    return { flags, knownKeys: KNOWN_FEATURE_FLAG_KEYS };
  }

  @Put(":key")
  setGlobal(@Param("key") key: string, @Body(new ZodValidationPipe(setFeatureFlagSchema)) dto: SetFeatureFlagDto) {
    return this.flags.setGlobal(key, dto.enabled, dto.description);
  }

  @Put(":key/organizations/:orgId")
  setOrgOverride(
    @Param("key") key: string,
    @Param("orgId") orgId: string,
    @Body(new ZodValidationPipe(setFeatureFlagSchema)) dto: SetFeatureFlagDto,
  ) {
    return this.flags.setOrgOverride(key, orgId, dto.enabled, dto.description);
  }

  @Delete(":key/organizations/:orgId")
  removeOrgOverride(@Param("key") key: string, @Param("orgId") orgId: string) {
    return this.flags.removeOrgOverride(key, orgId);
  }
}
