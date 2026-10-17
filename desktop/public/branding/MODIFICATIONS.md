# 续舟 / Xuzhou modifications

Modified locally on 2026-10-14 and 2026-10-15 from AionUi 2.2.2, commit c140550d04e44f3d6f8a9830b40ae56e4689a977. Existing copyright headers and LICENSE are retained.

Changes: independent display name and original chat-boat icon; retained storage IDs, login partitions and protocol compatibility; blocked upstream update paths; unified model selection, native conversation catalog and automatic text synchronization; long conversation retrieval; Lobster sync, maintenance and animated companion. JSON translations and PWA metadata carry this notice by reference rather than non-standard comments.

Modified upstream files:

- bun.lock
- package.json
- packages/desktop/electron-builder.yml
- packages/desktop/src/common/api/ClientFactory.ts
- packages/desktop/src/common/config/constants.ts
- packages/desktop/src/common/platform/index.ts
- packages/desktop/src/common/types/platform/electron.ts
- packages/desktop/src/index.ts
- packages/desktop/src/preload/main.ts
- packages/desktop/src/process/bridge/applicationBridge.ts
- packages/desktop/src/process/bridge/updateBridge.ts
- packages/desktop/src/process/index.ts
- packages/desktop/src/process/startup/windowsAppUserModelId.ts
- packages/desktop/src/process/utils/appMenu.ts
- packages/desktop/src/process/utils/configureChromium.ts
- packages/desktop/src/process/utils/tray.ts
- packages/desktop/src/renderer/components/layout/DocumentTitle.tsx
- packages/desktop/src/renderer/components/layout/Layout.tsx
- packages/desktop/src/renderer/components/layout/Sider/index.tsx
- packages/desktop/src/renderer/components/layout/Titlebar/index.tsx
- packages/desktop/src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx
- packages/desktop/src/renderer/components/settings/UpdateModal.tsx
- packages/desktop/src/renderer/hooks/agent/useAcpConfigOptions.ts
- packages/desktop/src/renderer/index.html
- packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversations.ts
- packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx
- packages/desktop/src/renderer/pages/conversation/GroupedHistory/types.ts
- packages/desktop/src/renderer/pages/conversation/Messages/MessageList.tsx
- packages/desktop/src/renderer/pages/conversation/index.tsx
- packages/desktop/src/renderer/pages/guid/GuidPage.tsx
- packages/desktop/src/renderer/pages/guid/hooks/useGuidAssistantSelection.ts
- packages/desktop/src/renderer/pages/guid/hooks/useGuidSend.ts
- packages/desktop/src/renderer/pages/login/index.tsx
- packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts
- packages/desktop/src/renderer/services/i18n/locales/de-DE/common.json
- packages/desktop/src/renderer/services/i18n/locales/de-DE/conversation.json
- packages/desktop/src/renderer/services/i18n/locales/de-DE/cron.json
- packages/desktop/src/renderer/services/i18n/locales/de-DE/login.json
- packages/desktop/src/renderer/services/i18n/locales/de-DE/preview.json
- packages/desktop/src/renderer/services/i18n/locales/de-DE/settings.json
- packages/desktop/src/renderer/services/i18n/locales/de-DE/update.json
- packages/desktop/src/renderer/services/i18n/locales/en-US/common.json
- packages/desktop/src/renderer/services/i18n/locales/en-US/conversation.json
- packages/desktop/src/renderer/services/i18n/locales/en-US/cron.json
- packages/desktop/src/renderer/services/i18n/locales/en-US/login.json
- packages/desktop/src/renderer/services/i18n/locales/en-US/preview.json
- packages/desktop/src/renderer/services/i18n/locales/en-US/settings.json
- packages/desktop/src/renderer/services/i18n/locales/en-US/update.json
- packages/desktop/src/renderer/services/i18n/locales/es-ES/common.json
- packages/desktop/src/renderer/services/i18n/locales/es-ES/conversation.json
- packages/desktop/src/renderer/services/i18n/locales/es-ES/cron.json
- packages/desktop/src/renderer/services/i18n/locales/es-ES/login.json
- packages/desktop/src/renderer/services/i18n/locales/es-ES/preview.json
- packages/desktop/src/renderer/services/i18n/locales/es-ES/settings.json
- packages/desktop/src/renderer/services/i18n/locales/es-ES/update.json
- packages/desktop/src/renderer/services/i18n/locales/fa-IR/common.json
- packages/desktop/src/renderer/services/i18n/locales/fa-IR/conversation.json
- packages/desktop/src/renderer/services/i18n/locales/fa-IR/cron.json
- packages/desktop/src/renderer/services/i18n/locales/fa-IR/login.json
- packages/desktop/src/renderer/services/i18n/locales/fa-IR/preview.json
- packages/desktop/src/renderer/services/i18n/locales/fa-IR/settings.json
- packages/desktop/src/renderer/services/i18n/locales/fa-IR/update.json
- packages/desktop/src/renderer/services/i18n/locales/fr-FR/common.json
- packages/desktop/src/renderer/services/i18n/locales/fr-FR/conversation.json
- packages/desktop/src/renderer/services/i18n/locales/fr-FR/cron.json
- packages/desktop/src/renderer/services/i18n/locales/fr-FR/login.json
- packages/desktop/src/renderer/services/i18n/locales/fr-FR/preview.json
- packages/desktop/src/renderer/services/i18n/locales/fr-FR/settings.json
- packages/desktop/src/renderer/services/i18n/locales/fr-FR/update.json
- packages/desktop/src/renderer/services/i18n/locales/ja-JP/common.json
- packages/desktop/src/renderer/services/i18n/locales/ja-JP/conversation.json
- packages/desktop/src/renderer/services/i18n/locales/ja-JP/cron.json
- packages/desktop/src/renderer/services/i18n/locales/ja-JP/login.json
- packages/desktop/src/renderer/services/i18n/locales/ja-JP/preview.json
- packages/desktop/src/renderer/services/i18n/locales/ja-JP/settings.json
- packages/desktop/src/renderer/services/i18n/locales/ja-JP/update.json
- packages/desktop/src/renderer/services/i18n/locales/ko-KR/common.json
- packages/desktop/src/renderer/services/i18n/locales/ko-KR/conversation.json
- packages/desktop/src/renderer/services/i18n/locales/ko-KR/cron.json
- packages/desktop/src/renderer/services/i18n/locales/ko-KR/login.json
- packages/desktop/src/renderer/services/i18n/locales/ko-KR/preview.json
- packages/desktop/src/renderer/services/i18n/locales/ko-KR/settings.json
- packages/desktop/src/renderer/services/i18n/locales/ko-KR/update.json
- packages/desktop/src/renderer/services/i18n/locales/pt-BR/common.json
- packages/desktop/src/renderer/services/i18n/locales/pt-BR/conversation.json
- packages/desktop/src/renderer/services/i18n/locales/pt-BR/cron.json
- packages/desktop/src/renderer/services/i18n/locales/pt-BR/login.json
- packages/desktop/src/renderer/services/i18n/locales/pt-BR/preview.json
- packages/desktop/src/renderer/services/i18n/locales/pt-BR/settings.json
- packages/desktop/src/renderer/services/i18n/locales/pt-BR/update.json
- packages/desktop/src/renderer/services/i18n/locales/ru-RU/common.json
- packages/desktop/src/renderer/services/i18n/locales/ru-RU/conversation.json
- packages/desktop/src/renderer/services/i18n/locales/ru-RU/cron.json
- packages/desktop/src/renderer/services/i18n/locales/ru-RU/login.json
- packages/desktop/src/renderer/services/i18n/locales/ru-RU/preview.json
- packages/desktop/src/renderer/services/i18n/locales/ru-RU/settings.json
- packages/desktop/src/renderer/services/i18n/locales/ru-RU/update.json
- packages/desktop/src/renderer/services/i18n/locales/tr-TR/common.json
- packages/desktop/src/renderer/services/i18n/locales/tr-TR/conversation.json
- packages/desktop/src/renderer/services/i18n/locales/tr-TR/cron.json
- packages/desktop/src/renderer/services/i18n/locales/tr-TR/login.json
- packages/desktop/src/renderer/services/i18n/locales/tr-TR/preview.json
- packages/desktop/src/renderer/services/i18n/locales/tr-TR/settings.json
- packages/desktop/src/renderer/services/i18n/locales/tr-TR/update.json
- packages/desktop/src/renderer/services/i18n/locales/uk-UA/common.json
- packages/desktop/src/renderer/services/i18n/locales/uk-UA/conversation.json
- packages/desktop/src/renderer/services/i18n/locales/uk-UA/cron.json
- packages/desktop/src/renderer/services/i18n/locales/uk-UA/login.json
- packages/desktop/src/renderer/services/i18n/locales/uk-UA/preview.json
- packages/desktop/src/renderer/services/i18n/locales/uk-UA/settings.json
- packages/desktop/src/renderer/services/i18n/locales/uk-UA/update.json
- packages/desktop/src/renderer/services/i18n/locales/zh-CN/common.json
- packages/desktop/src/renderer/services/i18n/locales/zh-CN/conversation.json
- packages/desktop/src/renderer/services/i18n/locales/zh-CN/cron.json
- packages/desktop/src/renderer/services/i18n/locales/zh-CN/login.json
- packages/desktop/src/renderer/services/i18n/locales/zh-CN/preview.json
- packages/desktop/src/renderer/services/i18n/locales/zh-CN/settings.json
- packages/desktop/src/renderer/services/i18n/locales/zh-CN/update.json
- packages/desktop/src/renderer/services/i18n/locales/zh-TW/common.json
- packages/desktop/src/renderer/services/i18n/locales/zh-TW/conversation.json
- packages/desktop/src/renderer/services/i18n/locales/zh-TW/cron.json
- packages/desktop/src/renderer/services/i18n/locales/zh-TW/login.json
- packages/desktop/src/renderer/services/i18n/locales/zh-TW/preview.json
- packages/desktop/src/renderer/services/i18n/locales/zh-TW/settings.json
- packages/desktop/src/renderer/services/i18n/locales/zh-TW/update.json
- public/manifest.webmanifest
- public/pwa/icon-180.png
- public/pwa/icon-192.png
- public/pwa/icon-512.png
- tests/unit/acpConfigOptions.test.ts
- tests/unit/providers/ClientFactory.test.ts
- tests/unit/renderer/documentTitle.dom.test.tsx
- tests/unit/renderer/hooks/guidPage.dom.test.tsx
- tests/unit/renderer/useGuidAgentSelection.dom.test.ts
- tests/unit/renderer/useGuidSend.dom.test.ts
- tests/unit/settings/AboutModalContent.dom.test.tsx
- tests/unit/updateBridgeCdnCheck.test.ts
- tests/unit/updateBridgeCdnRewrite.test.ts
- tests/unit/updateBridgeDownloadDedupe.test.ts

