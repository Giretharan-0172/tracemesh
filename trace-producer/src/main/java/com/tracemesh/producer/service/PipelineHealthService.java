package com.tracemesh.producer.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.kafka.clients.admin.AdminClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaAdmin;
import org.springframework.stereotype.Service;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

/**
 * Probes the infrastructure behind the pipeline (Kafka, Spark, HDFS, Hive) for the dashboard's
 * status page. Read-only: it is not in the metrics path, which stays Spark -> /api/metrics/ingest.
 */
@Service
public class PipelineHealthService {

    private static final Duration TIMEOUT = Duration.ofSeconds(2);

    private final KafkaAdmin kafkaAdmin;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(TIMEOUT).build();
    private final ObjectMapper mapper = new ObjectMapper();

    @Value("${tracemesh.kafka.topic}")
    private String topic;
    @Value("${SPARK_MASTER_UI_URL:http://spark-master:8080}")
    private String sparkMasterUrl;
    @Value("${NAMENODE_UI_URL:http://namenode:9870}")
    private String namenodeUrl;
    @Value("${HIVE_HOST:hive-server}")
    private String hiveHost;
    @Value("${HIVE_PORT:10000}")
    private int hivePort;

    public PipelineHealthService(KafkaAdmin kafkaAdmin) {
        this.kafkaAdmin = kafkaAdmin;
    }

    public Map<String, Object> check() {
        // Probe in parallel so one unreachable node doesn't stall the whole check
        List<Supplier<Map<String, Object>>> probes = List.of(this::kafka, this::spark, this::hdfs, this::hive);
        List<CompletableFuture<Map<String, Object>>> futures = new ArrayList<>();
        for (Supplier<Map<String, Object>> probe : probes) futures.add(CompletableFuture.supplyAsync(probe));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("checkedAt", Instant.now().toString());
        out.put("stages", futures.stream().map(CompletableFuture::join).toList());
        return out;
    }

    private Map<String, Object> kafka() {
        try (AdminClient admin = AdminClient.create(kafkaAdmin.getConfigurationProperties())) {
            int brokers = admin.describeCluster().nodes().get(3, TimeUnit.SECONDS).size();
            int partitions = admin.describeTopics(List.of(topic)).allTopicNames().get(3, TimeUnit.SECONDS)
                    .get(topic).partitions().size();
            return stage("kafka", "Kafka", "KRaft broker", "up",
                    brokers + " broker, topic " + topic + " (" + partitions + " partitions)");
        } catch (Exception e) {
            return stage("kafka", "Kafka", "KRaft broker", "down", rootMessage(e));
        }
    }

    private Map<String, Object> spark() {
        try {
            JsonNode json = getJson(sparkMasterUrl + "/json/");
            int workers = json.path("aliveworkers").asInt(json.path("workers").size());
            boolean jobRunning = false;
            for (JsonNode app : json.path("activeapps")) {
                jobRunning |= app.path("name").asText().contains("TraceMesh");
            }
            String status = workers > 0 && jobRunning ? "up" : "degraded";
            return stage("spark", "Spark Streaming", "Structured Streaming", status,
                    workers + " worker(s), " + (jobRunning ? "streaming job running" : "streaming job not running"));
        } catch (Exception e) {
            return stage("spark", "Spark Streaming", "Structured Streaming", "down", rootMessage(e));
        }
    }

    private Map<String, Object> hdfs() {
        try {
            JsonNode bean = getJson(namenodeUrl + "/jmx?qry=Hadoop:service=NameNode,name=FSNamesystemState")
                    .path("beans").path(0);
            int live = bean.path("NumLiveDataNodes").asInt();
            long usedMb = bean.path("CapacityUsed").asLong() / (1024 * 1024);
            return stage("hdfs", "HDFS", "NameNode + DataNode", live > 0 ? "up" : "degraded",
                    live + " live datanode(s), " + usedMb + " MB used");
        } catch (Exception e) {
            return stage("hdfs", "HDFS", "NameNode + DataNode", "down", rootMessage(e));
        }
    }

    private Map<String, Object> hive() {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(hiveHost, hivePort), (int) TIMEOUT.toMillis());
            return stage("hive", "Hive", "HiveServer2", "up", "Accepting connections on :" + hivePort);
        } catch (Exception e) {
            return stage("hive", "Hive", "HiveServer2", "down", rootMessage(e));
        }
    }

    private JsonNode getJson(String url) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(url)).timeout(TIMEOUT).GET().build();
        HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() >= 400) throw new IllegalStateException("HTTP " + res.statusCode() + " from " + url);
        return mapper.readTree(res.body());
    }

    private static Map<String, Object> stage(String id, String name, String tech, String status, String detail) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("name", name);
        m.put("tech", tech);
        m.put("status", status);
        m.put("detail", detail);
        return m;
    }

    private static String rootMessage(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null) t = t.getCause();
        if (t instanceof java.nio.channels.UnresolvedAddressException || t instanceof java.net.UnknownHostException) {
            return "Host not found (is the container running?)";
        }
        if (t instanceof java.net.ConnectException) return "Connection refused (still starting?)";
        if (t instanceof java.net.http.HttpTimeoutException || t instanceof java.net.SocketTimeoutException
                || t instanceof java.util.concurrent.TimeoutException) return "Timed out";
        String msg = t.getMessage();
        return msg == null ? t.getClass().getSimpleName() : msg;
    }
}
