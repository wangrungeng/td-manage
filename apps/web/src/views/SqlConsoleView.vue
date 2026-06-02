<template>
  <section class="page-card fill-card sql-console sql-workbench">
    <aside class="sql-library">
      <div class="sql-panel-heading">
        <div>
          <h3>常用查询</h3>
          <p>按当前变量生成 SQL</p>
        </div>
      </div>

      <div class="quick-sql-grid">
        <button v-for="item in quickSqlTemplates" :key="item.key" class="quick-sql-item" type="button" @click="applyTemplate(item)">
          <span>{{ item.title }}</span>
          <small>{{ item.desc }}</small>
        </button>
      </div>

      <el-divider />

      <div class="sql-panel-heading">
        <div>
          <h3>脚本库</h3>
          <p>保存在本地 SQLite</p>
        </div>
        <el-button :icon="FolderAdd" circle title="新增文件夹" @click="createFolder" />
      </div>

      <div class="folder-toolbar">
        <el-select v-model="selectedFolderId" placeholder="选择文件夹" style="width: 100%" @change="selectFirstScriptInFolder">
          <el-option v-for="folder in folders" :key="folder.id" :label="folder.name" :value="folder.id" />
        </el-select>
        <el-button :icon="EditPen" title="重命名文件夹" @click="renameFolder" />
      </div>

      <div class="script-actions">
        <el-button :icon="Plus" type="primary" @click="createScript">新脚本</el-button>
        <el-button :icon="DocumentChecked" :disabled="!selectedScript" @click="saveScript">保存</el-button>
        <el-button :icon="EditPen" :disabled="!selectedScript" @click="renameScript">重命名</el-button>
      </div>

      <div class="script-list">
        <button
          v-for="script in folderScripts"
          :key="script.id"
          class="script-list-item"
          :class="{ active: script.id === selectedScriptId }"
          type="button"
          @click="openScript(script.id)"
        >
          <span>{{ script.name }}</span>
          <small>{{ formatTime(script.updatedAt) }}</small>
        </button>
        <el-empty v-if="!folderScripts.length" description="暂无脚本" :image-size="64" />
      </div>
    </aside>

    <main class="sql-main">
      <div class="toolbar sql-variable-bar">
        <el-select v-model="connectionId" placeholder="选择连接" style="width: 220px">
          <el-option v-for="item in connections" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
        <el-input v-model="database" placeholder="数据库，可选" style="width: 180px" />
        <el-input v-model="tableName" placeholder="表名/超级表" style="width: 190px" />
        <el-date-picker
          v-model="timeRange"
          type="datetimerange"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          value-format="YYYY-MM-DD HH:mm:ss"
          style="width: 360px"
        />
        <el-input-number v-model="limit" :min="1" :max="10000" />
      </div>

      <div class="toolbar sql-action-bar">
        <el-button :icon="Search" @click="preview">预览风险</el-button>
        <el-button :icon="VideoPlay" type="primary" @click="execute">执行</el-button>
        <el-button :icon="DocumentCopy" @click="copySqlToScript">存为脚本</el-button>
        <el-input v-model="confirmText" placeholder="写 SQL 输入 CONFIRM" style="width: 220px" />
      </div>

      <el-input
        ref="sqlEditorRef"
        v-model="sql"
        type="textarea"
        :rows="10"
        class="mono sql-editor"
        placeholder="SELECT * FROM db.table WHERE ts >= '...' LIMIT 100"
        @keydown.ctrl.enter.prevent="executeActiveSql"
      />

      <el-alert
        style="margin: 14px 0"
        type="warning"
        show-icon
        :closable="false"
        title="写 SQL 必须输入 CONFIRM；DROP/ALTER/CREATE/IMPORT/UPDATE 默认禁止。"
      />

      <pre v-if="previewSql" class="sql-preview sql-preview-compact mono">{{ previewSql }}</pre>
      <div class="sql-result">
        <el-table :data="pagedRows" border height="100%" style="margin-top: 14px">
          <el-table-column v-for="column in columns" :key="column" :prop="column" :label="column" min-width="160" show-overflow-tooltip />
        </el-table>
      </div>
      <div v-if="rows.length" class="sql-pagination">
        <span>共 {{ rows.length }} 行</span>
        <el-pagination
          v-model:current-page="resultPage"
          v-model:page-size="resultPageSize"
          :total="rows.length"
          :page-sizes="[20, 50, 100, 200]"
          small
          background
          layout="sizes, prev, pager, next"
        />
      </div>
    </main>
  </section>
