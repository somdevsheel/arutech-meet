import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { MetricsService } from "./metrics.service";
import { MetricsController } from "./metrics.controller";
import { MetricsInterceptor } from "./metrics.interceptor";
import { MetricsUpdaterService } from "./metrics-updater.service";

/** Global so MetricsService can be injected anywhere (RealtimeGateway's
 * connection-count gauge, RecordingsEventsService's failure counter) without
 * every consuming module needing to import this one explicitly. */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    MetricsUpdaterService,
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
  exports: [MetricsService],
})
export class ObservabilityModule {}
