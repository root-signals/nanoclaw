import { SEMRESATTRS_PROJECT_NAME } from '@arizeai/openinference-semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import {
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { ClaudeAgentSDKInstrumentation } from '@arizeai/openinference-instrumentation-claude-agent-sdk';
import * as ClaudeAgentSDKModule from '@anthropic-ai/claude-agent-sdk';

const OTEL_ENDPOINT = 'https://api.scorable.ai/otel/v1/traces';
const SERVICE_NAME = 'justiina-agent';

// Mutable copy — ESM namespace objects are read-only, manuallyInstrument needs to patch this
export const ClaudeAgentSDK = {
  ...ClaudeAgentSDKModule,
} as typeof ClaudeAgentSDKModule & Record<string, unknown>;

export function setupTelemetry(): void {
  const apiKey = process.env.SCORABLE_API_KEY;
  if (!apiKey) {
    process.stderr.write('[telemetry] No SCORABLE_API_KEY, skipping\n');
    return;
  }

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

    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: SERVICE_NAME,
        [SEMRESATTRS_PROJECT_NAME]: SERVICE_NAME,
      }),
      spanProcessors: [
        new SimpleSpanProcessor(otlpExporter),
        new SimpleSpanProcessor(new ConsoleSpanExporter()),
      ],
    });

    provider.register();

    const instrumentation = new ClaudeAgentSDKInstrumentation({
      tracerProvider: provider,
    });

    // Patch the mutable copy — index.ts must use ClaudeAgentSDK.query, not the raw import
    instrumentation.manuallyInstrument(ClaudeAgentSDK);

    process.stderr.write(
      '[telemetry] OpenInference initialized (manual instrumentation)\n',
    );
  } catch (err) {
    process.stderr.write(
      `[telemetry] Failed to initialize: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}
