//! Ways the recap can break, each pinned by a test below:
//!
//! Slots
//! 1. An event at 08:00 sharp waits for 12:00 (it must leave at 08:00).
//! 2. An event after 20:00, or during the night, never leaves or leaves at
//!    midnight (it must leave at 08:00 the next day).
//! 3. Slots drift by an hour after a DST change (computed on UTC or a fixed
//!    offset), in March or in October, including the repeated 02:00–03:00.
//!
//! Recipients (email only; Telegram keeps the actor)
//! 4. The actor, or the owner of the API key that acted, gets a mail about
//!    their own action.
//! 5. One person reached through two rows gets the event twice.
//!
//! Claim and send (Postgres)
//! 6. Two instances ticking together send the same recap twice.
//! 7. A recap is sent although nothing new happened since the last one.
//! 8. An event created after the slot is mailed early, or one created before
//!    it is never mailed.
//! 9. A failed send loses the events, or the retry carries different content
//!    under the same idempotency key (notifyd would drop it as a duplicate).
//! 10. A send that hung is never retried, or is retried while still leased.
//! 11. A person removed from an org still gets that org's events.
//! 12. A refused request is retried forever.
//! 13. The same event queued twice appears twice.
//!
//! Content
//! 14. User text reaches the HTML unescaped.
//! 15. The footer claims a reason the person does not have.

use super::*;
use chrono::TimeZone;

fn utc(y: i32, m: u32, d: u32, h: u32, min: u32, s: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(y, m, d, h, min, s).single().unwrap()
}

// ───────────────────────────── slots ─────────────────────────────

#[test]
fn slot_boundaries_on_a_summer_day() {
    // CEST = UTC+2: 08:00 Paris is 06:00 UTC.
    assert_eq!(
        slot_at_or_before(utc(2026, 7, 1, 6, 0, 0)),
        Some(utc(2026, 7, 1, 6, 0, 0))
    );
    assert_eq!(
        slot_at_or_before(utc(2026, 7, 1, 5, 59, 59)),
        Some(utc(2026, 6, 30, 18, 0, 0))
    );
    assert_eq!(
        slot_at_or_before(utc(2026, 7, 1, 9, 59, 59)),
        Some(utc(2026, 7, 1, 6, 0, 0))
    );
    assert_eq!(
        slot_at_or_before(utc(2026, 7, 1, 10, 0, 0)),
        Some(utc(2026, 7, 1, 10, 0, 0))
    );
    assert_eq!(
        slot_at_or_before(utc(2026, 7, 1, 14, 0, 0)),
        Some(utc(2026, 7, 1, 14, 0, 0))
    );
    // 20:00 sharp, just after, late evening, and after midnight all belong to
    // the 20:00 recap: nothing leaves again before 08:00.
    for t in [
        utc(2026, 7, 1, 18, 0, 0),
        utc(2026, 7, 1, 18, 0, 1),
        utc(2026, 7, 1, 21, 30, 0),
        utc(2026, 7, 2, 1, 0, 0),
        utc(2026, 7, 2, 5, 59, 59),
    ] {
        assert_eq!(slot_at_or_before(t), Some(utc(2026, 7, 1, 18, 0, 0)), "{t}");
    }
}

#[test]
fn slot_boundaries_on_a_winter_day() {
    // CET = UTC+1.
    assert_eq!(
        slot_at_or_before(utc(2026, 1, 15, 7, 0, 0)),
        Some(utc(2026, 1, 15, 7, 0, 0))
    );
    assert_eq!(
        slot_at_or_before(utc(2026, 1, 15, 6, 59, 59)),
        Some(utc(2026, 1, 14, 19, 0, 0))
    );
    assert_eq!(
        slot_at_or_before(utc(2026, 1, 15, 19, 0, 0)),
        Some(utc(2026, 1, 15, 19, 0, 0))
    );
}

