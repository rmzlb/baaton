//! Advanced filter engine for Baaton API.
//!
//! Supports Linear-style filtering with comparators, logical operators,
//! and relationship traversal — designed for AI agent consumption.
//!
//! Example filter JSON:
//! ```json
//! {
//!   "priority": { "in": ["urgent", "high"] },
//!   "status": { "neq": "done" },
//!   "due_date": { "lt": "2026-04-01" },
//!   "created_at": { "gt": "2026-01-01T00:00:00Z" },
//!   "title": { "contains": "login" },
//!   "assignee_ids": { "contains": "user_123" },
//!   "or": [
//!     { "priority": { "eq": "urgent" } },
//!     { "due_date": { "lt": "2026-03-20" } }
//!   ]
//! }
//! ```

use serde::Deserialize;
use serde_json::Value;

/// A parsed filter that generates SQL WHERE clauses with bind parameters.
#[derive(Debug)]
pub struct FilterClause {
    pub sql: String,
    pub params: Vec<FilterParam>,
}

#[derive(Debug, Clone)]
pub enum FilterParam {
    String(String),
    StringList(Vec<String>),
    Int(i64),
    Float(f64),
    Bool(bool),
    Null,
}

/// Known fields and their SQL column mappings + types
struct FieldDef {
    column: &'static str,
    kind: FieldKind,
}

#[derive(Clone, Copy)]
enum FieldKind {
    Text,
    TextNullable,
    TextArray,
    Date,
    Timestamp,
    Int,
    Float,
    Bool,
}

fn field_defs() -> Vec<(&'static str, FieldDef)> {
    vec![
        ("status", FieldDef { column: "i.status", kind: FieldKind::Text }),
        ("priority", FieldDef { column: "i.priority", kind: FieldKind::TextNullable }),
        ("issue_type", FieldDef { column: "i.type", kind: FieldKind::Text }),
        ("type", FieldDef { column: "i.type", kind: FieldKind::Text }),
        ("title", FieldDef { column: "i.title", kind: FieldKind::Text }),
        ("description", FieldDef { column: "i.description", kind: FieldKind::TextNullable }),
        ("display_id", FieldDef { column: "i.display_id", kind: FieldKind::Text }),
        ("source", FieldDef { column: "i.source", kind: FieldKind::Text }),
        ("tags", FieldDef { column: "i.tags", kind: FieldKind::TextArray }),
        ("category", FieldDef { column: "i.category", kind: FieldKind::TextArray }),
        ("assignee_ids", FieldDef { column: "i.assignee_ids", kind: FieldKind::TextArray }),
        ("due_date", FieldDef { column: "i.due_date", kind: FieldKind::Date }),
        ("created_at", FieldDef { column: "i.created_at", kind: FieldKind::Timestamp }),
        ("updated_at", FieldDef { column: "i.updated_at", kind: FieldKind::Timestamp }),
        ("closed_at", FieldDef { column: "i.closed_at", kind: FieldKind::Timestamp }),
        ("estimate", FieldDef { column: "i.estimate", kind: FieldKind::Int }),
        ("position", FieldDef { column: "i.position", kind: FieldKind::Float }),
        ("archived", FieldDef { column: "i.archived", kind: FieldKind::Bool }),
        ("created_by_id", FieldDef { column: "i.created_by_id", kind: FieldKind::TextNullable }),
        ("reporter_name", FieldDef { column: "i.reporter_name", kind: FieldKind::TextNullable }),
        ("reporter_email", FieldDef { column: "i.reporter_email", kind: FieldKind::TextNullable }),
    ]
}

/// Parse a filter JSON value into a SQL WHERE clause.
/// Returns None if the filter is empty or invalid.
/// `param_offset` is the starting $N index for bind parameters.
pub fn parse_filter(filter: &Value, param_offset: usize) -> Option<FilterClause> {
    if filter.is_null() || (filter.is_object() && filter.as_object().unwrap().is_empty()) {
        return None;
    }

    let obj = filter.as_object()?;
    let defs = field_defs();

    let mut clauses: Vec<String> = Vec::new();
    let mut params: Vec<FilterParam> = Vec::new();
    let mut idx = param_offset;

    // Handle "or" operator
    if let Some(or_val) = obj.get("or") {
        if let Some(or_arr) = or_val.as_array() {
            let mut or_clauses = Vec::new();
            for item in or_arr {
                if let Some(sub) = parse_filter(item, idx) {
                    idx += sub.params.len();
                    or_clauses.push(format!("({})", sub.sql));
                    params.extend(sub.params);
                }
            }
            if !or_clauses.is_empty() {
                clauses.push(format!("({})", or_clauses.join(" OR ")));
            }
        }
    }

    // Handle "and" operator (explicit)
    if let Some(and_val) = obj.get("and") {
        if let Some(and_arr) = and_val.as_array() {
            for item in and_arr {
                if let Some(sub) = parse_filter(item, idx) {
                    idx += sub.params.len();
                    clauses.push(format!("({})", sub.sql));
                    params.extend(sub.params);
                }
            }
        }
    }

    // Handle field-level comparators
    for (field_name, field_def) in &defs {
        if let Some(comparators) = obj.get(*field_name) {
            if let Some(comp_obj) = comparators.as_object() {
                for (op, val) in comp_obj {
                    if let Some((sql, new_params)) = build_comparator(
                        field_def.column,
                        field_def.kind,
                        op,
                        val,
                        &mut idx,
                    ) {
                        clauses.push(sql);
                        params.extend(new_params);
                    }
                }
            } else {
                // Shorthand: "status": "done" → "status": { "eq": "done" }
                if let Some((sql, new_params)) = build_comparator(
                    field_def.column,
                    field_def.kind,
                    "eq",
                    comparators,
                    &mut idx,
                ) {
                    clauses.push(sql);
                    params.extend(new_params);
                }
            }
        }
    }

    if clauses.is_empty() {
        return None;
    }

    Some(FilterClause {
        sql: clauses.join(" AND "),
        params,
    })
}

