import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { generateStudyMaterialSchema, type GenerateStudyMaterialDto } from "@arutech/validation";
import { StudyMaterialsService } from "./study-materials.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("classes/study-materials")
@Controller("classes/:classId/study-materials")
export class StudyMaterialsController {
  constructor(private readonly studyMaterials: StudyMaterialsService) {}

  @Get("eligible-transcripts")
  listEligibleTranscripts(@CurrentUser() user: AuthenticatedUser, @Param("classId") classId: string) {
    return this.studyMaterials.listEligibleTranscripts(classId, user.id);
  }

  @Post()
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Param("classId") classId: string,
    @Body(new ZodValidationPipe(generateStudyMaterialSchema)) dto: GenerateStudyMaterialDto,
  ) {
    return this.studyMaterials.generate(classId, user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param("classId") classId: string) {
    return this.studyMaterials.list(classId, user.id);
  }

  @Get(":materialId")
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param("classId") classId: string,
    @Param("materialId") materialId: string,
  ) {
    return this.studyMaterials.getOne(classId, materialId, user.id);
  }

  @Post(":materialId/publish")
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param("classId") classId: string,
    @Param("materialId") materialId: string,
  ) {
    return this.studyMaterials.publish(classId, materialId, user.id);
  }

  @Delete(":materialId")
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("classId") classId: string,
    @Param("materialId") materialId: string,
  ) {
    return this.studyMaterials.remove(classId, materialId, user.id);
  }
}