</template>

<script setup lang="ts">
import dayjs from "dayjs";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  DocumentChecked,
  DocumentCopy,
  EditPen,
  FolderAdd,
  Plus,
  Search,
  VideoPlay
} from "@element-plus/icons-vue";
import { http } from "../api/http";

interface ConnectionItem { id: string; name: string }
interface SqlFolder { id: string; name: string; createdAt: string; updatedAt: string }
interface SqlScript { id: string; folderId: string; name: string; sql: string; createdAt: string; updatedAt: string }
interface QuickSqlTemplate {
  key: string;
  title: string;
  desc: string;
  build: () => string;
}

const connections = ref<ConnectionItem[]>([]);
const connectionId = ref("");
const database = ref("");
const tableName = ref("");
const timeRange = ref<[string, string]>([
  dayjs().subtract(1, "hour").format("YYYY-MM-DD HH:mm:ss"),
  dayjs().format("YYYY-MM-DD HH:mm:ss")
]);
const limit = ref(100);
const sql = ref("SHOW DATABASES");
const sqlEditorRef = ref<{ $el?: HTMLElement } | null>(null);
const confirmText = ref("");
const previewSql = ref("");
const rows = ref<Record<string, unknown>[]>([]);
const resultPage = ref(1);
const resultPageSize = ref(50);
const folders = ref<SqlFolder[]>([]);
const scripts = ref<SqlScript[]>([]);
const selectedFolderId = ref("");
const selectedScriptId = ref("");
let shortcutSaving = false;
const columns = computed(() => Array.from(new Set(rows.value.flatMap((row) => Object.keys(row)))));
const pagedRows = computed(() => {
  const start = (resultPage.value - 1) * resultPageSize.value;
  return rows.value.slice(start, start + resultPageSize.value);
});
const selectedScript = computed(() => scripts.value.find((item) => item.id === selectedScriptId.value));
const folderScripts = computed(() =>
  scripts.value
    .filter((item) => item.folderId === selectedFolderId.value)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
);

const quickSqlTemplates: QuickSqlTemplate[] = [
  { key: "show-dbs", title: "数据库列表", desc: "SHOW DATABASES", build: () => "SHOW DATABASES" },
  { key: "show-tables", title: "普通表列表", desc: "SHOW TABLES", build: () => "SHOW TABLES" },
  { key: "show-stables", title: "超级表列表", desc: "SHOW STABLES", build: () => "SHOW STABLES" },
  { key: "describe", title: "表结构", desc: "DESCRIBE", build: () => `DESCRIBE ${fullName()}` },
  {
    key: "recent",
    title: "最近数据",
    desc: "时间范围 + 倒序",
    build: () => `SELECT * FROM ${fullName()} WHERE \`ts\` >= '${timeRange.value[0]}' AND \`ts\` <= '${timeRange.value[1]}' ORDER BY \`ts\` DESC LIMIT ${limit.value}`
  },
  {
    key: "count",
    title: "数量统计",
    desc: "COUNT(*)",
    build: () => `SELECT COUNT(*) AS total FROM ${fullName()} WHERE \`ts\` >= '${timeRange.value[0]}' AND \`ts\` <= '${timeRange.value[1]}'`
  },
  {
    key: "last-row",
    title: "最后一条",
    desc: "LAST_ROW",
    build: () => `SELECT LAST_ROW(*) FROM ${fullName()}`
  },
  {
    key: "tbname",
    title: "子表列表",
    desc: "tbname 去重",
    build: () => `SELECT tbname FROM ${fullName()} WHERE \`ts\` >= '${timeRange.value[0]}' AND \`ts\` <= '${timeRange.value[1]}' GROUP BY tbname LIMIT ${limit.value}`
  }
];

onMounted(async () => {
  window.addEventListener("keydown", handleShortcutSave);
  await loadScriptLibrary();
  connections.value = await http.get<ConnectionItem[]>("/connections");
  connectionId.value = connections.value[0]?.id || "";
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleShortcutSave);
});

