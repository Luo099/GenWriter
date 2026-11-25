package com.example.genwriter.model.dto.response;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class ObservabilityHealthDTO {
    private long eventsLastHour;
    private long errorsLastHour;
    private double errorRatePercent;
    private double avgDurationMs;
    private String status;
}
