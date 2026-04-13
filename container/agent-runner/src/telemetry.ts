import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { ClaudeAgentSDKInstrumentation } from '@arizeai/openinference-instrumentation-claude-agent-sdk';
import * as OriginalSDK from '@anthropic-ai/claude-agent-sdk';

const OTEL_ENDPOINT = 'https://api.scorable.ai/otel/v1/traces';
const SERVICE_NAME = 'justiina-agent';

// Re-export a mutable copy of the SDK. manuallyInstrument patches this object
// in-place, so index.ts must import `query` from here instead of the SDK directly.
const mutableSDK: Record<string, any> = { ...OriginalSDK };

const apiKey = process.env.SCORABLE_API_KEY;

if (apiKey) {
  try {
    process.stderr.write(
      `[telemetry] Initializing with endpoint=${OTEL_ENDPOINT}\n`,
    );

    const otlpExporter = new OTLPTraceExporter({
      url: OTEL_ENDPOINT,
      headers: { Authorization: `Api-Key ${apiKey}` },
    });

    // Debug: log export results
    const origExport = otlpExporter.export.bind(otlpExporter);
    otlpExporter.export = (spans: any, resultCallback: any) => {
      process.stderr.write(
        `[telemetry] Exporting ${spans.length} span(s) to ${OTEL_ENDPOINT}\n`,
      );
      return origExport(spans, (result: any) => {
        process.stderr.write(
          `[telemetry] Export result: code=${result.code} error=${result.error || 'none'}\n`,
        );
        resultCallback(result);
      });
    };

    // Console exporter for debugging — remove once traces are confirmed flowing
    const consoleExporter = new ConsoleSpanExporter();

    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: SERVICE_NAME,
        'openinference.project.name': SERVICE_NAME,
      }),
      spanProcessors: [
        new SimpleSpanProcessor(otlpExporter),
        new SimpleSpanProcessor(consoleExporter),
      ],
    });

    provider.register();

    const instrumentation = new ClaudeAgentSDKInstrumentation({
      tracerProvider: provider,
    });
    instrumentation.manuallyInstrument(
      mutableSDK as typeof OriginalSDK,
    );

    process.stderr.write(
      `[telemetry] OpenInference initialized, query patched: ${mutableSDK.query?.name !== OriginalSDK.query?.name}\n`,
    );
  } catch (err) {
    process.stderr.write(
      `[telemetry] Failed to initialize: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
} else {
  process.stderr.write('[telemetry] No SCORABLE_API_KEY, skipping\n');
}

// Export the (possibly patched) query function for use by index.ts
export const query = mutableSDK.query as typeof OriginalSDK.query;
