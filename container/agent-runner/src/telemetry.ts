import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { ClaudeAgentSDKInstrumentation } from '@arizeai/openinference-instrumentation-claude-agent-sdk';

const OTEL_ENDPOINT = 'https://api.scorable.ai/otel/v1/traces';

export interface TelemetryHandle {
  instrumentation: ClaudeAgentSDKInstrumentation;
  shutdown: () => Promise<void>;
}

export function setupTelemetry(
  sdkModule: Record<string, unknown>,
): TelemetryHandle | null {
  const apiKey = process.env.SCORABLE_API_KEY;
  if (!apiKey) return null;

  const exporter = new OTLPTraceExporter({
    url: OTEL_ENDPOINT,
    headers: { Authorization: `Api-Key ${apiKey}` },
  });

  const instrumentation = new ClaudeAgentSDKInstrumentation();
  instrumentation.manuallyInstrument(sdkModule);

  const sdk = new NodeSDK({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
    instrumentations: [instrumentation],
  });

  sdk.start();

  return {
    instrumentation,
    shutdown: () => sdk.shutdown(),
  };
}