New modules: native conversation catalog, same-chat model switching and synchronization, scoped history tools, Lobster panel and original brand assets. Original AionUi brand assets remain in the source tree for provenance. OpenMoji adaptations retain CC BY-SA 4.0. The originally running AionCore binary is preserved; release artifacts use the independently rebuilt replacement described below.

## License remediation, 2026-10-15

Original and explicitly labelled standard license terms were supplemented; fixed-version Rust source packages were checked against Cargo.lock; OpenMoji adaptation and native-library source attachments were added. Public packaging now uses a mandatory licensing gate. The original running AionCore executable and user data are preserved. The release Core is independently rebuilt with the restricted PDF corpus omitted and replaced by Apache-2.0 instructions.

Additional modified upstream files: scripts/build-with-builder.js; packages/desktop/electron-builder.yml; settings.json in all supported locales. New build-time files: scripts/licensing/verify.cjs and README.md; tests/unit/releaseLicenseGate.test.ts.

## Windows Core release fix, 2026-10-16

`crates/aionui-extension/src/skill_service.rs`: remove Windows directory reparse points with the directory-link operation so dangling junctions can be replaced. The removal does not recurse into a linked target. Regression coverage includes replacing a dangling link and preserving the contents of a live linked source. Existing Unix behavior is retained. Windows-only shell/path fixtures and repository-local Git test settings are recorded in the Core source modification notice.