#[test]
fn slots_follow_paris_through_the_march_change() {
    // 2026-03-29: 02:00 CET jumps to 03:00 CEST (01:00 UTC).
    // Saturday 20:00 CET = 19:00 UTC covers the whole night, gap included.
    for t in [
        utc(2026, 3, 29, 0, 30, 0),
        utc(2026, 3, 29, 1, 30, 0),
        utc(2026, 3, 29, 5, 59, 59),
    ] {
        assert_eq!(
            slot_at_or_before(t),
            Some(utc(2026, 3, 28, 19, 0, 0)),
            "{t}"
        );
    }
    // Sunday 08:00 is now CEST: 06:00 UTC, an hour earlier in UTC than Saturday.
    assert_eq!(
        slot_at_or_before(utc(2026, 3, 29, 6, 0, 0)),
        Some(utc(2026, 3, 29, 6, 0, 0))
    );
    assert_eq!(
        slot_at_or_before(utc(2026, 3, 28, 7, 0, 0)),
        Some(utc(2026, 3, 28, 7, 0, 0))
    );
}

#[test]
fn slots_follow_paris_through_the_october_change() {
    // 2026-10-25: 03:00 CEST falls back to 02:00 CET (01:00 UTC); 02:30 happens twice.
    for t in [
        utc(2026, 10, 25, 0, 30, 0),
        utc(2026, 10, 25, 1, 30, 0),
        utc(2026, 10, 25, 6, 59, 59),
    ] {
        assert_eq!(
            slot_at_or_before(t),
            Some(utc(2026, 10, 24, 18, 0, 0)),
            "{t}"
        );
    }
    // Sunday 08:00 CET = 07:00 UTC, an hour later in UTC than Saturday.
    assert_eq!(
        slot_at_or_before(utc(2026, 10, 25, 7, 0, 0)),
        Some(utc(2026, 10, 25, 7, 0, 0))
    );
    assert_eq!(
        slot_at_or_before(utc(2026, 10, 24, 6, 0, 0)),
        Some(utc(2026, 10, 24, 6, 0, 0))
    );
    assert_eq!(
        slot_at_or_before(utc(2026, 10, 26, 11, 0, 0)),
        Some(utc(2026, 10, 26, 11, 0, 0))
    );
}

// ───────────────────────────── recipients ─────────────────────────────

fn row(user: &str, channel: &str, address: &str) -> Recipient {
    Recipient {
        user_id: user.into(),
        channel: channel.into(),
        address: address.into(),
        telegram_route_id: None,
        reason: "subscription".into(),
    }
}

#[test]
fn email_rows_drop_the_actor_but_telegram_keeps_it() {
    let (email, other) = split_email(
        vec![
            row("actor", "email", "actor@example.invalid"),
            row("actor", "telegram", "1"),
            row("reviewer", "email", "rev@example.invalid"),
            row("reviewer", "email", "rev-again@example.invalid"),
            row("no-address", "email", ""),
        ],
        "actor",
    );
    let email: Vec<_> = email
        .iter()
        .map(|r| (r.user_id.as_str(), r.address.as_str()))
        .collect();
    assert_eq!(email, vec![("reviewer", "rev@example.invalid")]);
    let other: Vec<_> = other
        .iter()
        .map(|r| (r.user_id.as_str(), r.channel.as_str()))
        .collect();
    assert_eq!(other, vec![("actor", "telegram")]);
}

// ───────────────────────────── content ─────────────────────────────

fn line(project: &str, display_id: &str, kind: &str, reason: &str) -> DigestLine {
    DigestLine {
        id: Uuid::new_v4(),
        address: "to@example.invalid".into(),
        org_id: "org".into(),
        project_id: {
            use std::hash::{Hash, Hasher};
            let mut h = std::collections::hash_map::DefaultHasher::new();
            project.hash(&mut h);
            Uuid::from_u64_pair(h.finish(), 0)
        },
        project_name: project.into(),
        issue_display_id: display_id.into(),
        issue_title: "Titre".into(),
        kind: kind.into(),
        actor_name: "Alice".into(),
        from_status: Some("In Progress".into()),
        to_status: Some("In Review".into()),
        body: Some("Corps".into()),
        reason: reason.into(),
        occurred_at: utc(2026, 10, 26, 9, 0, 0),
        created_at: utc(2026, 10, 26, 9, 0, 0),
    }
}

