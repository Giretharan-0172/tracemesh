package com.tracemesh.producer.controller;

import com.tracemesh.producer.service.PipelineHealthService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/pipeline")
public class PipelineController {

    private final PipelineHealthService health;

    public PipelineController(PipelineHealthService health) {
        this.health = health;
    }

    /** Status of each infrastructure node, for the React dashboard's Pipeline page. */
    @GetMapping("/health")
    public Map<String, Object> health() {
        return health.check();
    }
}
