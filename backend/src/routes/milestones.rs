use axum::{extract::{Extension, Path, State}, http::StatusCode, Json};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{ApiResponse, Issue};

// ─── Models ───────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct MilestoneWithCounts {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub target_date: Option<NaiveDate>,
    pub status: String,
    pub order: i32,
    pub estimated_days: Option<i32>,
    pub org_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub total_issues: Option<i64>,
    pub done_issues: Option<i64>,
    pub bug_count: Option<i64>,
    pub feature_count: Option<i64>,
    pub improvement_count: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct CreateMilestone {
    pub name: String,
    pub description: Option<String>,
    pub target_date: Option<NaiveDate>,
    pub status: Option<String>,
    pub order: Option<i32>,
    pub estimated_days: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMilestone {
    pub name: Option<String>,
    pub description: Option<String>,
    pub target_date: Option<Option<NaiveDate>>,
    pub status: Option<String>,
    pub order: Option<i32>,
    pub estimated_days: Option<Option<i32>>,
}

#[derive(Debug, Serialize)]
pub struct MilestoneDetail {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub target_date: Option<NaiveDate>,
    pub status: String,
    pub order: i32,
    pub estimated_days: Option<i32>,
    pub org_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub issues: Vec<Issue>,
}

// Row type for the milestone-only query (no aggregates)
#[derive(Debug, FromRow)]
struct MilestoneRow {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub target_date: Option<NaiveDate>,
    pub status: String,
    pub order: i32,
    pub estimated_days: Option<i32>,
    pub org_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

// ─── Handlers ─────────────────────────────────────────

/// GET /projects/:project_id/milestones
pub async fn list_by_project(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<ApiResponse<Vec<MilestoneWithCounts>>>, axum::http::StatusCode> {
    let org_id = auth.org_id.as_deref().ok_or(axum::http::StatusCode::BAD_REQUEST)?;

    let milestones = sqlx::query_as::<_, MilestoneWithCounts>(
        r#"
        SELECT m.id, m.project_id, m.name, m.description, m.target_date,
               m.status, m."order", m.estimated_days, m.org_id, m.created_at,
               COUNT(i.id) as total_issues,
               COUNT(CASE WHEN i.status = 'done' THEN 1 END) as done_issues,
               COUNT(CASE WHEN i.type = 'bug' THEN 1 END) as bug_count,
               COUNT(CASE WHEN i.type = 'feature' THEN 1 END) as feature_count,
               COUNT(CASE WHEN i.type = 'improvement' THEN 1 END) as improvement_count
        FROM milestones m
        JOIN projects p ON p.id = m.project_id
        LEFT JOIN issues i ON i.milestone_id = m.id
        WHERE m.project_id = $1 AND p.org_id = $2
        GROUP BY m.id
        ORDER BY m."order", m.target_date NULLS LAST, m.created_at
        "#,
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| {
        tracing::error!(error = %e, "milestones.list query failed");
        vec![]
    });

    Ok(Json(ApiResponse::new(milestones)))
}

/// POST /projects/:project_id/milestones
pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CreateMilestone>,
) -> Result<Json<ApiResponse<MilestoneWithCounts>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    if body.name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Milestone name is required"}))));
    }

    let status = body.status.as_deref().unwrap_or("active");
    let order = body.order.unwrap_or(0);

    let row = sqlx::query_as::<_, MilestoneRow>(
        r#"
        INSERT INTO milestones (project_id, name, description, target_date, status, "order", estimated_days, org_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, project_id, name, description, target_date, status, "order", estimated_days, org_id, created_at
        "#,
    )
    .bind(project_id)
    .bind(&body.name)
    .bind(&body.description)
    .bind(body.target_date)
    .bind(status)
    .bind(order)
    .bind(body.estimated_days)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    let milestone = MilestoneWithCounts {
        id: row.id,
        project_id: row.project_id,
        name: row.name,
        description: row.description,
        target_date: row.target_date,
        status: row.status,
        order: row.order,
        estimated_days: row.estimated_days,
        org_id: row.org_id,
        created_at: row.created_at,
        total_issues: Some(0),
        done_issues: Some(0),
        bug_count: Some(0),
        feature_count: Some(0),
        improvement_count: Some(0),
    };

    Ok(Json(ApiResponse::new(milestone)))
}

/// PUT /milestones/:id
pub async fn update(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateMilestone>,
) -> Result<Json<ApiResponse<MilestoneWithCounts>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let target_date_provided = body.target_date.is_some();
    let target_date_value = body.target_date.flatten();
    let estimated_days_provided = body.estimated_days.is_some();
    let estimated_days_value = body.estimated_days.flatten();

    let row = sqlx::query_as::<_, MilestoneRow>(
        r#"
        UPDATE milestones SET
            name = COALESCE($2, name),
            description = COALESCE($3, description),
            target_date = CASE WHEN $4::boolean THEN $5 ELSE target_date END,
            status = COALESCE($6, status),
            "order" = COALESCE($7, "order"),
            estimated_days = CASE WHEN $8::boolean THEN $9 ELSE estimated_days END
        FROM projects p
        WHERE milestones.id = $1 AND milestones.project_id = p.id AND p.org_id = $10
        RETURNING milestones.id, milestones.project_id, milestones.name, milestones.description,
                  milestones.target_date, milestones.status, milestones."order", milestones.estimated_days,
                  milestones.org_id, milestones.created_at
        "#,
    )
    .bind(id)
    .bind(&body.name)
    .bind(&body.description)
    .bind(target_date_provided)
    .bind(target_date_value)
    .bind(&body.status)
    .bind(body.order)
    .bind(estimated_days_provided)
    .bind(estimated_days_value)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    match row {
        Some(row) => {
            // Fetch counts for the updated milestone
            let counts = sqlx::query_as::<_, CountsRow>(
                r#"
                SELECT
                    COUNT(i.id) as total_issues,
                    COUNT(CASE WHEN i.status = 'done' THEN 1 END) as done_issues,
                    COUNT(CASE WHEN i.type = 'bug' THEN 1 END) as bug_count,
                    COUNT(CASE WHEN i.type = 'feature' THEN 1 END) as feature_count,
                    COUNT(CASE WHEN i.type = 'improvement' THEN 1 END) as improvement_count
                FROM issues i
                WHERE i.milestone_id = $1
                "#,
            )
            .bind(id)
            .fetch_one(&pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

            let milestone = MilestoneWithCounts {
                id: row.id,
                project_id: row.project_id,
                name: row.name,
                description: row.description,
                target_date: row.target_date,
                status: row.status,
                order: row.order,
                estimated_days: row.estimated_days,
                org_id: row.org_id,
                created_at: row.created_at,
                total_issues: counts.total_issues,
                done_issues: counts.done_issues,
                bug_count: counts.bug_count,
                feature_count: counts.feature_count,
                improvement_count: counts.improvement_count,
            };

            Ok(Json(ApiResponse::new(milestone)))
        }
        None => Err((StatusCode::NOT_FOUND, Json(json!({"error": "Milestone not found"})))),
    }
}

#[derive(Debug, FromRow)]
struct CountsRow {
    pub total_issues: Option<i64>,
    pub done_issues: Option<i64>,
    pub bug_count: Option<i64>,
    pub feature_count: Option<i64>,
    pub improvement_count: Option<i64>,
}

/// DELETE /milestones/:id
pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let result = sqlx::query(
        "DELETE FROM milestones WHERE id = $1 AND project_id IN (SELECT id FROM projects WHERE org_id = $2)"
    )
        .bind(id)
        .bind(org_id)
        .execute(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    if result.rows_affected() > 0 {
        Ok(Json(ApiResponse::new(())))
    } else {
        Err((StatusCode::NOT_FOUND, Json(json!({"error": "Milestone not found"}))))
    }
}

/// GET /milestones/:id — detail with all issues
pub async fn get_one(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<MilestoneDetail>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    let row = sqlx::query_as::<_, MilestoneRow>(
        r#"
        SELECT m.id, m.project_id, m.name, m.description, m.target_date, m.status, m."order", m.estimated_days, m.org_id, m.created_at
        FROM milestones m
        JOIN projects p ON p.id = m.project_id
        WHERE m.id = $1 AND p.org_id = $2
        "#,
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    match row {
        Some(row) => {
            let issues = sqlx::query_as::<_, Issue>(
                "SELECT * FROM issues WHERE milestone_id = $1 ORDER BY position ASC",
            )
            .bind(id)
            .fetch_all(&pool)
            .await
            .unwrap_or_else(|e| {
                tracing::error!(error = %e, "milestones.get_one issues query failed");
                vec![]
            });

            let detail = MilestoneDetail {
                id: row.id,
                project_id: row.project_id,
                name: row.name,
                description: row.description,
                target_date: row.target_date,
                status: row.status,
                order: row.order,
                estimated_days: row.estimated_days,
                org_id: row.org_id,
                created_at: row.created_at,
                issues,
            };

            Ok(Json(ApiResponse::new(detail)))
        }
        None => Err((StatusCode::NOT_FOUND, Json(json!({"error": "Milestone not found"})))),
    }
}