async function preview() {
  const result = await http.post<{ sql: string; riskLevel: string }>(`/tdengine/${connectionId.value}/sql/preview`, {
    database: database.value,
    sql: sql.value
  });
  previewSql.value = `${result.sql}\n\n风险级别：${result.riskLevel}`;
}

async function execute() {
  const result = await http.post<{ sql: string; rows: Record<string, unknown>[] }>(`/tdengine/${connectionId.value}/sql/execute`, {
    database: database.value,
    sql: sql.value,
    confirmText: confirmText.value
  });
  previewSql.value = result.sql;
  rows.value = result.rows;
  resultPage.value = 1;
  ElMessage.success("执行完成");
}

function applyTemplate(template: QuickSqlTemplate) {
  sql.value = template.build();
  previewSql.value = "";
}

async function executeActiveSql() {
  const targetSql = readActiveSql();
  if (!targetSql) {
    ElMessage.warning("没有可执行的 SQL");
    return;
  }

  const result = await http.post<{ sql: string; rows: Record<string, unknown>[] }>(`/tdengine/${connectionId.value}/sql/execute`, {
    database: database.value,
    sql: targetSql,
    confirmText: confirmText.value
  });
  previewSql.value = result.sql;
  rows.value = result.rows;
  resultPage.value = 1;
  ElMessage.success("执行完成");
}

function readActiveSql() {
  const textarea = sqlEditorRef.value?.$el?.querySelector<HTMLTextAreaElement>("textarea");
  if (!textarea) return sql.value.trim();

  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? 0;
  if (start !== end) {
    return textarea.value.slice(start, end).trim();
  }

  const lineStart = textarea.value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextLineBreak = textarea.value.indexOf("\n", start);
  const lineEnd = nextLineBreak === -1 ? textarea.value.length : nextLineBreak;
  return textarea.value.slice(lineStart, lineEnd).trim();
}

async function createFolder() {
  const { value } = await ElMessageBox.prompt("请输入文件夹名称", "新增文件夹", {
    inputValue: "常用查询",
    inputValidator: (input) => Boolean(input?.trim()),
    inputErrorMessage: "文件夹名称不能为空"
  });
  const folder = await http.post<SqlFolder>("/sql-scripts/folders", { name: value.trim() });
  folders.value.push(folder);
  selectedFolderId.value = folder.id;
}

async function renameFolder() {
  const folder = folders.value.find((item) => item.id === selectedFolderId.value);
  if (!folder) return;
  const { value } = await ElMessageBox.prompt("请输入新的文件夹名称", "重命名文件夹", {
    inputValue: folder.name,
    inputValidator: (input) => Boolean(input?.trim()),
    inputErrorMessage: "文件夹名称不能为空"
  });
  const updated = await http.patch<SqlFolder>(`/sql-scripts/folders/${folder.id}`, { name: value.trim() });
  Object.assign(folder, updated);
}

async function createScript() {
  await ensureFolder();
  const { value } = await ElMessageBox.prompt("请输入脚本名称", "新增脚本", {
    inputValue: "新 SQL 脚本",
    inputValidator: (input) => Boolean(input?.trim()),
    inputErrorMessage: "脚本名称不能为空"
  });
  const script = await http.post<SqlScript>("/sql-scripts/scripts", {
    folderId: selectedFolderId.value,
    name: value.trim(),
    sql: sql.value
  });
  scripts.value.push(script);
  selectedScriptId.value = script.id;
  ElMessage.success("脚本已创建");
}

async function renameScript() {
  const script = selectedScript.value;
  if (!script) return;
  const { value } = await ElMessageBox.prompt("请输入新的脚本名称", "重命名脚本", {
    inputValue: script.name,
    inputValidator: (input) => Boolean(input?.trim()),
    inputErrorMessage: "脚本名称不能为空"
  });
  const updated = await http.patch<SqlScript>(`/sql-scripts/scripts/${script.id}`, { name: value.trim() });
  Object.assign(script, updated);
}

async function saveScript() {
  const script = selectedScript.value;
  if (!script) {
    ElMessage.warning("请先选择或新建脚本");
    return;
  }
  const updated = await http.patch<SqlScript>(`/sql-scripts/scripts/${script.id}`, { sql: sql.value });
  Object.assign(script, updated);
  ElMessage.success("脚本已保存");
}

async function copySqlToScript() {
  await createScript();
}