`workbench/integrations/aionui/kiro/history.cjs` (2026-10-16): history synchronization now reads the native failed terminal state as well as idle, after real CLI replay verification. Active and unknown states still wait; history reads do not generate model turns or change provider quotas.

`workbench/integrations/aionui/workspace/auto-sync.cjs` (2026-10-16): a stable, explicitly failed Kiro V3 turn may synchronize its submitted user record without an assistant reply. Two unchanged polls, completed-message validation, immutable-prefix checks and echo protection remain in effect. Active, idle, unknown and legacy user-only tails keep waiting.

2026-10-15 release additions: independently rebuilt Core PDF replacement; unchanged SQL normalized to compatible Windows CRLF; bundled Node and portable bridge; existing-profile pointer; exact resource/build gate and stock NSIS installer. User databases and original runtime binary are not release build inputs.

## 2.2.3 changes, 2026-10-16

Original non-pixel crayfish sprite and animation replace the prior character. Device controls retained from the isolated preview. Browser permission checks, navigation/webview isolation, disabled diagnostic collection/upload, explicit full-owner phone pairing consent, current Electron 44.8.0, 13 locale disclosures, portable release roots, privacy and security documentation added. Modified files retain upstream headers; new modules are Xuzhou contributions. Storage IDs, original profiles and installed 2.2.2 are preserved. This is a candidate until its exact final artifacts are verified.

