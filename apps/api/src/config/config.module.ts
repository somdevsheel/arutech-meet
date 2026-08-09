import { Global, Module } from "@nestjs/common";
import { validateEnv, type Env } from "@arutech/config";
import { TokenService } from "../common/lib/tokens";

const envProvider = {
  provide: "ENV",
  useFactory: (): Env => validateEnv(process.env),
};

const tokenServiceProvider = {
  provide: TokenService,
  useFactory: (env: Env) => new TokenService(env),
  inject: ["ENV"],
};

/** Global module providing the validated `Env` object under the "ENV" token. */
@Global()
@Module({
  providers: [envProvider, tokenServiceProvider],
  exports: [envProvider, tokenServiceProvider],
})
export class ConfigModule {}