#[test]
fn recap_escapes_every_user_supplied_string() {
    let mut l = line("<b>Proj</b>", "SQX-1", "comment_added", "role:<i>Rev</i>");
    l.issue_title = "<script>alert(1)</script>".into();
    l.actor_name = "Alice & <Bob>".into();
    l.body = Some("<img src=x onerror=alert(1)>".into());
    let mail = crate::email_templates::recap_email(
        &[l],
        utc(2026, 10, 26, 11, 0, 0),
        "https://app.baaton.dev",
    );
    for raw in ["<script>", "<img src=x", "<b>Proj", "<i>Rev", "<Bob>"] {
        assert!(!mail.html.contains(raw), "unescaped {raw}");
    }
    assert!(mail.html.contains("&lt;script&gt;"));
    // The plain-text part carries the same words, unescaped.
    assert!(mail.text.contains("<img src=x onerror=alert(1)>"));
}

#[test]
fn recap_footer_states_each_projects_real_reason() {
    let lines = vec![
        line("SqareX", "SQX-1", "status_changed", "role:Reviewer"),
        line("HelmAI", "HLM-2", "comment_added", "subscription"),
        line("RVKIN", "RVK-3", "status_changed", "participant"),
    ];
    let mail = crate::email_templates::recap_email(
        &lines,
        utc(2026, 10, 26, 11, 0, 0),
        "https://app.baaton.dev",
    );
    assert!(
        mail.text.contains("SqareX : rôle Reviewer"),
        "{}",
        mail.text
    );
    assert!(
        mail.text.contains("HelmAI : abonnement au projet"),
        "{}",
        mail.text
    );
    assert!(mail.text.contains("RVKIN : vos tickets"), "{}", mail.text);
    assert!(!mail.text.contains("You follow"));
}

// ───────────────────────────── Postgres ─────────────────────────────

use std::sync::Mutex;

/// Isolated schema on a disposable database: the real 083 migration on a stub
/// `issues` table. Nothing outside the schema is touched; it is dropped at the end.
struct TestDb {
    pool: PgPool,
    admin: PgPool,
    schema: String,
}

