package com.example.genwriter.config;

import org.springframework.ai.model.function.DefaultFunctionCallbackResolver;
import org.springframework.ai.model.function.FunctionCallbackResolver;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class FunctionCallbackResolverConfig {

    @Bean
    @ConditionalOnMissingBean(FunctionCallbackResolver.class)
    public FunctionCallbackResolver functionCallbackResolver() {
        return new DefaultFunctionCallbackResolver();
    }
}
