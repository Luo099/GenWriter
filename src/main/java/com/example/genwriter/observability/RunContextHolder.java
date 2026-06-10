package com.example.genwriter.observability;

import org.slf4j.MDC;

public final class RunContextHolder {

    private static final ThreadLocal<RunContext> CURRENT = new ThreadLocal<>();

    private RunContextHolder() {
    }

    public static void set(RunContext context) {
        CURRENT.set(context);
        if (context != null) {
            put("runId", context.runId());
            put("sessionId", context.sessionId());
        }
    }

    public static RunContext get() {
        return CURRENT.get();
    }

    public static String runIdOr(String fallback) {
        RunContext context = get();
        return context != null && context.runId() != null ? context.runId() : fallback;
    }

    public static String rootSpanId() {
        RunContext context = get();
        return context != null ? context.rootSpanId() : null;
    }

    public static void putSpan(String spanId) {
        put("spanId", spanId);
    }

    public static void putWorker(String worker) {
        put("worker", worker);
    }

    public static void putModel(String provider, String model) {
        put("provider", provider);
        put("model", model);
    }

    public static void putEvent(String event) {
        put("event", event);
    }

    public static void clearSpan() {
        MDC.remove("spanId");
        MDC.remove("worker");
    }

    public static void clear() {
        CURRENT.remove();
        MDC.remove("runId");
        MDC.remove("sessionId");
        MDC.remove("spanId");
        MDC.remove("worker");
        MDC.remove("provider");
        MDC.remove("model");
        MDC.remove("event");
    }

    private static void put(String key, String value) {
        if (value == null || value.isBlank()) {
            MDC.remove(key);
        } else {
            MDC.put(key, value);
        }
    }
}
