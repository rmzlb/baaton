use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::ApiResponse;
use crate::routes::issue_scope;

// ─── Models ───────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CustomFieldDefinition {
    pub id: Uuid,
    pub project_id: Uuid,
    pub org_id: String,
    pub name: String,
    pub field_type: String,
    pub description: Option<String>,
    pub options: serde_json::Value,
    pub required: bool,
    pub position: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateFieldDef {
    pub name: String,
    pub field_type: String,
    pub description: Option<String>,
    pub options: Option<serde_json::Value>,
    pub required: Option<bool>,
    pub position: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateFieldDef {
    pub name: Option<String>,
    pub description: Option<String>,
    pub options: Option<serde_json::Value>,
    pub required: Option<bool>,
    pub position: Option<i32>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CustomFieldValue {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub field_id: Uuid,
    pub value_text: Option<String>,
    pub value_number: Option<f64>,
    pub value_date: Option<NaiveDate>,
    pub value_json: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SetFieldValue {
    pub field_id: Uuid,
    pub value_text: Option<String>,
    pub value_number: Option<f64>,
    pub value_date: Option<NaiveDate>,
    pub value_json: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct SetFieldValues {
    pub values: Vec<SetFieldValue>,
}

// ─── Helpers ──────────────────────────────────────────

type ApiResult<T> = Result<Json<ApiResponse<T>>, (StatusCode, Json<serde_json::Value>)>;

fn bad_req(msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::BAD_REQUEST, Json(json!({"error": msg})))
}

fn not_found(msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::NOT_FOUND, Json(json!({"error": msg})))
}

fn internal(msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": msg})))
}

/// Resolve the org owning a custom field, checked against the caller's scope.
///
/// The field's own `org_id` column is the owner, and `custom_field_definitions`
/// is created under the project's org, so the project is what decides
/// entitlement. Returning the resolved org means every following statement
/// filters on the owning tenant rather than the caller's home org (BAA-31).
async fn require_field_org(
    pool: &PgPool,
    auth: &AuthUser,
    field_id: Uuid,
) -> Result<String, (StatusCode, Json<serde_json::Value>)> {
    let row: Option<(String, Uuid)> = sqlx::query_as(
        "SELECT org_id, project_id FROM custom_field_definitions WHERE id = $1",
    )
    .bind(field_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!("require_field_org error: {e}");
        internal("Database error")
    })?;

    match row {
        Some((org_id, project_id))
            if issue_scope::require_project(pool, auth, project_id)
                .await
                .is_ok() =>
        {
            Ok(org_id)
        }
        // Missing and out-of-scope collapse to the same answer, so an id from
        // another tenant is not confirmed to exist.
        _ => Err(not_found("Custom field not found")),
    }
}

// ─── Handlers ─────────────────────────────────────────

/// GET /projects/{id}/custom-fields
pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
) -> ApiResult<Vec<CustomFieldDefinition>> {
    let org_id = issue_scope::require_project(&pool, &auth, project_id).await?;
    let org_id = org_id.as_str();

    let fields = sqlx::query_as::<_, CustomFieldDefinition>(
        r#"
        SELECT id, project_id, org_id, name, field_type, description, options, required, position, created_at, updated_at
        FROM custom_field_definitions
        WHERE project_id = $1 AND org_id = $2
        ORDER BY position ASC, created_at ASC
        "#,
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        tracing::error!("custom_fields list error: {e}");
        internal("Failed to list custom fields")
    })?;

    Ok(Json(ApiResponse::new(fields)))
}

/// POST /projects/{id}/custom-fields
pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CreateFieldDef>,
) -> ApiResult<CustomFieldDefinition> {
    let org_id = issue_scope::require_project(&pool, &auth, project_id).await?;
    let org_id = org_id.as_str();

    let valid_types = ["text", "number", "date", "select", "multi_select", "url", "checkbox"];
    if !valid_types.contains(&body.field_type.as_str()) {
        return Err(bad_req("Invalid field_type"));
    }

    let options = body.options.unwrap_or_else(|| serde_json::Value::Array(vec![]));
    let required = body.required.unwrap_or(false);
    let position = body.position.unwrap_or(0);

    let field = sqlx::query_as::<_, CustomFieldDefinition>(
        r#"
        INSERT INTO custom_field_definitions
            (project_id, org_id, name, field_type, description, options, required, position)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, project_id, org_id, name, field_type, description, options, required, position, created_at, updated_at
        "#,
    )
    .bind(project_id)
    .bind(org_id)
    .bind(&body.name)
    .bind(&body.field_type)
    .bind(&body.description)
    .bind(&options)
    .bind(required)
    .bind(position)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        tracing::error!("custom_fields create error: {e}");
        if e.to_string().contains("unique") {
            bad_req("A field with this name already exists in the project")
        } else {
            internal("Failed to create custom field")
        }
    })?;

    Ok(Json(ApiResponse::new(field)))
}

