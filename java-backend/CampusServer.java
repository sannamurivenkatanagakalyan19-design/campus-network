import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.stream.Collectors;

public class CampusServer {
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");
    private static final DateTimeFormatter DATE = DateTimeFormatter.ISO_LOCAL_DATE;
    private static final DateTimeFormatter DISPLAY = DateTimeFormatter.ofPattern("MMM d, HH:mm");
    private static final Map<String, String> ADMIN_CREDENTIALS = Map.of(
            "admin001", "Admin@123", "securityadmin", "Secure@123",
            "kalyansannamuri", "kalyan@2007");
    private static Path root;
    private static MonitoringService monitoring;
    private static AdminService admins;

    public static void main(String[] args) throws Exception {
        root = Path.of(args.length > 0 ? args[0] : ".").toAbsolutePath().normalize();
        Files.createDirectories(root.resolve("data"));
        monitoring = new MonitoringService(root.resolve("data"));
        admins = new AdminService(root);
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"));
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/", CampusServer::handle);
        server.setExecutor(Executors.newCachedThreadPool());
        server.start();
        System.out.println("Campus Login Security is running at http://localhost:" + port);
        System.out.println("Synthetic data directory: " + root.resolve("data"));
    }

    private static void handle(HttpExchange exchange) throws IOException {
        try {
            String path = exchange.getRequestURI().getPath();
            if (path.startsWith("/api/")) {
                handleApi(exchange, path);
                return;
            }
            if ((path.equals("/admin") || path.startsWith("/admin/")) && !admins.authenticated(exchange)) {
                redirect(exchange, "/admin-login");
                return;
            }
            servePage(exchange, path);
        } catch (Exception exception) {
            sendJson(exchange, 500, Map.of("error", "The local monitoring service encountered an error."));
            exception.printStackTrace();
        }
    }

    private static void handleApi(HttpExchange exchange, String path) throws Exception {
        if (path.equals("/api/login") && exchange.getRequestMethod().equals("POST")) {
            Map<String, String> form = readForm(exchange);
            String role = form.getOrDefault("role", "").toLowerCase(Locale.ROOT);
            String username = form.getOrDefault("username", "").trim();
            String password = form.getOrDefault("password", "");
            if (role.equals("admin")) {
                if (!password.equals(ADMIN_CREDENTIALS.get(username))) {
                    sendJson(exchange, 401, Map.of("error", "The username or password was not recognized."));
                    return;
                }
                admins.createSession(exchange);
                sendJson(exchange, 200, Map.of("ok", true, "redirect", "/admin"));
                return;
            }
            if (!role.equals("student") && !role.equals("staff")) {
                sendJson(exchange, 400, Map.of("error", "Choose a valid campus portal."));
                return;
            }
            boolean accountExists = role.equals("student")
                    ? username.matches("student(00[1-9]|0[1-9][0-9]|100)")
                    : username.matches("staff(00[1-9]|0[1-9][0-9]|030)");
            boolean success = accountExists && password.equals("Campus@123");
                LoginEvent event = monitoring.recordLogin(accountExists ? username : "", role, success);
            if (!success) {
                sendJson(exchange, 401, Map.of("error", "Login unsuccessful. Check your details and try again."));
                return;
            }
            String message = event.suspicious
                    ? "Login received. For your security, additional verification may be required."
                    : "You are signed in to the synthetic campus portal.";
            sendJson(exchange, 200, Map.of("ok", true, "message", message));
            return;
        }
        if (path.equals("/api/logout")) {
            admins.clearSession(exchange);
            sendJson(exchange, 200, Map.of("ok", true));
            return;
        }
        if (path.startsWith("/api/admin/") && !admins.authenticated(exchange)) {
            sendJson(exchange, 401, Map.of("error", "Admin session required."));
            return;
        }
        switch (path) {
            case "/api/admin/dashboard" -> sendJson(exchange, 200, monitoring.dashboard());
            case "/api/admin/events" -> sendJson(exchange, 200, monitoring.filteredEvents(exchange.getRequestURI().getRawQuery()));
            case "/api/admin/graph" -> sendJson(exchange, 200, monitoring.graph(queryValue(exchange, "role"), exchange.getRequestURI().getRawQuery()));
            case "/api/admin/alerts" -> sendJson(exchange, 200, monitoring.alerts());
            case "/api/admin/analyze" -> sendJson(exchange, 200, admins.runAnalysis());
            case "/api/admin/download" -> monitoring.download(exchange);
            default -> sendJson(exchange, 404, Map.of("error", "API route not found."));
        }
    }

