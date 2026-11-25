package com.example.genwriter.observability;

import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

@Component
public class ObservabilitySanitizer {

    private static final String REDACTED = "[REDACTED]";
    private static final String OMITTED = "[OMITTED]";

    public Object sanitize(Object value) {
        return sanitize(value, 240);
    }

    public Object sanitize(Object value, int limit) {
        if (value == null) {
            return null;
        }
        if (value instanceof String text) {
            return sanitizeText(text, limit);
        }
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> sanitized = new LinkedHashMap<>();
            map.forEach((key, val) -> {
                String stringKey = String.valueOf(key);
                sanitized.put(stringKey, shouldRedactKey(stringKey)
                        ? REDACTED
                        : sanitize(val, limit));
            });
            return sanitized;
        }
        if (value instanceof Iterable<?> iterable) {
            int count = 0;
            for (Object ignored : iterable) {
                count++;
            }
            return Map.of("count", count);
        }
        return value;
    }

    public String sanitizeError(String error, boolean includeDetails) {
        if (error == null) {
            return null;
        }
        if (!includeDetails) {
            return OMITTED;
        }
        return sanitizeText(error, 360);
    }

    private boolean shouldRedactKey(String key) {
        String normalized = key == null ? "" : key.toLowerCase(Locale.ROOT);
        return normalized.contains("key")
                || normalized.contains("secret")
                || normalized.contains("token")
                || normalized.contains("authorization")
                || normalized.contains("password")
                || normalized.contains("prompt")
                || normalized.contains("content")
                || normalized.contains("reasoning");
    }

    private String sanitizeText(String text, int limit) {
        String normalized = text == null ? "" : text.replaceAll("\\s+", " ").trim();
        normalized = normalized
                .replaceAll("sk-[A-Za-z0-9_\\-]{8,}", REDACTED)
                .replaceAll("tvly-[A-Za-z0-9_\\-]{8,}", REDACTED)
                .replaceAll("(?i)(api[_-]?key|authorization|bearer|password)\\s*[:=]\\s*[^,\\s}]+", "$1=" + REDACTED);
        int max = Math.max(1, limit);
        return normalized.length() <= max ? normalized : normalized.substring(0, max) + "...";
    }
}
