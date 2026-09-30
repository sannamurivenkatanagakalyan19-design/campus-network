of # KIET Campus Login Security

A local academic prototype for reviewing synthetic campus identity events. Student and staff portal sign-ins are sent to a Java monitoring service, evaluated against propositional security rules, associated with user/device graphs, and exported for Python statistical analysis. The admin console combines event summaries, interactive relationship graphs, Java alerts, Python anomaly results, and CSV downloads.

This is a classroom demonstration, not production authentication software. Every identity, location, device, IP address, password, and event is synthetic.

## Project Structure

```text
campus-login-security/
  frontend/                 Static HTML, CSS, and JavaScript
    assets/
  java-backend/              JDK-only HTTP server and monitoring model
  python-analysis/           pandas/numpy anomaly detector
  data/                      Generated event and analysis CSV files
  README.md
```

The workspace folder is the project root. The Java service serves the frontend at `http://localhost:8080` and writes generated CSV files under `data/` on first startup.

## Requirements

- JDK 17 or newer (tested with JDK 25); no Maven or Gradle required
- Python 3.10 or newer
- Python packages `pandas` and `numpy`
- Internet access in the browser for Chart.js, Cytoscape.js, and the optional Google Fonts stylesheet, or replace their CDN tags with local copies

Install Python dependencies in a virtual environment from the project root:

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install pandas numpy
```

## Run the Java Backend and Frontend

From the project root in PowerShell:

```powershell
javac -d java-backend/out java-backend/CampusServer.java
java -cp java-backend/out CampusServer .
```

Open [http://localhost:8080](http://localhost:8080). To use a different port, set `PORT` before launching the server, for example `$env:PORT = "8081"`.

## Deploy the Frontend to Vercel

The root `vercel.json` publishes `frontend/` and maps the portal and admin page URLs to their HTML files. Deploy from the repository root with the default project root; do not set the Vercel Root Directory to `frontend`.

The Vercel functions serve the bundled CSV snapshot through the dashboard, event, graph, alert, analysis, and download APIs. `/api/login` supports the documented synthetic demo credentials and student/staff accounts. Set `SESSION_SECRET` in Vercel project environment variables to a long, random value before deploying; the fallback is for local coursework demos only. Vercel's bundled filesystem is read-only, so new login events are not persisted and analysis uses the checked-in CSV snapshot. For live event persistence, deploy the Java backend with a database or other shared storage and configure the frontend API origin. Do not expose the local Java server directly to the internet.

The first startup generates 680 synthetic login events over the previous 30 days, 100 student accounts, 30 staff accounts, and 20 devices. It writes `data/login_events.csv` and the role-specific `data/login_frequency.csv`. Subsequent starts reload the event CSV and keep newly submitted login attempts. Do not delete the CSVs unless you intend to reset the prototype data.

## Demo Sign-Ins

Student and staff accounts use the shared synthetic demo password `Campus@123`:

- Students: `student001` through `student100`
- Staff: `staff001` through `staff030`

Admin accounts:

- `admin001` / `Admin@123`
- `securityadmin` / `Secure@123`
- `kalyansannamuri` / `kalyan@2007`

The admin session is a local in-memory HTTP-only cookie. Restarting the Java service clears admin sessions.

## Run Python Analysis

The protected admin dashboard's **Run anomaly analysis** action invokes the script and loads its results back into the dashboard. It expects the Python executable `python` to be available on `PATH` with pandas and numpy installed. Alternatively, from the project root run:

```powershell
python python-analysis/anomaly_detector.py
```

Optional paths can be supplied with `--input` and `--output`. The Java service exports successful login counts grouped by role and account to `data/login_frequency.csv`. The script compares accounts within their role, calculates the mean and population standard deviation, computes z-scores, and flags accounts above z = 2.5 or the fixed count threshold of 12. It writes `data/anomaly_results.csv` with `user_id`, `role`, `login_count`, `average_login_count`, `z_score`, `anomaly_reason`, and `risk_level`.

## Routes and Workflow

- `/` home and portal navigation
- `/student-login` student sign-in
- `/staff-login` staff sign-in
- `/admin-login` admin sign-in
- `/admin` protected dashboard
- `/admin/student-graph` protected student relationship graph
- `/admin/staff-graph` protected staff relationship graph
- `/admin/dmgt` protected propositional-rule engine and live Java rule matches
- `/admin/alerts` protected alert review

A student/staff attempt creates a login event even when credentials fail. Successful demo sign-ins use an available synthetic device and append the event to the corresponding graph. Students and staff receive only a generic security response; rule names, conditions, and investigation guidance stay in the admin console. Admin pages and APIs require a server-side session cookie.

## Propositional Logic (DMGT)

The Java `SecurityRule` abstraction evaluates the implication `premise -> suspicious/review outcome`. Conjunction (`AND`) joins required evidence, disjunction (`OR`) accepts either of two indicators, and negation (`NOT`) identifies an IP address outside the synthetic campus network. Material implication is true except when its premise is true and its conclusion is false; equivalently, `P -> Q` is `NOT P OR Q`.

| Rule | Proposition | Response |
| --- | --- | --- |
| R1 | `NewDevice AND OddHour -> SuspiciousLogin` | High risk; verify device and session |
| R2 | `FailedAttemptsGreaterThan5 AND SuccessfulLogin -> PossibleBruteForceAttack` | Critical; contact account owner and review credentials |
| R3 | `MultipleDevices AND ShortTimeInterval AND SuccessfulLogin -> SuspiciousLogin` | Medium; review concurrent sessions |
| R4 | `UnknownIPAddress OR UnusualLocation -> RequireAdminReview` | Medium; verify network and account owner |
| R5 | `StaffUser AND OddHour AND NewDevice -> HighRiskAlert` | Critical; verify staff member and device |

The Java alert record preserves the rule name, true conditions, risk, reason, and suggested admin action. Login hour uses the event's local timestamp; overnight means before 06:00 or from 23:00 onward. These are demonstration heuristics, not campus policy.

## Graph Structure (ADSA)

Each role has an independent `LoginGraph`. The graph API returns user, device, and login-event nodes joined by directed user-to-event and event-to-device edges. The staff graph additionally links login events to location nodes. Cytoscape.js renders the network with filters for account, date, device, and suspicious-only events; zoom, fit, and node selection are available. Suspicious events and their edges are red, users blue, devices green, login events amber, and staff locations slate. The graph API caps each view at 180 recent matching events to keep the browser responsive.

## Java OOP Design

- `User` is abstract; `Student` and `Staff` specialize it and provide role-specific affiliation data.
- `Device` and `LoginEvent` encapsulate synthetic campus entities and event state.
- `LoginGraph` maintains role-scoped event relationships.
- `SecurityRule` abstracts rule evaluation; `LogicRule` provides the polymorphic implementation.
- `MonitoringService` validates, records, evaluates, persists, exports, and summarizes events.
- `Alert` carries review context, while `AdminService` handles admin sessions and Python execution.

## Limitations

The server is intentionally dependency-free and suited to local coursework only: admin credentials are fixed demo values, there is no database, CSRF defense, rate limiting, password hashing, TLS, or durable admin session store. CDN chart/graph assets need network access. Avoid exposing this service to a public or campus network.
