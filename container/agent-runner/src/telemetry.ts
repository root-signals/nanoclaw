import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { ClaudeAgentSDKInstrumentation } from '@arizeai/openinference-instrumentation-claude-agent-sdk';
import * as OriginalSDK from '@anthropic-ai/claude-agent-sdk';

const OTEL_ENDPOINT = 'https://api.scorable.ai/otel/v1/traces';
const SERVICE_NAME = 'justiina-agent';

// Re-export a mutable copy of the SDK. manuallyInstrument patches this object
// in-place, so index.ts must import `query` from here instead of the SDK directly.
const mutableSDK: Record<string, any> = { ...OriginalSDK };

let _provider: NodeTracerProvider | null = null;
const apiKey = process.env.SCORABLE_API_KEY;

if (apiKey) {
  try {
    const otlpExporter = new OTLPTraceExporter({
      url: OTEL_ENDPOINT,
      headers: { Authorization: `Api-Key ${apiKey}` },
    });

    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: SERVICE_NAME,
        'openinference.project.name': SERVICE_NAME,
      }),
      spanProcessors: [new SimpleSpanProcessor(otlpExporter)],
    });

    provider.register();
    _provider = provider;

    const instrumentation = new ClaudeAgentSDKInstrumentation({
      tracerProvider: provider,
    });
    instrumentation.manuallyInstrument(mutableSDK as typeof OriginalSDK);
  } catch (err) {
    process.stderr.write(
      `[telemetry] Failed to initialize: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

export const query = mutableSDK.query as typeof OriginalSDK.query;

export async function shutdownTelemetry(): Promise<void> {
  if (_provider) {
    await _provider.forceFlush();
    await _provider.shutdown();
    _provider = null;
  }
}