## 2.3.0-preview.1, 2026-10-16

Xuzhou-specific software/model selection and conversation-level context/sync desk. New compatible continuity modules validate native acknowledgements, transcript prefixes, per-provider cursors and completed-turn receipts. Completed local transcript writes wake the existing synchronization loop, preserving polling, pause state, stable delivery receipts and conflict protection. No third-party dependencies added. Original AionUi/AionCore and all applicable notices remain. This preview has not completed public release approval.

## 2.3.1-beta.1 · 2026-10-16

Xuzhou additions: own navigation and control center; content-addressed image continuation; reviewed Codex synchronization; experimental encrypted USB backup and signed update-manifest checks. The beta installer, shortcuts, profile pointer and default user-data folder are separate from the stable channel. Beta startup does not register the existing aionui protocol or import the legacy workbench profile. No Core, SQL migration or external dependency upgrade is included in this beta. See the release feature matrix for unconnected and unaccepted functions.

## 2.3.1-beta.2 · 2026-10-16

Xuzhou modifications: native model discovery before creating a chat; selection-aware Codex/Kiro V3/ZCode conversation creation; merged asynchronous Kiro configuration updates; acknowledged recovery of missing unsent ZCode sessions; local connections for AI team members; removal of Claude software, Aion CLI and upstream preset-assistant launch entries. Existing conversation rows and original copyright/license notices are retained. No external dependencies or SQL migrations changed.

Windows session writes retry transient sharing errors without deleting the previous record; native Codex empty-session recovery uses the canonical visible transcript. Settings and error-diagnosis shortcuts now open the same Xuzhou chat instead of enabling an upstream preset assistant. The bridge explicitly acknowledges its default permission mode and rejects unsupported modes.

Modified desktop areas: GuidPage and DraftModelPicker; assistant catalog loaders and support policy; LocalAgents and AssistantHomeTabs; TeamCreateModal, team model resolution and team assistant options; platform workspace types; settings/team strings in all 13 locales. Bridge, native session routing and synchronization changes are in workbench/integrations/aionui. Corresponding focused tests accompany the source.

Team selection now lists specific native AI models with distinct identities for models on the same connection. Team creation and member additions preserve the selected model and reject unavailable choices. Members can be added or removed without deleting their chats or shared project files. Removed conversations become local chats with their previous Team tool binding cleared. The bridge declares its local stdio MCP contract in registration and ACP metadata. Core resolves the selected assistant's actual connection instead of treating all custom ACP members as one backend, and recognizes that contract without claiming HTTP or SSE support. Existing bridge registrations are re-probed once for this transport contract. Core changes are limited to Team transport resolution and member-history retention, with targeted regression tests; original Core copyright and license notices remain.

2026-10-17: fieldless Codex MCP elicitation forms now use the existing host permission card and return its actual allow or deny decision. Forms requiring answers, URL flows and composite schemas are not silently accepted. The native adapter and bridge include regression coverage for confirmation, rejection and unsupported form data.

2026-10-17 local interaction revision: the original animated Xuzhou crayfish is a draggable launcher shared by ordinary and Team chats, with project-scoped activity, chat/sync, listening, repair and connection actions. Team workspaces select the matching Lobster project automatically. Collaboration activity exposes actual incoming/outgoing text, report bodies and receipts, local bridge calls and Gateway tool events; it distinguishes a queued report, a tool result and task completion. The Gateway client advertises tool-event support without adding authorization scopes. Optional remembered MCP access is bound to the chat, provider, tool and attached server configuration and can be revoked from both chat and Team model controls. Existing copyright notices and chat storage remain in place; no dependency or database migration was added.
