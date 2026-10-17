use aionui_assistant::{AssistantError, AssistantService};
use std::sync::Arc;

use aionui_common::{CapabilityOrigin, McpTransportCapabilities, ResolvedBackendCapabilities};
use aionui_db::{IAgentMetadataRepository, resolve_agent_binding_from_rows};
use aionui_team::{TeamError, TeamToolCapabilityPort};

pub(crate) struct TeamCapabilityResolver {
    repo: Arc<dyn IAgentMetadataRepository>,
    assistants: Option<Arc<AssistantService>>,
}

impl TeamCapabilityResolver {
    pub(crate) fn new(repo: Arc<dyn IAgentMetadataRepository>) -> Self {
        Self { repo, assistants: None }
    }

    pub(crate) fn with_assistants(repo: Arc<dyn IAgentMetadataRepository>, assistants: Arc<AssistantService>) -> Self {
        let mut resolver = Self::new(repo);
        resolver.assistants = Some(assistants);
        resolver
    }
}

fn declares_xuzhou_stdio(source: &str, agent_type: &str, env: Option<&str>) -> bool {
    source == "custom"
        && agent_type == "acp"
        && env
            .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
            .and_then(|value| value.as_array().cloned())
            .is_some_and(|entries| {
                entries
                    .iter()
                    .any(|entry| entry["name"] == "XUZHOU_BRIDGE_PROTOCOL" && entry["value"] == "team-stdio-v1")
            })
}

fn bool_field(value: &serde_json::Value, key: &str) -> bool {
    value.get(key).and_then(serde_json::Value::as_bool) == Some(true)
}

fn explicit_false(value: &serde_json::Value, path: &[&str]) -> bool {
    let mut cursor = value;
    for key in path {
        let Some(next) = cursor.get(*key) else {
            return false;
        };
        cursor = next;
    }
    cursor.as_bool() == Some(false)
}

fn resolve_acp_handshake(capabilities: Option<&serde_json::Value>) -> ResolvedBackendCapabilities {
    let Some(capabilities) = capabilities else {
        return ResolvedBackendCapabilities {
            cli_fallback: true,
            ..Default::default()
        };
    };
    let mcp = capabilities
        .get("mcp_capabilities")
        .or_else(|| capabilities.get("mcpCapabilities"))
        .or_else(|| capabilities.get("mcp"));
    let streamable_http = mcp.is_some_and(|mcp| bool_field(mcp, "http"));
    let sse = mcp.is_some_and(|mcp| bool_field(mcp, "sse"));
    // Xuzhou's bridge explicitly supports local stdio MCP. Optional remote
    // transports stay false; never require it to claim HTTP/SSE support just
    // to receive the existing Team coordination server.
    let explicit_stdio = capabilities
        .get("_meta")
        .is_some_and(|meta| bool_field(meta, "xuzhou_stdio_mcp"));
    let cli_fallback = ![
        &["shell"][..],
        &["cli"][..],
        &["supports_shell"][..],
        &["supportsShell"][..],
        &["supports_cli"][..],
        &["supportsCli"][..],
        &["execution", "shell"][..],
        &["execution", "cli"][..],
    ]
    .iter()
    .any(|path| explicit_false(capabilities, path));
    ResolvedBackendCapabilities {
        // ACP's stdio support is conservatively inferred only when at least one
        // optional MCP transport was positively advertised, preserving the
        // existing live-probed compatibility heuristic.
        mcp: McpTransportCapabilities {
            stdio: streamable_http || sse || explicit_stdio,
            sse,
            streamable_http,
        },
        cli_fallback,
        origin: CapabilityOrigin::AcpHandshake,
    }
}

#[async_trait::async_trait]
impl TeamToolCapabilityPort for TeamCapabilityResolver {
    async fn resolve_for_assistant(
        &self,
        user_id: &str,
        backend: &str,
        assistant_id: Option<&str>,
    ) -> Result<ResolvedBackendCapabilities, TeamError> {
        let agent_id = match (&self.assistants, assistant_id) {
            (Some(service), Some(id)) => match service.get_for_user(user_id, id).await {
                Ok(assistant) => Some(assistant.agent_id),
                Err(AssistantError::NotFound(_)) => None,
                Err(error) => {
                    return Err(TeamError::InvalidRequest(format!(
                        "assistant capability lookup failed: {error}"
                    )));
                }
            },
            _ => None,
        };
        self.resolve(user_id, backend, agent_id.as_deref()).await
    }