fn build_comparator(
    column: &str,
    kind: FieldKind,
    op: &str,
    val: &Value,
    idx: &mut usize,
) -> Option<(String, Vec<FilterParam>)> {
    match op {
        "eq" => {
            *idx += 1;
            let param = value_to_param(val, kind)?;
            Some((format!("{} = ${}", column, *idx), vec![param]))
        }
        "neq" => {
            *idx += 1;
            let param = value_to_param(val, kind)?;
            Some((format!("({} IS NULL OR {} != ${})", column, column, *idx), vec![param]))
        }
        "in" => {
            let arr = val.as_array()?;
            let values: Vec<String> = arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect();
            if values.is_empty() { return None; }
            *idx += 1;
            Some((format!("{} = ANY(${})", column, *idx), vec![FilterParam::StringList(values)]))
        }
        "nin" => {
            let arr = val.as_array()?;
            let values: Vec<String> = arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect();
            if values.is_empty() { return None; }
            *idx += 1;
            Some((format!("({} IS NULL OR {} != ALL(${})) ", column, column, *idx), vec![FilterParam::StringList(values)]))
        }
        "lt" => {
            *idx += 1;
            let param = value_to_param(val, kind)?;
            Some((format!("{} < ${}", column, *idx), vec![param]))
        }
        "lte" => {
            *idx += 1;
            let param = value_to_param(val, kind)?;
            Some((format!("{} <= ${}", column, *idx), vec![param]))
        }
        "gt" => {
            *idx += 1;
            let param = value_to_param(val, kind)?;
            Some((format!("{} > ${}", column, *idx), vec![param]))
        }
        "gte" => {
            *idx += 1;
            let param = value_to_param(val, kind)?;
            Some((format!("{} >= ${}", column, *idx), vec![param]))
        }
        "contains" => {
            match kind {
                FieldKind::TextArray => {
                    // For array fields: check if value is in array
                    *idx += 1;
                    let s = val.as_str()?;
                    Some((format!("${} = ANY({})", *idx, column), vec![FilterParam::String(s.to_string())]))
                }
                _ => {
                    // For text fields: ILIKE
                    *idx += 1;
                    let s = val.as_str()?;
                    Some((format!("{} ILIKE '%' || ${} || '%'", column, *idx), vec![FilterParam::String(s.to_string())]))
                }
            }
        }
        "not_contains" | "notContains" => {
            match kind {
                FieldKind::TextArray => {
                    *idx += 1;
                    let s = val.as_str()?;
                    Some((format!("NOT (${} = ANY({}))", *idx, column), vec![FilterParam::String(s.to_string())]))
                }
                _ => {
                    *idx += 1;
                    let s = val.as_str()?;
                    Some((format!("{} NOT ILIKE '%' || ${} || '%'", column, *idx), vec![FilterParam::String(s.to_string())]))
                }
            }
        }
        "starts_with" | "startsWith" => {
            *idx += 1;
            let s = val.as_str()?;
            Some((format!("{} ILIKE ${} || '%'", column, *idx), vec![FilterParam::String(s.to_string())]))
        }
        "ends_with" | "endsWith" => {
            *idx += 1;
            let s = val.as_str()?;
            Some((format!("{} ILIKE '%' || ${}", column, *idx), vec![FilterParam::String(s.to_string())]))
        }
        "null" | "is_null" | "isNull" => {
            let is_null = val.as_bool().unwrap_or(true);
            if is_null {
                Some((format!("{} IS NULL", column), vec![]))
            } else {
                Some((format!("{} IS NOT NULL", column), vec![]))
            }
        }
        _ => None, // Unknown operator, skip
    }
}

