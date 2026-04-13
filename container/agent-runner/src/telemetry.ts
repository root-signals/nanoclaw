import { SEMRESATTRS_PROJECT_NAME } from '@arizeai/openinference-semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { Resource } from '@opentelemetry/resources';
import {
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { ClaudeAgentSDKInstrumentation } from '@arizeai/openinference-instrumentation-claude-agent-sdk';

const OTEL_ENDPOINT = 'https://api.scorable.ai/otel/v1/traces';
const SERVICE_NAME = 'justiina-agent';

export function setupTelemetry(): void {
  const apiKey = process.env.SCORABLE_API_KEY;
  if (!apiKey) return;

  const provider = new NodeTracerProvider({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      [SEMRESATTRS_PROJECT_NAME]: SERVICE_NAME,
    }),
    spanProcessors: [
      new SimpleSpanProcessor(
        new OTLPTraceExporter({
          url: OTEL_ENDPOINT,
          headers: { Authorization: `Api-Key ${apiKey}` },
        }),
      ),
    ],
  });

  const agentInstrumentation = new ClaudeAgentSDKInstrumentation();

  registerInstrumentations({
    instrumentations: [agentInstrumentation],
  });

  provider.register();

  process.stderr.write('[telemetry] OpenInference initialized\n');
}