    private static void servePage(HttpExchange exchange, String route) throws IOException {
        String page = switch (route) {
            case "/", "/index.html" -> "index.html";
            case "/student-login" -> "portal.html";
            case "/staff-login" -> "portal.html";
            case "/admin-login" -> "admin-login.html";
            case "/admin" -> "admin.html";
            case "/admin/student-graph" -> "graph.html";
            case "/admin/staff-graph" -> "graph.html";
            case "/admin/alerts" -> "alerts.html";
            case "/admin/dmgt" -> "dmgt.html";
                    default -> route.startsWith("/assets/") ? route.substring(1) : "index.html";
        };
        Path file = root.resolve("frontend").resolve(page).normalize();
        if (!file.startsWith(root.resolve("frontend")) || !Files.isRegularFile(file)) {
            exchange.sendResponseHeaders(404, -1);
            exchange.close();
            return;
        }
        String type = page.endsWith(".css") ? "text/css; charset=utf-8"
                : page.endsWith(".js") ? "application/javascript; charset=utf-8" : "text/html; charset=utf-8";
        byte[] bytes = Files.readAllBytes(file);
        exchange.getResponseHeaders().set("Content-Type", type);
        exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        exchange.sendResponseHeaders(200, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

    private static Map<String, String> readForm(HttpExchange exchange) throws IOException {
        String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        Map<String, String> form = new HashMap<>();
        for (String pair : body.split("&")) {
            String[] parts = pair.split("=", 2);
            if (parts.length == 2) form.put(URLDecoder.decode(parts[0], StandardCharsets.UTF_8), URLDecoder.decode(parts[1], StandardCharsets.UTF_8));
        }
        return form;
    }

    private static String queryValue(HttpExchange exchange, String key) {
        return query(exchange.getRequestURI().getRawQuery()).getOrDefault(key, "");
    }

    private static Map<String, String> query(String raw) {
        Map<String, String> values = new HashMap<>();
        if (raw == null) return values;
        for (String pair : raw.split("&")) {
            String[] parts = pair.split("=", 2);
            if (parts.length == 2) values.put(URLDecoder.decode(parts[0], StandardCharsets.UTF_8), URLDecoder.decode(parts[1], StandardCharsets.UTF_8));
        }
        return values;
    }

    private static void sendJson(HttpExchange exchange, int status, Object payload) throws IOException {
        byte[] bytes = Json.stringify(payload).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

    private static void redirect(HttpExchange exchange, String target) throws IOException {
        exchange.getResponseHeaders().set("Location", target);
        exchange.sendResponseHeaders(302, -1);
        exchange.close();
    }

    abstract static class User {
        private final String id;
        private final String name;
        private final String role;

        User(String id, String name, String role) { this.id = id; this.name = name; this.role = role; }
        String id() { return id; }
        String name() { return name; }
        String role() { return role; }
        abstract String affiliation();
    }

    static final class Student extends User {
        Student(String id) { super(id, studentName(id), "student"); }
        @Override String affiliation() { return "School of " + List.of("Engineering", "Arts", "Computing", "Science").get(Math.floorMod(id().hashCode(), 4)); }
    }

    static final class Staff extends User {
        Staff(String id) { super(id, staffName(id), "staff"); }
        @Override String affiliation() { return List.of("Library Services", "Admissions", "Research Office", "Campus Operations").get(Math.floorMod(id().hashCode(), 4)); }
    }

    static final class Device {
        final String id;
        final String name;
        final String type;
        final String roleGroup;
        Device(String id, String name, String type, String roleGroup) { this.id = id; this.name = name; this.type = type; this.roleGroup = roleGroup; }
    }

    static final class LoginEvent {
        final String eventId, userId, userName, role, deviceId, deviceName, deviceType, loginTime, loginDate, ipAddress, location, loginStatus;
        final boolean newDevice, generated;
        boolean suspicious;
        String ruleName = "", conditions = "", reason = "", riskLevel = "Low", action = "";
        LoginEvent(String eventId, String userId, String userName, String role, String deviceId, String deviceName, String deviceType,
                   String loginTime, String loginDate, String ipAddress, String location, String loginStatus, boolean newDevice, boolean generated) {
            this.eventId = eventId; this.userId = userId; this.userName = userName; this.role = role; this.deviceId = deviceId;
            this.deviceName = deviceName; this.deviceType = deviceType; this.loginTime = loginTime; this.loginDate = loginDate;
            this.ipAddress = ipAddress; this.location = location; this.loginStatus = loginStatus; this.newDevice = newDevice;
            this.generated = generated; this.suspicious = false;
        }
        Map<String, Object> asMap() {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("event_id", eventId); row.put("user_id", userId); row.put("user_name", userName); row.put("role", role);
            row.put("device_id", deviceId); row.put("device_name", deviceName); row.put("device_type", deviceType);
            row.put("login_time", loginTime); row.put("login_date", loginDate); row.put("ip_address", ipAddress); row.put("location", location);
            row.put("login_status", loginStatus); row.put("is_new_device", newDevice); row.put("suspicious", suspicious);
            row.put("rule_name", ruleName); row.put("conditions", conditions); row.put("reason", reason); row.put("risk_level", riskLevel); row.put("suggested_action", action);
            return row;
        }
    }

    interface SecurityRule { Alert evaluate(LoginEvent event, MonitoringService service); }

    static final class Alert {
        final String ruleName, conditions, riskLevel, reason, action;
        final LoginEvent event;
        Alert(String ruleName, String conditions, String riskLevel, String reason, String action, LoginEvent event) {
            this.ruleName = ruleName; this.conditions = conditions; this.riskLevel = riskLevel; this.reason = reason; this.action = action; this.event = event;
        }
        Map<String, Object> asMap() {
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("rule_name", ruleName); result.put("conditions", conditions); result.put("risk_level", riskLevel);
                result.put("reason", reason); result.put("suggested_action", action); result.put("event_id", event.eventId);
                result.put("user_id", event.userId); result.put("user_name", event.userName); result.put("role", event.role);
                result.put("device_name", event.deviceName); result.put("location", event.location); result.put("login_time", event.loginTime);
                result.put("login_date", event.loginDate); result.put("login_status", event.loginStatus);
                return result;
        }
    }

    static final class LogicRule implements SecurityRule {
        @Override public Alert evaluate(LoginEvent event, MonitoringService service) {
            boolean oddHour = event.loginTime != null && isOddHour(event.loginTime);
            boolean newDevice = event.newDevice;
            boolean bruteForce = event.loginStatus.equals("success") && service.recentFailures(event.userId) > 5;
            boolean multipleDevices = service.recentDeviceCount(event.userId, event.loginTime) > 1;
            boolean shortInterval = service.recentEventCount(event.userId, event.loginTime) >= 2;
            boolean successfulLogin = event.loginStatus.equals("success");
            boolean knownCampusIp = event.ipAddress.startsWith("10.");
            boolean unknownIp = !knownCampusIp;
            boolean unusualLocation = event.location.equals("Off-campus network");
            if (fires(event.role.equals("staff") && oddHour && newDevice))
                return alert("R5 · Staff after-hours device", "StaffUser AND OddHour AND NewDevice", "Critical", "A staff account used a new device outside normal campus hours.", "Verify the staff member and revoke the device session if unrecognized.", event);
            if (fires(newDevice && oddHour))
                return alert("R1 · New device at odd hour", "NewDevice AND OddHour", "High", "A new device signed in during a restricted overnight period.", "Confirm device ownership and review the account session.", event);
            if (fires(bruteForce))
                return alert("R2 · Possible brute-force attempt", "FailedAttemptsGreaterThan5 AND SuccessfulLogin", "Critical", "More than five failed attempts preceded a successful login.", "Contact the account owner and reset credentials if activity is not recognized.", event);
            if (fires(multipleDevices && shortInterval && successfulLogin))
                return alert("R3 · Rapid multi-device access", "MultipleDevices AND ShortTimeInterval AND SuccessfulLogin", "Medium", "One account successfully accessed multiple devices in a short interval.", "Review concurrent sessions and confirm the account owner.", event);
            if (fires(unknownIp || unusualLocation))
                return alert("R4 · Network or location review", "UnknownIPAddress OR UnusualLocation", "Medium", "The login came from an unrecognized network location.", "Review the network record and verify the login with the account owner.", event);
            return null;
        }
        private boolean fires(boolean premise) { return implies(premise, true) && premise; }
        private boolean implies(boolean premise, boolean conclusion) { return !premise || conclusion; }
        private Alert alert(String rule, String conditions, String risk, String reason, String action, LoginEvent event) {
            return new Alert(rule, conditions, risk, reason, action, event);
        }
    }

    static final class LoginGraph {
        private final String role;
        private final List<LoginEvent> events = new ArrayList<>();
        LoginGraph(String role) { this.role = role; }
        synchronized void add(LoginEvent event) { if (event.role.equals(role)) events.add(event); }
        synchronized List<LoginEvent> events() { return new ArrayList<>(events); }
    }

    static final class MonitoringService {
        private final Path dataDirectory;
        private final List<LoginEvent> events = new ArrayList<>();
        private final List<Alert> alerts = new ArrayList<>();
        private final List<SecurityRule> rules = List.of(new LogicRule());
        private final LoginGraph studentGraph = new LoginGraph("student");
        private final LoginGraph staffGraph = new LoginGraph("staff");
        private final Map<String, Set<String>> knownDevices = new HashMap<>();
        private final List<Device> devices = makeDevices();
        private final Random random = new Random(90427);

        MonitoringService(Path dataDirectory) throws IOException {
            this.dataDirectory = dataDirectory;
            Path eventsFile = dataDirectory.resolve("login_events.csv");
            if (Files.isRegularFile(eventsFile) && Files.size(eventsFile) > 0) loadEvents(eventsFile);
            else generateSyntheticData();
            persist();
            exportFrequency();
        }

        synchronized LoginEvent recordLogin(String userId, String role, boolean success) throws IOException {
            String eventUserId = userId.isBlank() ? "unknown-" + role : userId;
            User user = role.equals("student") ? new Student(eventUserId) : new Staff(eventUserId);
            Set<String> known = knownDevices.computeIfAbsent(eventUserId, ignored -> ConcurrentHashMap.newKeySet());
            List<Device> available = devices.stream().filter(device -> device.roleGroup.equals(role) || device.roleGroup.equals("shared")).toList();
            Device device = available.get(Math.floorMod(eventUserId.hashCode(), available.size()));
            boolean fresh = !known.contains(device.id);
            known.add(device.id);
            LocalDateTime now = LocalDateTime.now();
            String eventUserName = userId.isBlank() ? "Unrecognized account" : user.name();
            LoginEvent event = new LoginEvent("EVT-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT), user.id(), eventUserName, role,
                    device.id, device.name, device.type, now.format(STAMP), now.format(DATE), "10.42." + random.nextInt(12) + "." + (10 + random.nextInt(220)),
                    "North Campus", success ? "success" : "failed", fresh, false);
            addAndEvaluate(event);
            persist(); exportFrequency();
            return event;
        }

        private void addAndEvaluate(LoginEvent event) {
            events.add(event);
            (event.role.equals("student") ? studentGraph : staffGraph).add(event);
            Alert found = null;
            for (SecurityRule rule : rules) { found = rule.evaluate(event, this); if (found != null) break; }
            if (found != null) {
                event.suspicious = true;
                event.ruleName = found.ruleName; event.conditions = found.conditions; event.reason = found.reason;
                event.riskLevel = found.riskLevel; event.action = found.action; alerts.add(found);
            }
        }

        synchronized long recentFailures(String userId) {
            return events.stream().filter(e -> e.userId.equals(userId) && e.loginStatus.equals("failed") && withinMinutes(e.loginTime, 30)).count();
        }
        synchronized long recentDeviceCount(String userId, String at) {
            return events.stream().filter(e -> e.userId.equals(userId) && withinMinutesOf(e.loginTime, at, 10)).map(e -> e.deviceId).distinct().count();
        }
        synchronized long recentEventCount(String userId, String at) {
            return events.stream().filter(e -> e.userId.equals(userId) && withinMinutesOf(e.loginTime, at, 10)).count();
        }

        synchronized Map<String, Object> dashboard() {
            long students = events.stream().filter(e -> e.role.equals("student") && e.loginStatus.equals("success")).count();
            long staff = events.stream().filter(e -> e.role.equals("staff") && e.loginStatus.equals("success")).count();
            long failed = events.stream().filter(e -> e.loginStatus.equals("failed")).count();
            long suspicious = alerts.size();
            long high = alerts.stream().filter(a -> Set.of("High", "Critical").contains(a.riskLevel)).count();
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("totals", Map.of("student_logins", students, "staff_logins", staff, "failed_logins", failed, "suspicious_logins", suspicious, "high_risk_alerts", high, "events", events.size()));
            result.put("recent_events", events.stream().filter(e -> e.suspicious).sorted(Comparator.comparing((LoginEvent e) -> e.loginTime).reversed()).limit(12).map(LoginEvent::asMap).toList());
            result.put("student_frequency", frequencyByUser("student"));
            result.put("staff_frequency", frequencyByUser("staff"));
            result.put("hourly_activity", hourlyActivity());
            result.put("normal_vs_suspicious", List.of(events.size() - suspicious, suspicious));
            result.put("alerts", alerts.stream().sorted(Comparator.comparing((Alert a) -> a.event.loginTime).reversed()).limit(30).map(Alert::asMap).toList());
            result.put("python_alerts", readPythonAlerts());
            result.put("generated_at", LocalDateTime.now().format(STAMP));
            return result;
        }

        synchronized List<Map<String, Object>> filteredEvents(String rawQuery) {
            Map<String, String> filters = query(rawQuery);
            return events.stream().filter(e -> filters.getOrDefault("role", "all").equals("all") || e.role.equals(filters.get("role")))
                    .filter(e -> filters.getOrDefault("date", "").isBlank() || e.loginDate.equals(filters.get("date")))
                    .filter(e -> filters.getOrDefault("risk", "all").equals("all") || e.riskLevel.equalsIgnoreCase(filters.get("risk")))
                    .filter(e -> !"true".equals(filters.get("suspicious")) || e.suspicious)
                    .filter(e -> filters.getOrDefault("device", "").isBlank() || e.deviceId.equalsIgnoreCase(filters.get("device")) || e.deviceName.toLowerCase(Locale.ROOT).contains(filters.get("device").toLowerCase(Locale.ROOT)))
                    .sorted(Comparator.comparing((LoginEvent e) -> e.loginTime).reversed()).limit(500).map(LoginEvent::asMap).toList();
        }

        synchronized Map<String, Object> graph(String role, String rawQuery) {
            String selectedRole = role.equalsIgnoreCase("staff") ? "staff" : "student";
            Map<String, String> filters = query(rawQuery);
            LoginGraph graph = selectedRole.equals("student") ? studentGraph : staffGraph;
            List<LoginEvent> selected = graph.events().stream()
                    .filter(e -> filters.getOrDefault("user", "").isBlank() || e.userId.toLowerCase(Locale.ROOT).contains(filters.get("user").toLowerCase(Locale.ROOT)))
                    .filter(e -> filters.getOrDefault("date", "").isBlank() || e.loginDate.equals(filters.get("date")))
                    .filter(e -> !"true".equals(filters.get("suspicious")) || e.suspicious)
                    .filter(e -> filters.getOrDefault("device", "").isBlank() || e.deviceId.equalsIgnoreCase(filters.get("device")) || e.deviceName.toLowerCase(Locale.ROOT).contains(filters.get("device").toLowerCase(Locale.ROOT)))
                    .sorted(Comparator.comparing((LoginEvent e) -> e.loginTime).reversed()).limit(180).toList();
            Map<String, Map<String, Object>> nodes = new LinkedHashMap<>();
            List<Map<String, Object>> edges = new ArrayList<>();
            for (LoginEvent e : selected) {
                nodes.putIfAbsent(e.userId, Map.of("data", Map.of("id", e.userId, "label", e.userId, "kind", "user", "role", e.role)));
                nodes.putIfAbsent(e.deviceId, Map.of("data", Map.of("id", e.deviceId, "label", e.deviceName, "kind", "device", "device_type", e.deviceType)));
                String eventNode = e.eventId;
                Map<String, Object> eventData = new LinkedHashMap<>();
                eventData.put("id", eventNode); eventData.put("label", e.loginStatus.equals("success") ? "Login" : "Failed"); eventData.put("kind", "event");
                eventData.put("suspicious", e.suspicious); eventData.put("event", e.asMap());
                nodes.put(eventNode, Map.of("data", eventData, "classes", e.suspicious ? "suspicious" : ""));
                edges.add(Map.of("data", Map.of("id", "u-" + eventNode, "source", e.userId, "target", eventNode), "classes", e.suspicious ? "suspicious" : ""));
                edges.add(Map.of("data", Map.of("id", "d-" + eventNode, "source", eventNode, "target", e.deviceId), "classes", e.suspicious ? "suspicious" : ""));
                if (selectedRole.equals("staff")) {
                    String locationId = "loc-" + e.location.replaceAll("[^A-Za-z0-9]", "");
                    nodes.putIfAbsent(locationId, Map.of("data", Map.of("id", locationId, "label", e.location, "kind", "location")));
                    edges.add(Map.of("data", Map.of("id", "l-" + eventNode, "source", eventNode, "target", locationId), "classes", e.suspicious ? "suspicious" : ""));
                }
            }
            return Map.of("elements", Map.of("nodes", new ArrayList<>(nodes.values()), "edges", edges), "event_count", selected.size(), "role", selectedRole);
        }

        synchronized List<Map<String, Object>> alerts() { return alerts.stream().sorted(Comparator.comparing((Alert a) -> a.event.loginTime).reversed()).map(Alert::asMap).toList(); }

        synchronized void download(HttpExchange exchange) throws IOException {
            Path file = dataDirectory.resolve("login_events.csv");
            byte[] bytes = Files.readAllBytes(file);
            exchange.getResponseHeaders().set("Content-Type", "text/csv; charset=utf-8");
            exchange.getResponseHeaders().set("Content-Disposition", "attachment; filename=synthetic-login-events.csv");
            exchange.sendResponseHeaders(200, bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
        }

        private List<Map<String, Object>> frequencyByUser(String role) {
            Map<String, Long> counts = events.stream().filter(e -> e.role.equals(role) && e.loginStatus.equals("success"))
                    .collect(Collectors.groupingBy(e -> e.userId, Collectors.counting()));
                int rosterSize = role.equals("student") ? 100 : 30;
                String prefix = role.equals("student") ? "student" : "staff";
                for (int i = 1; i <= rosterSize; i++) counts.putIfAbsent(String.format("%s%03d", prefix, i), 0L);
            return counts.entrySet().stream().sorted(Map.Entry.comparingByKey()).map(entry -> Map.<String, Object>of("user_id", entry.getKey(), "login_count", entry.getValue())).toList();
        }
        private List<Long> hourlyActivity() {
            long[] hours = new long[24];
            for (LoginEvent event : events) try { hours[LocalDateTime.parse(event.loginTime, STAMP).getHour()]++; } catch (Exception ignored) { }
            List<Long> result = new ArrayList<>(); for (long hour : hours) result.add(hour); return result;
        }
        private List<Map<String, Object>> readPythonAlerts() {
            Path file = dataDirectory.resolve("anomaly_results.csv");
            if (!Files.isRegularFile(file)) return List.of();
            try {
                List<String> lines = Files.readAllLines(file, StandardCharsets.UTF_8);
                List<Map<String, Object>> rows = new ArrayList<>();
                for (int i = 1; i < lines.size(); i++) {
                    String[] c = csvSplit(lines.get(i)); if (c.length < 7) continue;
                    rows.add(Map.of("user_id", c[0], "role", c[1], "login_count", parseLong(c[2]), "average_login_count", parseDouble(c[3]),
                            "z_score", parseDouble(c[4]), "anomaly_reason", c[5], "risk_level", c[6]));
                }
                return rows;
            } catch (IOException exception) { return List.of(); }
        }
        private void exportFrequency() throws IOException {
            Map<String, Long> counts = events.stream().filter(e -> e.loginStatus.equals("success")).collect(Collectors.groupingBy(e -> e.role + "|" + e.userId, Collectors.counting()));
            for (int i = 1; i <= 100; i++) counts.putIfAbsent("student|" + String.format("student%03d", i), 0L);
            for (int i = 1; i <= 30; i++) counts.putIfAbsent("staff|" + String.format("staff%03d", i), 0L);
            StringBuilder csv = new StringBuilder("user_id,role,login_count\n");
            counts.entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(entry -> {
                String[] parts = entry.getKey().split("\\|"); csv.append(parts[1]).append(',').append(parts[0]).append(',').append(entry.getValue()).append('\n');
            });
            Files.writeString(dataDirectory.resolve("login_frequency.csv"), csv, StandardCharsets.UTF_8);
        }
        private void persist() throws IOException {
            StringBuilder csv = new StringBuilder("event_id,user_id,user_name,role,device_id,device_name,device_type,login_time,login_date,ip_address,location,login_status,is_new_device,generated,rule_name,conditions,reason,risk_level,suggested_action\n");
            for (LoginEvent e : events) csv.append(csv(e.eventId)).append(',').append(csv(e.userId)).append(',').append(csv(e.userName)).append(',').append(csv(e.role)).append(',')
                    .append(csv(e.deviceId)).append(',').append(csv(e.deviceName)).append(',').append(csv(e.deviceType)).append(',').append(csv(e.loginTime)).append(',')
                    .append(csv(e.loginDate)).append(',').append(csv(e.ipAddress)).append(',').append(csv(e.location)).append(',').append(csv(e.loginStatus)).append(',')
                    .append(e.newDevice).append(',').append(e.generated).append(',').append(csv(e.ruleName)).append(',').append(csv(e.conditions)).append(',')
                    .append(csv(e.reason)).append(',').append(csv(e.riskLevel)).append(',').append(csv(e.action)).append('\n');
            Files.writeString(dataDirectory.resolve("login_events.csv"), csv, StandardCharsets.UTF_8);
        }
        private void generateSyntheticData() throws IOException {
            for (int i = 1; i <= 100; i++) knownDevices.put(String.format("student%03d", i), ConcurrentHashMap.newKeySet());
            for (int i = 1; i <= 30; i++) knownDevices.put(String.format("staff%03d", i), ConcurrentHashMap.newKeySet());
            for (int i = 0; i < 680; i++) {
                String role = random.nextInt(5) == 0 ? "staff" : "student";
                String userId = role.equals("student") ? String.format("student%03d", 1 + random.nextInt(100)) : String.format("staff%03d", 1 + random.nextInt(30));
                User user = role.equals("student") ? new Student(userId) : new Staff(userId);
                LocalDateTime time = LocalDateTime.now().minusDays(random.nextInt(30)).withHour(role.equals("staff") ? 8 + random.nextInt(11) : 8 + random.nextInt(13)).withMinute(random.nextInt(60));
                boolean suspiciousSeed = i % 37 == 0;
                boolean oddNew = suspiciousSeed && i % 74 == 0;
                if (oddNew) time = time.withHour(1 + random.nextInt(4));
                List<Device> available = devices.stream().filter(d -> d.roleGroup.equals(role) || d.roleGroup.equals("shared")).toList();
                Device device = available.get(random.nextInt(available.size()));
                boolean fresh = suspiciousSeed || !knownDevices.get(userId).contains(device.id);
                knownDevices.get(userId).add(device.id);
                String ip = suspiciousSeed && i % 3 == 0 ? "203.0.113." + (10 + random.nextInt(200)) : "10." + (20 + random.nextInt(20)) + "." + random.nextInt(250) + "." + (10 + random.nextInt(220));
                String location = suspiciousSeed && i % 3 == 0 ? "Off-campus network" : List.of("North Campus", "Library", "Science Hall", "Student Union").get(random.nextInt(4));
                String status = i % 19 == 0 ? "failed" : "success";
                LoginEvent event = new LoginEvent("EVT-DEMO-" + String.format("%04d", i + 1), userId, user.name(), role, device.id, device.name, device.type,
                        time.format(STAMP), time.format(DATE), ip, location, status, fresh, true);
                addAndEvaluate(event);
            }
            for (int i = 0; i < 20; i++) {
                Device device = devices.get(16 + i % 4);
                addSeedEvent("student100", "student", device, LocalDateTime.now().minusDays(i).withHour(13).withMinute(i * 2), "10.22.10.44", "Library", "success", false);
            }
            Device bruteForceDevice = devices.get(5);
            for (int i = 0; i < 6; i++) {
                addSeedEvent("student099", "student", bruteForceDevice, LocalDateTime.now().minusMinutes(8 - i), "10.22.4.18", "Library", "failed", false);
            }
            addSeedEvent("student099", "student", bruteForceDevice, LocalDateTime.now().minusMinutes(2), "10.22.4.18", "Library", "success", false);
            addSeedEvent("staff030", "staff", devices.get(12), LocalDateTime.now().minusMinutes(6), "10.24.3.12", "North Campus", "success", false);
            addSeedEvent("staff030", "staff", devices.get(16), LocalDateTime.now().minusMinutes(3), "10.24.3.12", "North Campus", "success", false);
            addSeedEvent("staff029", "staff", devices.get(14), LocalDateTime.now().withHour(1), "10.28.9.20", "North Campus", "success", true);
            addSeedEvent("student070", "student", devices.get(9), LocalDateTime.now().minusMinutes(1), "203.0.113.36", "Off-campus network", "success", false);
        }
        private void addSeedEvent(String userId, String role, Device device, LocalDateTime time, String ip, String location, String status, boolean fresh) {
            User user = role.equals("student") ? new Student(userId) : new Staff(userId);
            knownDevices.computeIfAbsent(userId, ignored -> ConcurrentHashMap.newKeySet()).add(device.id);
            LoginEvent event = new LoginEvent("EVT-DEMO-X" + UUID.randomUUID().toString().substring(0, 7).toUpperCase(Locale.ROOT), userId, user.name(), role,
                    device.id, device.name, device.type, time.format(STAMP), time.format(DATE), ip, location, status, fresh, true);
            addAndEvaluate(event);
        }
        private void loadEvents(Path file) throws IOException {
            List<String> rows = Files.readAllLines(file, StandardCharsets.UTF_8);
            for (int i = 1; i < rows.size(); i++) {
                String[] c = csvSplit(rows.get(i)); if (c.length < 19) continue;
                LoginEvent e = new LoginEvent(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9], c[10], c[11], Boolean.parseBoolean(c[12]), Boolean.parseBoolean(c[13]));
                e.ruleName = c[14]; e.conditions = c[15]; e.reason = c[16]; e.riskLevel = c[17]; e.action = c[18];
                if (e.ruleName.startsWith("R3 · Rapid multi-device access") && e.riskLevel.equals("High")) e.riskLevel = "Medium";
                events.add(e); (e.role.equals("student") ? studentGraph : staffGraph).add(e);
                knownDevices.computeIfAbsent(e.userId, ignored -> ConcurrentHashMap.newKeySet()).add(e.deviceId);
            }
            for (LoginEvent e : events) {
                if (e.ruleName.startsWith("R3 · Rapid multi-device access") && e.loginStatus.equals("failed")) {
                    e.ruleName = ""; e.conditions = ""; e.reason = ""; e.riskLevel = "Low"; e.action = "";
                    Alert updated = rules.get(0).evaluate(e, this);
                    if (updated != null) {
                        e.suspicious = true; e.ruleName = updated.ruleName; e.conditions = updated.conditions;
                        e.reason = updated.reason; e.riskLevel = updated.riskLevel; e.action = updated.action; alerts.add(updated);
                    }
                } else if (!e.ruleName.isBlank()) {
                    e.suspicious = true;
                    alerts.add(new Alert(e.ruleName, e.conditions, e.riskLevel, e.reason, e.action, e));
                }
            }
        }
    }

    static final class AdminService {
        private final Path root;
        private final Set<String> sessions = ConcurrentHashMap.newKeySet();
        AdminService(Path root) { this.root = root; }
        boolean authenticated(HttpExchange exchange) {
            String cookie = exchange.getRequestHeaders().getFirst("Cookie");
            if (cookie == null) return false;
            for (String part : cookie.split(";")) if (part.trim().startsWith("campus_admin=")) return sessions.contains(part.trim().substring("campus_admin=".length()));
            return false;
        }
        void createSession(HttpExchange exchange) {
            String token = UUID.randomUUID().toString(); sessions.add(token);
            exchange.getResponseHeaders().add("Set-Cookie", "campus_admin=" + token + "; Path=/; HttpOnly; SameSite=Lax");
        }
        void clearSession(HttpExchange exchange) {
            String cookie = exchange.getRequestHeaders().getFirst("Cookie");
            if (cookie != null) for (String part : cookie.split(";")) if (part.trim().startsWith("campus_admin=")) sessions.remove(part.trim().substring("campus_admin=".length()));
            exchange.getResponseHeaders().add("Set-Cookie", "campus_admin=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
        }
        Map<String, Object> runAnalysis() {
            try {
                Process process = new ProcessBuilder("python", root.resolve("python-analysis/anomaly_detector.py").toString(),
                        "--input", root.resolve("data/login_frequency.csv").toString(), "--output", root.resolve("data/anomaly_results.csv").toString())
                        .directory(root.toFile()).redirectErrorStream(true).start();
                String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
                int code = process.waitFor();
                if (code != 0) return Map.of("ok", false, "message", "Python analysis failed. Confirm pandas and numpy are installed.", "details", output);
                return Map.of("ok", true, "message", output.isBlank() ? "Analysis complete." : output.trim(), "alerts", monitoring.readPythonAlerts());
            } catch (Exception exception) {
                return Map.of("ok", false, "message", "Could not start Python analysis. Run anomaly_detector.py manually.", "details", exception.getMessage() == null ? "" : exception.getMessage());
            }
        }
    }

    private static List<Device> makeDevices() {
        List<Device> all = new ArrayList<>();
        for (int i = 1; i <= 5; i++) all.add(new Device(String.format("DEV-LAB-%02d", i), "Lab computer " + i, "Lab computer", "student"));
        for (int i = 1; i <= 4; i++) all.add(new Device(String.format("DEV-LIB-%02d", i), "Library computer " + i, "Library computer", "shared"));
        for (int i = 1; i <= 4; i++) all.add(new Device(String.format("DEV-OFF-%02d", i), "Staff desktop " + i, "Staff desktop", "staff"));
        for (int i = 1; i <= 3; i++) all.add(new Device(String.format("DEV-WRK-%02d", i), "Work laptop " + i, "Work laptop", "staff"));
        for (int i = 1; i <= 4; i++) all.add(new Device(String.format("DEV-PER-%02d", i), "Personal device " + i, i % 2 == 0 ? "Personal phone" : "Personal laptop", "shared"));
        return all;
    }
    private static String studentName(String id) { int n = number(id); return List.of("Avery", "Jordan", "Morgan", "Riley", "Casey", "Taylor", "Jamie", "Cameron").get(n % 8) + " " + List.of("Chen", "Patel", "Brooks", "Rivera", "Kim", "Morgan", "Singh", "Reed").get((n * 3) % 8); }
    private static String staffName(String id) { int n = number(id); return List.of("Dana", "Lee", "Robin", "Alex", "Sam", "Quinn").get(n % 6) + " " + List.of("Ward", "Price", "Hayes", "Park", "Diaz", "Bell").get((n * 2) % 6); }
    private static int number(String id) { try { return Integer.parseInt(id.replaceAll("\\D", "")); } catch (Exception e) { return 0; } }
    private static boolean isOddHour(String timestamp) {
        try { int hour = LocalDateTime.parse(timestamp, STAMP).getHour(); return hour < 6 || hour >= 23; } catch (Exception e) { return false; }
    }
    private static boolean withinMinutes(String timestamp, int minutes) { return withinMinutesOf(timestamp, LocalDateTime.now().format(STAMP), minutes); }
    private static boolean withinMinutesOf(String timestamp, String at, int minutes) {
        try { return Math.abs(java.time.Duration.between(LocalDateTime.parse(timestamp, STAMP), LocalDateTime.parse(at, STAMP)).toMinutes()) <= minutes; } catch (Exception e) { return false; }
    }
    private static String csv(String value) { String v = value == null ? "" : value; return v.contains(",") || v.contains("\"") || v.contains("\n") ? "\"" + v.replace("\"", "\"\"") + "\"" : v; }
    private static String[] csvSplit(String line) {
        List<String> values = new ArrayList<>(); StringBuilder value = new StringBuilder(); boolean quoted = false;
        for (int i = 0; i < line.length(); i++) { char c = line.charAt(i); if (c == '"') { if (quoted && i + 1 < line.length() && line.charAt(i + 1) == '"') { value.append('"'); i++; } else quoted = !quoted; }
            else if (c == ',' && !quoted) { values.add(value.toString()); value.setLength(0); } else value.append(c); }
        values.add(value.toString()); return values.toArray(String[]::new);
    }
    private static long parseLong(String value) { try { return Long.parseLong(value); } catch (Exception e) { return 0; } }
    private static double parseDouble(String value) { try { return Double.parseDouble(value); } catch (Exception e) { return 0; } }

    static final class Json {
        static String stringify(Object value) {
            if (value == null) return "null";
            if (value instanceof String text) return "\"" + escape(text) + "\"";
            if (value instanceof Number || value instanceof Boolean) return value.toString();
            if (value instanceof Map<?, ?> map) return map.entrySet().stream().map(e -> stringify(String.valueOf(e.getKey())) + ":" + stringify(e.getValue())).collect(Collectors.joining(",", "{", "}"));
            if (value instanceof Iterable<?> iterable) { List<String> items = new ArrayList<>(); iterable.forEach(item -> items.add(stringify(item))); return String.join(",", items).transform(s -> "[" + s + "]"); }
            return stringify(value.toString());
        }
        private static String escape(String text) { return text.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t"); }
    }
}