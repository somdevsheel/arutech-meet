import { Controller, Get, Header } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { MetricsService } from "./metrics.service";
import { Public } from "../common/decorators/public.decorator";

/** Scrape endpoint for Prometheus. Public (no JWT) by convention — in production
 * this should be reachable only from the cluster's internal network (a
 * NetworkPolicy or the Ingress simply not routing /metrics externally), not by
 * app-level auth, since Prometheus itself has no way to hold a user session. */
@ApiExcludeController()
@Controller("metrics")
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @Get()
  @Header("Content-Type", "text/plain")
  async getMetrics(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}