function handleShortcutSave(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
  event.preventDefault();
  if (event.repeat || shortcutSaving) return;

  shortcutSaving = true;
  void saveScriptByShortcut()
    .catch((error: unknown) => {
      if (error !== "cancel" && error !== "close") {
        ElMessage.error("保存脚本失败");
        console.error(error);
      }
    })
    .finally(() => {
      shortcutSaving = false;
    });
}

async function saveScriptByShortcut() {
  if (selectedScript.value) {
    await saveScript();
    return;
  }
  await copySqlToScript();
}

function openScript(scriptId: string) {
  const script = scripts.value.find((item) => item.id === scriptId);
  if (!script) return;
  selectedScriptId.value = script.id;
  sql.value = script.sql;
  previewSql.value = "";
}

function selectFirstScriptInFolder() {
  selectedScriptId.value = folderScripts.value[0]?.id || "";
  if (selectedScriptId.value) {
    openScript(selectedScriptId.value);
  }
}

async function loadScriptLibrary() {
  const store = await http.get<{ folders: SqlFolder[]; scripts: SqlScript[] }>("/sql-scripts/library");
  folders.value = store.folders;
  scripts.value = store.scripts;
  selectedFolderId.value = folders.value[0]?.id || "";
}

async function ensureFolder() {
  if (selectedFolderId.value) return;
  const folder = await http.post<SqlFolder>("/sql-scripts/folders", { name: "默认文件夹" });
  folders.value.push(folder);
  selectedFolderId.value = folder.id;
}

function fullName() {
  const table = tableName.value.trim() || "table";
  const db = database.value.trim();
  return db ? `${quoteName(db)}.${quoteName(table)}` : quoteName(table);
}

function quoteName(name: string) {
  return `\`${name.replace(/`/g, "``")}\``;
}

function formatTime(value: string) {
  return dayjs(value).format("MM-DD HH:mm");
}
</script>

<style scoped>
.sql-workbench {
  display: grid;
  grid-template-columns: 330px minmax(0, 1fr);
  gap: 18px;
  min-height: 100%;
}

.sql-library,
.sql-main {
  min-width: 0;
  min-height: 0;
}

.sql-library {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-right: 16px;
  border-right: 1px solid rgba(216, 209, 195, 0.9);
}

.sql-main {
  display: flex;
  flex-direction: column;
}

.sql-panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.sql-panel-heading h3 {
  margin: 0;
  font-size: 17px;
}

.sql-panel-heading p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.quick-sql-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.quick-sql-item,
.script-list-item {
  width: 100%;
  border: 1px solid rgba(216, 209, 195, 0.9);
  border-radius: 10px;
  background: rgba(255, 253, 248, 0.68);
  color: var(--ink);
  cursor: pointer;
  text-align: left;
  transition: 0.16s ease;
}

.quick-sql-item {
  min-height: 64px;
  padding: 10px;
}

.quick-sql-item:hover,
.script-list-item:hover,
.script-list-item.active {
  border-color: rgba(240, 162, 2, 0.85);
  background: rgba(240, 162, 2, 0.13);
}

.quick-sql-item span,
.script-list-item span {
  display: block;
  font-weight: 700;
}

.quick-sql-item small,
.script-list-item small {
  display: block;
  margin-top: 5px;
  color: var(--muted);
  font-size: 12px;
}

.folder-toolbar,
.script-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.script-actions .el-button {
  flex: 1;
}

.script-list {
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.script-list-item {
  margin-bottom: 8px;
  padding: 10px 12px;
}

.sql-variable-bar,
.sql-action-bar {
  flex: 0 0 auto;
  margin-bottom: 12px;
}

.sql-editor {
  flex: 0 0 auto;
}

.sql-preview-compact {
  margin: 10px 0 0;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.45;
}

.sql-pagination {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 10px;
  color: var(--muted);
  font-size: 12px;
}

@media (max-width: 1280px) {
  .sql-workbench {
    grid-template-columns: 290px minmax(0, 1fr);
  }
}

@media (max-width: 980px) {
  .sql-workbench {
    grid-template-columns: 1fr;
  }

  .sql-library {
    max-height: none;
    padding-right: 0;
    border-right: 0;
    border-bottom: 1px solid rgba(216, 209, 195, 0.9);
    padding-bottom: 14px;
  }
}
</style>
