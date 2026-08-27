// Redacted, zero-dependency structured tracing for the Cardea harness.
// See ./tracer for the span emitter and ./redact for the redaction boundary.
export {
  withSpan,
  runWithCorrelationId,
  getCorrelationId,
  configureObservability,
  resetObservability,
  type SpanHandle,
  type EmittedSpan,
  type SpanStatus,
  type SpanEmitter,
  type ObservabilityClock,
} from "./tracer";
export {
  redactAttributes,
  redactValue,
  ALLOWED_ATTRIBUTE_KEYS,
  type SpanAttributes,
  type SpanAttributeValue,
} from "./redact";