/// PATCH /custom-fields/{id}
pub async fn update(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(field_id): Path<Uuid>,
    Json(body): Json<UpdateFieldDef>,
) -> ApiResult<CustomFieldDefinition> {
    let org_id = require_field_org(&pool, &auth, field_id).await?;
    let org_id = org_id.as_str();

    let field = sqlx::query_as::<_, CustomFieldDefinition>(
        r#"
        UPDATE custom_field_definitions SET
            name        = COALESCE($2, name),
            description = COALESCE($3, description),
            options     = COALESCE($4, options),
            required    = COALESCE($5, required),
            position    = COALESCE($6, position),
            updated_at  = now()
        WHERE id = $1 AND org_id = $7
        RETURNING id, project_id, org_id, name, field_type, description, options, required, position, created_at, updated_at
        "#,
    )
    .bind(field_id)
    .bind(&body.name)
    .bind(&body.description)
    .bind(&body.options)
    .bind(body.required)
    .bind(body.position)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        tracing::error!("custom_fields update error: {e}");
        internal("Failed to update custom field")
    })?;

    Ok(Json(ApiResponse::new(field)))
}

/// DELETE /custom-fields/{id}
pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(field_id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let org_id = require_field_org(&pool, &auth, field_id).await?;
    let org_id = org_id.as_str();

    sqlx::query("DELETE FROM custom_field_definitions WHERE id = $1 AND org_id = $2")
        .bind(field_id)
        .bind(org_id)
        .execute(&pool)
        .await
        .map_err(|e| {
            tracing::error!("custom_fields remove error: {e}");
            internal("Failed to delete custom field")
        })?;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /issues/{id}/custom-values
pub async fn get_values(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
) -> ApiResult<Vec<CustomFieldValue>> {
    let scope = issue_scope::require(&pool, &auth, issue_id, "Issue").await?;
    let org_id = scope.org_id.as_str();

    let values = sqlx::query_as::<_, CustomFieldValue>(
        r#"
        SELECT cfv.id, cfv.issue_id, cfv.field_id,
               cfv.value_text, cfv.value_number, cfv.value_date, cfv.value_json,
               cfv.created_at, cfv.updated_at
        FROM custom_field_values cfv
        JOIN custom_field_definitions cfd ON cfd.id = cfv.field_id
        WHERE cfv.issue_id = $1 AND cfd.org_id = $2
        ORDER BY cfd.position ASC, cfv.created_at ASC
        "#,
    )
    .bind(issue_id)
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        tracing::error!("custom_fields get_values error: {e}");
        internal("Failed to fetch custom field values")
    })?;

    Ok(Json(ApiResponse::new(values)))
}

/// PUT /issues/{id}/custom-values — batch upsert
pub async fn set_values(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(issue_id): Path<Uuid>,
    Json(body): Json<SetFieldValues>,
) -> ApiResult<Vec<CustomFieldValue>> {
    let scope = issue_scope::require(&pool, &auth, issue_id, "Issue").await?;
    let org_id = scope.org_id.as_str();

    // Verify all field_ids belong to the same org
    let field_ids: Vec<Uuid> = body.values.iter().map(|v| v.field_id).collect();
    let valid_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM custom_field_definitions WHERE id = ANY($1) AND org_id = $2",
    )
    .bind(&field_ids)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        tracing::error!("custom_fields set_values field check error: {e}");
        internal("Database error")
    })?;

    if valid_count != field_ids.len() as i64 {
        return Err(bad_req("One or more field_ids are invalid or belong to a different org"));
    }

    // Upsert each value individually (simple, avoids unnest complexity)
    for v in &body.values {
        sqlx::query(
            r#"
            INSERT INTO custom_field_values
                (issue_id, field_id, value_text, value_number, value_date, value_json, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, now())
            ON CONFLICT (issue_id, field_id) DO UPDATE SET
                value_text   = EXCLUDED.value_text,
                value_number = EXCLUDED.value_number,
                value_date   = EXCLUDED.value_date,
                value_json   = EXCLUDED.value_json,
                updated_at   = now()
            "#,
        )
        .bind(issue_id)
        .bind(v.field_id)
        .bind(&v.value_text)
        .bind(v.value_number)
        .bind(v.value_date)
        .bind(&v.value_json)
        .execute(&pool)
        .await
        .map_err(|e| {
            tracing::error!("custom_fields set_values upsert error: {e}");
            internal("Failed to save custom field value")
        })?;
    }

    // Return updated values
    let values = sqlx::query_as::<_, CustomFieldValue>(
        r#"
        SELECT cfv.id, cfv.issue_id, cfv.field_id,
               cfv.value_text, cfv.value_number, cfv.value_date, cfv.value_json,
               cfv.created_at, cfv.updated_at
        FROM custom_field_values cfv
        JOIN custom_field_definitions cfd ON cfd.id = cfv.field_id
        WHERE cfv.issue_id = $1 AND cfd.org_id = $2
        ORDER BY cfd.position ASC, cfv.created_at ASC
        "#,
    )
    .bind(issue_id)
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        tracing::error!("custom_fields set_values fetch error: {e}");
        internal("Failed to fetch updated values")
    })?;

    Ok(Json(ApiResponse::new(values)))
}