    async fn resolve(
        &self,
        user_id: &str,
        backend: &str,
        agent_id: Option<&str>,
    ) -> Result<ResolvedBackendCapabilities, TeamError> {
        if let Some(descriptor) = aionui_session::backend_capability_descriptor(backend) {
            return Ok(descriptor.resolved());
        }

        let rows = self.repo.list_all_for_user(user_id).await?;
        let selected_id = agent_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .or_else(|| resolve_agent_binding_from_rows(&rows, backend).map(|binding| binding.agent_id));
        let Some(row) = selected_id.and_then(|id| rows.into_iter().find(|row| row.id == id)) else {
            return Ok(ResolvedBackendCapabilities {
                cli_fallback: true,
                ..Default::default()
            });
        };
        // A local bridge registration declares its stdio contract even before a
        // handshake snapshot has been persisted. This applies only to that
        // selected custom ACP connection, never to every generic ACP backend.
        if declares_xuzhou_stdio(&row.agent_source, &row.agent_type, row.env.as_deref()) {
            return Ok(ResolvedBackendCapabilities {
                mcp: McpTransportCapabilities {
                    stdio: true,
                    ..Default::default()
                },
                cli_fallback: false,
                origin: CapabilityOrigin::InternalDescriptor,
            });
        }
        let Some(raw) = row
            .agent_capabilities
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            return Ok(ResolvedBackendCapabilities {
                cli_fallback: true,
                ..Default::default()
            });
        };
        let capabilities = match serde_json::from_str::<serde_json::Value>(raw) {
            Ok(capabilities) => capabilities,
            Err(error) => {
                tracing::warn!(
                    backend,
                    agent_id = %row.id,
                    error = %error,
                    "ignoring malformed persisted backend capability snapshot"
                );
                return Ok(ResolvedBackendCapabilities {
                    cli_fallback: true,
                    ..Default::default()
                });
            }
        };
        Ok(resolve_acp_handshake(Some(&capabilities)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aionui_db::{SqliteAgentMetadataRepository, init_database_memory};

    async fn direct_matrix(snapshot: Option<&str>) -> Vec<ResolvedBackendCapabilities> {
        let db = init_database_memory().await.unwrap();
        if let Some(snapshot) = snapshot {
            for id in ["2d23ff1c", "8e1acf31", "a9f3c21e"] {
                sqlx::query("UPDATE agent_metadata SET agent_capabilities = ? WHERE agent_id = ?")
                    .bind(snapshot)
                    .bind(id)
                    .execute(db.pool())
                    .await
                    .unwrap();
            }
        }
        let resolver = TeamCapabilityResolver::new(Arc::new(SqliteAgentMetadataRepository::new(db.pool().clone())));
        let mut resolved = Vec::new();
        for descriptor in aionui_session::backend_capability_descriptors()
            .iter()
            .filter(|descriptor| descriptor.origin == CapabilityOrigin::DirectDescriptor)
        {
            let capabilities = resolver
                .resolve("system_default_user", descriptor.backend_id, None)
                .await
                .unwrap_or_else(|error| {
                    panic!(
                        "registered direct backend {} did not resolve its constructed capabilities: {error}",
                        descriptor.backend_id
                    )
                });
            assert_eq!(
                capabilities,
                descriptor.resolved(),
                "registered direct backend {} bypassed its constructed descriptor",
                descriptor.backend_id
            );
            resolved.push(capabilities);
        }
        resolved
    }

    #[tokio::test]
    async fn direct_capabilities_are_identical_for_fresh_and_historical_databases() {
        let fresh = direct_matrix(None).await;
        let historical_true = direct_matrix(Some(r#"{"mcp_capabilities":{"http":true,"sse":true}}"#)).await;
        let historical_false = direct_matrix(Some(r#"{"mcp_capabilities":{}}"#)).await;

        assert_eq!(fresh, historical_true);
        assert_eq!(fresh, historical_false);
        assert!(
            fresh
                .iter()
                .all(|caps| caps.origin == CapabilityOrigin::DirectDescriptor)
        );
    }

    #[test]
    fn acp_resolution_preserves_positive_unknown_and_explicit_no_shell_cases() {
        let positive = serde_json::json!({"mcp_capabilities": {"http": true, "sse": false}});
        let positive = resolve_acp_handshake(Some(&positive));
        assert_eq!(positive.origin, CapabilityOrigin::AcpHandshake);
        assert!(positive.mcp.stdio);

        let unknown = resolve_acp_handshake(None);
        assert_eq!(unknown.origin, CapabilityOrigin::Unknown);
        assert!(unknown.cli_fallback);

        let no_shell = serde_json::json!({"mcp_capabilities": {}, "execution": {"shell": false}});
        let no_shell = resolve_acp_handshake(Some(&no_shell));
        assert_eq!(no_shell.origin, CapabilityOrigin::AcpHandshake);
        assert!(!no_shell.mcp.stdio);
        assert!(!no_shell.cli_fallback);
    }

    #[test]
    fn xuzhou_stdio_bridge_receives_team_tools_without_claiming_remote_transports() {
        let caps =
            serde_json::json!({"mcp_capabilities": {"http": false, "sse": false}, "_meta": {"xuzhou_stdio_mcp": true}});
        let resolved = resolve_acp_handshake(Some(&caps));
        assert!(resolved.mcp.stdio);
        assert!(!resolved.mcp.streamable_http && !resolved.mcp.sse);
        for value in [
            serde_json::json!(false),
            serde_json::json!("true"),
            serde_json::Value::Null,
        ] {
            let caps = serde_json::json!({"_meta": {"xuzhou_stdio_mcp": value}});
            assert!(!resolve_acp_handshake(Some(&caps)).mcp.stdio);
        }
    }

    #[test]
    fn only_the_explicit_custom_bridge_contract_enables_unprobed_stdio() {
        let env = r#"[{"name":"XUZHOU_BRIDGE_PROTOCOL","value":"team-stdio-v1"}]"#;
        assert!(declares_xuzhou_stdio("custom", "acp", Some(env)));
        assert!(!declares_xuzhou_stdio("builtin", "acp", Some(env)));
        assert!(!declares_xuzhou_stdio("custom", "aionrs", Some(env)));
        for env in [
            None,
            Some("[]"),
            Some("invalid"),
            Some(r#"[{"name":"XUZHOU_BRIDGE_PROTOCOL","value":"unknown"}]"#),
        ] {
            assert!(!declares_xuzhou_stdio("custom", "acp", env));
        }
    }

    #[tokio::test]
    async fn custom_acp_connections_keep_their_own_transport_identity() {
        let db = init_database_memory().await.unwrap();
        for (id, env) in [
            (
                "xuzhou-bridge",
                r#"[{"name":"XUZHOU_BRIDGE_PROTOCOL","value":"team-stdio-v1"}]"#,
            ),
            ("other-acp", "[]"),
        ] {
            sqlx::query("INSERT INTO agent_metadata (id, agent_id, user_id, name, agent_type, agent_source, env, created_at, updated_at) VALUES (?, ?, ?, ?, 'acp', 'custom', ?, 1, 1)")
                .bind(format!("metadata-{id}"))
                .bind(id)
                .bind("system_default_user")
                .bind(id)
                .bind(env)
                .execute(db.pool())
                .await
                .unwrap();
        }
        let resolver = TeamCapabilityResolver::new(Arc::new(SqliteAgentMetadataRepository::new(db.pool().clone())));
        let own = resolver
            .resolve("system_default_user", "acp", Some("xuzhou-bridge"))
            .await
            .unwrap();
        let other = resolver
            .resolve("system_default_user", "acp", Some("other-acp"))
            .await
            .unwrap();
        assert!(own.mcp.stdio);
        assert!(!other.mcp.stdio);
        assert!(!own.mcp.sse && !own.mcp.streamable_http);
    }
}