fn value_to_param(val: &Value, _kind: FieldKind) -> Option<FilterParam> {
    match val {
        Value::String(s) => Some(FilterParam::String(s.clone())),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Some(FilterParam::Int(i))
            } else if let Some(f) = n.as_f64() {
                Some(FilterParam::Float(f))
            } else {
                None
            }
        }
        Value::Bool(b) => Some(FilterParam::Bool(*b)),
        Value::Null => Some(FilterParam::Null),
        _ => None,
    }
}

/// Build a dynamic SQL query with filter applied.
/// Returns the full WHERE clause (including base conditions) and all params.
pub fn apply_filter_to_query(
    filter_json: Option<&str>,
    base_conditions: &str,
    base_param_count: usize,
) -> (String, Vec<FilterParam>) {
    let mut where_clause = base_conditions.to_string();
    let mut params = Vec::new();

    if let Some(filter_str) = filter_json {
        if let Ok(filter_val) = serde_json::from_str::<Value>(filter_str) {
            if let Some(filter_clause) = parse_filter(&filter_val, base_param_count) {
                where_clause = format!("{} AND ({})", where_clause, filter_clause.sql);
                params = filter_clause.params;
            }
        }
    }

    (where_clause, params)
}

/// Pagination cursor — encodes (created_at, id) or (updated_at, id)
#[derive(Debug, Clone, Deserialize)]
pub struct CursorParams {
    /// Cursor from previous response (base64 encoded)
    pub after: Option<String>,
    pub before: Option<String>,
    pub first: Option<i64>,
    pub last: Option<i64>,
    /// Order by: "created_at" (default) or "updated_at"
    pub order_by: Option<String>,
    /// Direction: "asc" or "desc" (default)
    pub order_direction: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PageInfo {
    pub has_next_page: bool,
    pub has_previous_page: bool,
    pub start_cursor: Option<String>,
    pub end_cursor: Option<String>,
    pub total_count: Option<i64>,
}

/// Encode a cursor from (timestamp, id)
pub fn encode_cursor(timestamp: &str, id: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(format!("{}|{}", timestamp, id))
}

/// Decode a cursor into (timestamp, id)
pub fn decode_cursor(cursor: &str) -> Option<(String, String)> {
    use base64::Engine;
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(cursor).ok()?;
    let s = String::from_utf8(decoded).ok()?;
    let parts: Vec<&str> = s.splitn(2, '|').collect();
    if parts.len() == 2 {
        Some((parts[0].to_string(), parts[1].to_string()))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_simple_eq_filter() {
        let filter = json!({ "status": { "eq": "done" } });
        let result = parse_filter(&filter, 2).unwrap();
        assert_eq!(result.sql, "i.status = $3");
        assert_eq!(result.params.len(), 1);
    }

    #[test]
    fn test_in_filter() {
        let filter = json!({ "priority": { "in": ["urgent", "high"] } });
        let result = parse_filter(&filter, 0).unwrap();
        assert_eq!(result.sql, "i.priority = ANY($1)");
    }

    #[test]
    fn test_or_filter() {
        let filter = json!({
            "or": [
                { "priority": { "eq": "urgent" } },
                { "status": { "eq": "done" } }
            ]
        });
        let result = parse_filter(&filter, 0).unwrap();
        assert!(result.sql.contains("OR"));
    }

    #[test]
    fn test_combined_filter() {
        let filter = json!({
            "status": { "neq": "done" },
            "priority": { "in": ["urgent", "high"] },
            "title": { "contains": "login" }
        });
        let result = parse_filter(&filter, 0).unwrap();
        assert!(result.sql.contains("AND"));
        assert_eq!(result.params.len(), 3);
    }

    #[test]
    fn test_null_filter() {
        let filter = json!({ "due_date": { "null": true } });
        let result = parse_filter(&filter, 0).unwrap();
        assert_eq!(result.sql, "i.due_date IS NULL");
        assert_eq!(result.params.len(), 0);
    }

    #[test]
    fn test_shorthand() {
        let filter = json!({ "status": "done" });
        let result = parse_filter(&filter, 0).unwrap();
        assert_eq!(result.sql, "i.status = $1");
    }

    #[test]
    fn test_cursor_encode_decode() {
        let cursor = encode_cursor("2026-03-15T05:00:00Z", "abc-123");
        let (ts, id) = decode_cursor(&cursor).unwrap();
        assert_eq!(ts, "2026-03-15T05:00:00Z");
        assert_eq!(id, "abc-123");
    }

    #[test]
    fn test_array_contains() {
        let filter = json!({ "tags": { "contains": "bug" } });
        let result = parse_filter(&filter, 0).unwrap();
        assert_eq!(result.sql, "$1 = ANY(i.tags)");
    }

    #[test]
    fn test_empty_filter() {
        let filter = json!({});
        assert!(parse_filter(&filter, 0).is_none());
    }
}