impl TestDb {
    async fn new() -> Self {
        let url = std::env::var("DATABASE_URL_TEST").expect("set DATABASE_URL_TEST explicitly");
        let schema = format!("digest_test_{}", Uuid::new_v4().simple());
        let admin = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .unwrap();
        sqlx::raw_sql(&format!("CREATE SCHEMA {schema}"))
            .execute(&admin)
            .await
            .unwrap();
        let options: sqlx::postgres::PgConnectOptions = url.parse().unwrap();
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(6)
            .connect_with(options.options([("search_path", schema.as_str())]))
            .await
            .unwrap();
        sqlx::raw_sql("CREATE TABLE issues (id uuid PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(include_str!("../../migrations/083_email_digests.sql"))
            .execute(&pool)
            .await
            .unwrap();
        Self {
            pool,
            admin,
            schema,
        }
    }

    async fn drop(self) {
        self.pool.close().await;
        sqlx::raw_sql(&format!("DROP SCHEMA {} CASCADE", self.schema))
            .execute(&self.admin)
            .await
            .unwrap();
        self.admin.close().await;
    }

    /// Queue one event created at `created_at`, as `enqueue` would.
    async fn event(
        &self,
        user: &str,
        org: &str,
        project: &str,
        display_id: &str,
        created_at: DateTime<Utc>,
    ) -> Uuid {
        let issue = Uuid::new_v4();
        sqlx::query("INSERT INTO issues VALUES ($1)")
            .bind(issue)
            .execute(&self.pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO email_digest_events (user_id, address, org_id, project_id, project_name, issue_id, \
               issue_display_id, issue_title, kind, actor_name, to_status, reason, dedupe_key, occurred_at, created_at) \
             VALUES ($1, $1 || '@example.invalid', $2, gen_random_uuid(), $3, $4, $5, 'Titre', 'status_changed', \
               'Bob', 'In Review', 'role:Reviewer', $6, $7, $7)",
        )
        .bind(user).bind(org).bind(project).bind(issue).bind(display_id)
        .bind(format!("status:{issue}")).bind(created_at)
        .execute(&self.pool).await.unwrap();
        issue
    }

    async fn digests(&self) -> Vec<(String, DateTime<Utc>, String, i32, i64)> {
        sqlx::query_as(
            "SELECT d.user_id, d.slot_at, d.status, d.attempts, \
                    (SELECT count(*) FROM email_digest_events e WHERE e.digest_id = d.id) \
               FROM email_digests d ORDER BY d.user_id, d.slot_at",
        )
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }
}

#[derive(Default)]
struct Fake {
    sent: Mutex<Vec<serde_json::Value>>,
    /// Org memberships; a missing user has none.
    orgs: Mutex<std::collections::HashMap<String, Vec<String>>>,
    /// Errors returned by the next sends, in order.
    failures: Mutex<Vec<SendError>>,
}

impl Fake {
    fn member(self, user: &str, orgs: &[&str]) -> Self {
        self.orgs
            .lock()
            .unwrap()
            .insert(user.into(), orgs.iter().map(|o| o.to_string()).collect());
        self
    }
    fn sent_to(&self, user: &str) -> Vec<serde_json::Value> {
        let to = format!("{user}@example.invalid");
        self.sent
            .lock()
            .unwrap()
            .iter()
            .filter(|b| b["to"] == to.as_str())
            .cloned()
            .collect()
    }
}

impl Transport for Fake {
    async fn org_ids(&self, user_id: &str) -> Result<Vec<String>, String> {
        Ok(self
            .orgs
            .lock()
            .unwrap()
            .get(user_id)
            .cloned()
            .unwrap_or_default())
    }
    async fn send(&self, body: serde_json::Value) -> Result<(), SendError> {
        // Let a concurrent tick run in between, as a real request would.
        tokio::task::yield_now().await;
        let failure = {
            let mut f = self.failures.lock().unwrap();
            if f.is_empty() {
                None
            } else {
                Some(f.remove(0))
            }
        };
        if let Some(e) = failure {
            return Err(e);
        }
        self.sent.lock().unwrap().push(body);
        Ok(())
    }
}

const URL: &str = "https://app.baaton.dev";

/// 12:00 Paris on 26/10/2026 (CET) is 11:00 UTC.
fn noon() -> DateTime<Utc> {
    utc(2026, 10, 26, 11, 0, 0)
}

#[tokio::test]
#[ignore = "requires DATABASE_URL_TEST pointing at a disposable PostgreSQL database"]
async fn one_recap_per_person_and_slot_across_projects_and_instances() {
    let db = TestDb::new().await;
    let at = |h, m| utc(2026, 10, 26, h, m, 0);
    db.event("ramzi", "org-a", "SqareX", "SQX-1", at(8, 10))
        .await;
    db.event("ramzi", "org-b", "HelmAI", "HLM-2", at(9, 0))
        .await;
    db.event("ramzi", "org-a", "SqareX", "SQX-1", at(11, 0))
        .await; // 12:00 sharp belongs to 12:00
    let late = db
        .event(
            "ramzi",
            "org-a",
            "SqareX",
            "SQX-9",
            at(11, 0) + chrono::Duration::seconds(1),
        )
        .await;
    db.event("yacine", "org-a", "SqareX", "SQX-1", at(10, 0))
        .await;
    let fake = Fake::default()
        .member("ramzi", &["org-a", "org-b"])
        .member("yacine", &["org-a"]);

    // Two instances tick at the same moment.
    let now = noon() + chrono::Duration::seconds(30);
    let (a, b) = tokio::join!(
        tick(&db.pool, &fake, URL, now),
        tick(&db.pool, &fake, URL, now)
    );
    assert_eq!(a.unwrap().sent + b.unwrap().sent, 2);
    assert_eq!(fake.sent_to("ramzi").len(), 1);
    assert_eq!(fake.sent_to("yacine").len(), 1);

    let mail = &fake.sent_to("ramzi")[0];
    assert_eq!(
        mail["idempotency_key"],
        idempotency_key("ramzi", noon()).as_str()
    );
    let text = mail["body"].as_str().unwrap();
    assert!(
        text.contains("SQX-1") && text.contains("HLM-2"),
        "both orgs in one mail: {text}"
    );
    assert!(
        !text.contains("SQX-9"),
        "an event after the slot waits for the next one"
    );

    // Nothing new: later ticks in the same slot send nothing.
    let report = tick(&db.pool, &fake, URL, noon() + chrono::Duration::minutes(30))
        .await
        .unwrap();
    assert_eq!(report, TickReport::default());
    assert_eq!(fake.sent.lock().unwrap().len(), 2);

    // The late event leaves at 16:00 and only it.
    tick(&db.pool, &fake, URL, utc(2026, 10, 26, 15, 0, 5))
        .await
        .unwrap();
    let second = fake.sent_to("ramzi");
    assert_eq!(second.len(), 2);
    let text = second[1]["body"].as_str().unwrap();
    assert!(text.contains("SQX-9") && !text.contains("HLM-2"), "{text}");
    let attached: Option<Uuid> =
        sqlx::query_scalar("SELECT digest_id FROM email_digest_events WHERE issue_id = $1")
            .bind(late)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert!(attached.is_some());
    db.drop().await;
}

#[tokio::test]
#[ignore = "requires DATABASE_URL_TEST pointing at a disposable PostgreSQL database"]
async fn a_failed_send_is_retried_with_the_same_content_and_key() {
    let db = TestDb::new().await;
    db.event(
        "ramzi",
        "org-a",
        "SqareX",
        "SQX-1",
        utc(2026, 10, 26, 10, 0, 0),
    )
    .await;
    let fake = Fake::default().member("ramzi", &["org-a"]);
    fake.failures
        .lock()
        .unwrap()
        .push(SendError::Retryable("notifyd 503".into()));

    let first = noon() + chrono::Duration::seconds(10);
    assert_eq!(tick(&db.pool, &fake, URL, first).await.unwrap().retried, 1);
    assert!(fake.sent.lock().unwrap().is_empty());

    // An event committed late, stamped before the slot, after the first attempt.
    db.event(
        "ramzi",
        "org-a",
        "SqareX",
        "SQX-7",
        utc(2026, 10, 26, 10, 59, 0),
    )
    .await;

    // Not before the backoff.
    assert_eq!(
        tick(&db.pool, &fake, URL, first + chrono::Duration::seconds(30))
            .await
            .unwrap(),
        TickReport::default()
    );
    assert_eq!(
        tick(&db.pool, &fake, URL, first + chrono::Duration::minutes(2))
            .await
            .unwrap()
            .sent,
        1
    );
    let mail = &fake.sent_to("ramzi")[0];
    assert_eq!(
        mail["idempotency_key"],
        idempotency_key("ramzi", noon()).as_str()
    );
    let text = mail["body"].as_str().unwrap();
    assert!(
        text.contains("SQX-1") && !text.contains("SQX-7"),
        "content frozen at the first attempt: {text}"
    );

    // The late event is not lost: it leaves with the next recap.
    tick(&db.pool, &fake, URL, utc(2026, 10, 26, 15, 0, 5))
        .await
        .unwrap();
    assert!(fake.sent_to("ramzi")[1]["body"]
        .as_str()
        .unwrap()
        .contains("SQX-7"));
    db.drop().await;
}

#[tokio::test]
#[ignore = "requires DATABASE_URL_TEST pointing at a disposable PostgreSQL database"]
async fn a_hung_send_is_reclaimed_only_after_its_lease() {
    let db = TestDb::new().await;
    db.event(
        "ramzi",
        "org-a",
        "SqareX",
        "SQX-1",
        utc(2026, 10, 26, 10, 0, 0),
    )
    .await;
    let now = noon() + chrono::Duration::seconds(10);
    // Claimed by an instance that then died before recording any outcome.
    assert_eq!(claim_due(&db.pool, noon(), now).await.unwrap().len(), 1);
    assert!(
        claim_due(&db.pool, noon(), now + chrono::Duration::minutes(1))
            .await
            .unwrap()
            .is_empty()
    );
    let again = claim_due(&db.pool, noon(), now + chrono::Duration::minutes(6))
        .await
        .unwrap();
    assert_eq!(again.len(), 1);
    assert_eq!(again[0].attempts, 2);
    db.drop().await;
}

#[tokio::test]
#[ignore = "requires DATABASE_URL_TEST pointing at a disposable PostgreSQL database"]
async fn a_member_removed_from_an_org_no_longer_receives_its_events() {
    let db = TestDb::new().await;
    db.event(
        "ramzi",
        "org-a",
        "SqareX",
        "SQX-1",
        utc(2026, 10, 26, 10, 0, 0),
    )
    .await;
    db.event(
        "ramzi",
        "org-gone",
        "Former",
        "OLD-1",
        utc(2026, 10, 26, 10, 5, 0),
    )
    .await;
    db.event(
        "left",
        "org-gone",
        "Former",
        "OLD-2",
        utc(2026, 10, 26, 10, 5, 0),
    )
    .await;
    let fake = Fake::default().member("ramzi", &["org-a"]);

    let report = tick(&db.pool, &fake, URL, noon() + chrono::Duration::seconds(10))
        .await
        .unwrap();
    assert_eq!((report.sent, report.skipped), (1, 1));
    let text = fake.sent_to("ramzi")[0]["body"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(
        text.contains("SQX-1") && !text.contains("OLD-1") && !text.contains("Former"),
        "{text}"
    );
    assert!(fake.sent_to("left").is_empty());
    let left: i64 =
        sqlx::query_scalar("SELECT count(*) FROM email_digest_events WHERE org_id = 'org-gone'")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(
        left, 0,
        "removed events are deleted, not kept for a later send"
    );
    db.drop().await;
}

#[tokio::test]
#[ignore = "requires DATABASE_URL_TEST pointing at a disposable PostgreSQL database"]
async fn a_refused_request_is_not_retried() {
    let db = TestDb::new().await;
    db.event(
        "ramzi",
        "org-a",
        "SqareX",
        "SQX-1",
        utc(2026, 10, 26, 10, 0, 0),
    )
    .await;
    let fake = Fake::default().member("ramzi", &["org-a"]);
    fake.failures
        .lock()
        .unwrap()
        .push(SendError::Permanent("400 invalid recipient".into()));
    assert_eq!(tick(&db.pool, &fake, URL, noon()).await.unwrap().failed, 1);
    assert_eq!(
        tick(&db.pool, &fake, URL, noon() + chrono::Duration::hours(2))
            .await
            .unwrap(),
        TickReport::default()
    );
    assert_eq!(db.digests().await[0].2, "failed");
    db.drop().await;
}

#[tokio::test]
#[ignore = "requires DATABASE_URL_TEST pointing at a disposable PostgreSQL database"]
async fn the_same_event_queued_twice_is_mailed_once() {
    let db = TestDb::new().await;
    let issue = Uuid::new_v4();
    sqlx::query("INSERT INTO issues VALUES ($1)")
        .bind(issue)
        .execute(&db.pool)
        .await
        .unwrap();
    let issue_ref = IssueRef {
        org_id: "org-a",
        project_id: Uuid::new_v4(),
        project_name: "SqareX",
        issue_id: issue,
        display_id: "SQX-1",
        title: "Titre",
    };
    let to = vec![row("ramzi", "email", "ramzi@example.invalid")];
    let kind = EventKind::StatusChanged {
        from: "In Progress",
        to: "In Review",
    };
    for _ in 0..2 {
        enqueue(
            &db.pool,
            &to,
            &issue_ref,
            "Bob",
            &kind,
            "status:x:in_review:1",
            Utc::now(),
        )
        .await;
    }
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM email_digest_events")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(n, 1);
    db.drop().await;
}
