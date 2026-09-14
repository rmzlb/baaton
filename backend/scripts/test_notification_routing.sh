#!/usr/bin/env bash
# Prove the notification routing SQL against a real Postgres.
#
# Why this exists: the 199 Rust tests never execute these queries. The routing
# lives in SQL — `@>` for status matching, COALESCE for inheritance, cardinality
# for the channel filter, `<>` for excluding the actor — and every one of those
# fails silently when wrong. A `<> NULL` returns no rows and looks exactly like
# "nobody subscribed", which is the failure mode this whole day was spent chasing.
set -uo pipefail
cd "$(dirname "$0")"

NAME=baaton-routing-test
PORT=55433
U="postgresql://postgres:test@127.0.0.1:$PORT/baaton"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=baaton \
  -p "$PORT:5432" postgres:16 >/dev/null || { echo "FATAL: docker run"; exit 1; }

# Wait from the host, not the container: readiness inside says nothing about the
# published port being connectable.
for i in $(seq 1 60); do
  psql "$U" -tAc "select 1" >/dev/null 2>&1 && { echo "postgres joignable apres ${i}s"; break; }
  sleep 1
done
psql "$U" -tAc "select 1" >/dev/null 2>&1 || { echo "FATAL: postgres injoignable"; exit 1; }

APPLIED=0
for f in $(ls migrations/*.sql | sort -V); do
  if psql "$U" -v ON_ERROR_STOP=1 -q -f "$f" >/tmp/routing_mig.log 2>&1; then
    APPLIED=$((APPLIED+1))
  else
    echo "FATAL: migration $f"; tail -5 /tmp/routing_mig.log; exit 1
  fi
done
echo "migrations appliquees: $APPLIED"

psql "$U" -v ON_ERROR_STOP=1 -q <<'SQL'
-- ── Fixture: one project, three statuses, room announces only not_ok ──
INSERT INTO organizations (id, name, slug) VALUES ('org_test', 'Test', 'test')
  ON CONFLICT (id) DO NOTHING;

INSERT INTO projects (id, org_id, name, slug, prefix, statuses,
                      notify_statuses, notify_comments, notify_issue_created)
VALUES (
  '11111111-1111-1111-1111-111111111111', 'org_test', 'Philoe', 'philoe', 'PHI',
  '[{"key":"in_review","label":"In Review"},{"key":"not_ok","label":"Not OK"},
    {"key":"done","label":"Done"}]'::jsonb,
  '["not_ok"]'::jsonb, true, false
);

-- Four people, each configured to be reachable.
INSERT INTO user_notification_channels (user_id, channel, address, verified_at) VALUES
  ('user_rmzlb',   'telegram', '2126258822', now()),
  ('user_heriter', 'telegram', '1000000001', now()),
  ('user_explicit','telegram', '1000000002', now()),
  ('user_slackonly','telegram','1000000003', now()),
  ('user_slackonly','slack',   'C123456',    now());

INSERT INTO project_notification_subscriptions
  (user_id, project_id, enabled, notify_statuses, notify_comments, notify_issue_created, channels)
VALUES
  -- inherits everything from the project
  ('user_rmzlb',    '11111111-1111-1111-1111-111111111111', true, NULL, NULL, NULL, '{}'),
  ('user_heriter',  '11111111-1111-1111-1111-111111111111', true, NULL, NULL, NULL, '{}'),
  -- explicitly wants a status the project keeps quiet
  ('user_explicit', '11111111-1111-1111-1111-111111111111', true, '["done"]'::jsonb, NULL, NULL, '{}'),
  -- reachable on telegram, but asked for slack only
  ('user_slackonly','11111111-1111-1111-1111-111111111111', true, NULL, NULL, NULL, '{slack}');
SQL
[ $? -eq 0 ] || { echo "FATAL: fixtures"; exit 1; }

# The exact production query from resolve_recipients, parameterised the same way.
run() { # $1=event $2=status_key $3=actor
psql "$U" -tA -F'|' <<SQL
SELECT c.user_id || ':' || c.channel
FROM project_notification_subscriptions s
JOIN projects p ON p.id = s.project_id
JOIN user_notification_channels c ON c.user_id = s.user_id
WHERE s.project_id = '11111111-1111-1111-1111-111111111111'
  AND s.enabled
  AND c.user_id <> '$3'
  AND (cardinality(s.channels) = 0 OR c.channel = ANY(s.channels))
  AND CASE '$1'
        WHEN 'status_changed' THEN
          COALESCE(s.notify_statuses, p.notify_statuses) @> to_jsonb('$2'::text)
        WHEN 'comment_added' THEN
          COALESCE(s.notify_comments, p.notify_comments)
        WHEN 'issue_created' THEN
          COALESCE(s.notify_issue_created, p.notify_issue_created)
        ELSE false
      END
ORDER BY 1
SQL
}

PASS=0; FAIL=0
check() { # $1=label $2=expected $3=actual
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  OK   $1"
  else FAIL=$((FAIL+1)); echo "  ECHEC $1"; echo "        attendu: [$2]"; echo "        obtenu : [$3]"; fi
}
j() { tr '\n' ',' | sed 's/,$//'; }

echo
echo "=== 1. transition not_ok: qui recoit ? (acteur inconnu) ==="
check "les heritiers recoivent, l'explicite non (il a demande done)" \
  "user_heriter:telegram,user_rmzlb:telegram" \
  "$(run status_changed not_ok 'user_nobody' | j)"

echo "=== 2. le fix anti-spam: rmzlb declenche lui-meme ==="
check "rmzlb est exclu de sa propre action" \
  "user_heriter:telegram" \
  "$(run status_changed not_ok 'user_rmzlb' | j)"

echo "=== 3. un choix explicite l'emporte sur le silence du projet ==="
check "done notifie l'explicite, personne d'autre" \
  "user_explicit:telegram" \
  "$(run status_changed done 'user_nobody' | j)"

echo "=== 4. le filtre de canal ==="
check "qui a demande slack ne recoit pas sur telegram" \
  "user_slackonly:slack" \
  "$(run comment_added '' 'user_rmzlb' | j | tr ',' '\n' | grep slackonly | j)"

echo "=== 5. issue_created: le projet l'a coupe, personne n'herite d'un oui ==="
check "aucun heritier, aucun destinataire" \
  "" \
  "$(run issue_created '' 'user_nobody' | j)"

echo "=== 6. le piege NULL: un acteur vide ne doit PAS vider la liste ==="
check "acteur chaine vide => les destinataires restent" \
  "user_heriter:telegram,user_rmzlb:telegram" \
  "$(run status_changed not_ok '' | j)"

echo
echo "resultat: $PASS reussis, $FAIL echoues"
[ "$FAIL" -eq 0 ] || exit 1
