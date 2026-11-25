package com.example.genwriter.observability;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Data
@Component
@ConfigurationProperties(prefix = "genwriter.observability")
public class ObservabilityProperties {

    private boolean enabled = true;
    private boolean tracePersistenceEnabled = true;
    private boolean metricsEnabled = true;
    private boolean sseTraceEnabled = true;
    private double successSampleRate = 1.0;
    private int retentionDays = 14;
    private int textSummaryLimit = 240;
    private boolean includeErrorDetails;
}
