<template>
  <div class="split-grid data-workbench">
    <section class="page-card data-sidebar">
      <h3>库表定位</h3>
      <el-form label-position="top">
        <el-form-item label="连接">
          <el-select v-model="selectedConnection" style="width: 100%" @change="loadDatabases">
            <el-option v-for="item in connections" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="数据库">
          <el-input v-model="query.database" placeholder="例如 power" />
        </el-form-item>
        <el-form-item label="表名">
          <el-input v-model="query.table" placeholder="普通表或子表" />
        </el-form-item>
        <el-form-item label="表类型">
          <el-tag :type="selectedTableType === 'stable' ? 'warning' : 'success'">{{ selectedTableType === 'stable' ? '超级表' : '普通表/子表' }}</el-tag>
        </el-form-item>
        <div class="sidebar-actions">
          <el-button @click="loadDatabases">刷新数据库</el-button>
          <el-button type="primary" @click="loadTables">刷新表</el-button>
        </div>
      </el-form>
      <el-divider />
      <div class="data-sidebar-scroll tree-shell">
        <el-tree
          v-loading="treeLoading"
          :data="treeData"
          node-key="id"
          :props="treeProps"
          lazy
          :load="loadTreeNode"
          highlight-current
          @node-click="handleTreeClick"
        >
          <template #default="{ node, data }">
            <span class="tree-node" :class="`tree-node-${data.type}`">
              <span class="tree-dot" />
              <span class="tree-label">{{ node.label }}</span>
              <span v-if="data.badge" class="tree-badge">{{ data.badge }}</span>
            </span>
          </template>
        </el-tree>
      </div>
    </section>

    <section class="page-card data-main">
      <div class="toolbar">
        <el-date-picker v-model="timeRange" type="datetimerange" start-placeholder="开始时间" end-placeholder="结束时间" value-format="YYYY-MM-DD HH:mm:ss" />
        <el-input-number v-model="query.pageSize" :min="1" :max="1000" />
        <el-button type="primary" @click="loadRows">查询</el-button>
        <el-button type="success" @click="openCreate">新增</el-button>
      </div>
      <el-alert title="查询默认必须带时间范围，避免大表无边界扫描。" type="info" show-icon :closable="false" style="margin-bottom: 14px" />
      <div class="data-table-wrap">
        <el-table :data="rows" border height="100%">
          <el-table-column v-for="column in columns" :key="column" :prop="column" :label="column" min-width="160" show-overflow-tooltip />
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <el-button size="small" @click="openEdit(row)">编辑</el-button>
              <el-button size="small" type="danger" @click="openDelete(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <pre v-if="lastSql" class="sql-preview mono">{{ lastSql }}</pre>
    </section>
  </div>

  <el-dialog v-model="editVisible" :title="editMode === 'create' ? '新增数据' : '编辑数据'" width="820px">
    <el-alert v-if="editMode === 'edit'" title="编辑会使用同表同时间戳 INSERT 覆盖写入，时间戳 ts 不允许修改。" type="warning" show-icon :closable="false" />
    <el-form label-position="top" style="margin-top: 16px">
      <el-form-item label="JSON 数据">
        <el-input v-model="editJson" type="textarea" :rows="10" class="mono" />
      </el-form-item>
      <el-button @click="previewEdit">生成 SQL 预览</el-button>
    </el-form>
    <pre v-if="previewSql" class="sql-preview mono">{{ previewSql }}</pre>
    <template #footer>
      <el-button @click="editVisible = false">取消</el-button>
      <el-button type="primary" :disabled="!previewSql" @click="executeEdit">确认执行</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="deleteVisible" title="删除数据强确认" width="760px">
    <p class="danger-text">删除不可恢复。必须精确定位到当前表和 ts，并输入 DELETE。</p>
    <pre v-if="previewSql" class="sql-preview mono">{{ previewSql }}</pre>
    <el-input v-model="deleteConfirm" placeholder="输入 DELETE" />
    <template #footer>
      <el-button @click="deleteVisible = false">取消</el-button>
      <el-button type="danger" :disabled="deleteConfirm.trim().toUpperCase() !== 'DELETE'" @click="executeDelete">确认删除</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import dayjs from "dayjs";
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "../api/http";

interface ConnectionItem { id: string; name: string }
interface TreeNodeData {
  id: string;
  label: string;
  type: "connection" | "database" | "tableGroup" | "stableGroup" | "table" | "stable";
  connectionId?: string;
  database?: string;
  table?: string;
  tableType?: "table" | "stable";
  leaf?: boolean;
  badge?: string;
}

const connections = ref<ConnectionItem[]>([]);
const selectedConnection = ref("");
const databases = ref<Record<string, unknown>[]>([]);
const tables = ref<Record<string, unknown>[]>([]);
const stables = ref<Record<string, unknown>[]>([]);
const treeLoading = ref(false);
const rows = ref<Record<string, unknown>[]>([]);
const columns = computed(() => Array.from(new Set(rows.value.flatMap((row) => Object.keys(row)))));
const lastSql = ref("");
const timeRange = ref<[string, string]>([
  dayjs().subtract(1, "hour").format("YYYY-MM-DD HH:mm:ss"),
  dayjs().format("YYYY-MM-DD HH:mm:ss")
]);
const query = reactive({ database: "", table: "", page: 1, pageSize: 100 });
const selectedTableType = ref<"table" | "stable">("table");

const editVisible = ref(false);
const editMode = ref<"create" | "edit">("create");
const editJson = ref("{}");
const originalRow = ref<Record<string, unknown>>({});
const previewSql = ref("");
const deleteVisible = ref(false);
const deleteConfirm = ref("");
const deletingTimestamp = ref("");
const deletingTargetTable = ref("");
const treeProps = { label: "label", isLeaf: "leaf" };
const treeData = computed<TreeNodeData[]>(() =>
  connections.value.map((connection) => ({
    id: `conn:${connection.id}`,
    label: connection.name,
    type: "connection",
    connectionId: connection.id,
    badge: "连接"
  }))
);

onMounted(async () => {
  connections.value = await http.get<ConnectionItem[]>("/connections");
  selectedConnection.value = connections.value[0]?.id || "";
  if (selectedConnection.value) {
    await loadDatabases();
  }
});

async function loadDatabases() {
  if (!selectedConnection.value) return;
  treeLoading.value = true;
  try {
    databases.value = await http.get<Record<string, unknown>[]>(`/tdengine/${selectedConnection.value}/databases`);
  } finally {
    treeLoading.value = false;
  }
}

async function loadTables() {
  if (!selectedConnection.value || !query.database) return;
  const result = await http.get<{ tables: Record<string, unknown>[]; stables: Record<string, unknown>[] }>(
    `/tdengine/${selectedConnection.value}/databases/${query.database}/tables`
  );
  tables.value = result.tables;
  stables.value = result.stables;
}

function tableName(row: Record<string, unknown>) {
  return String(row.table_name || row.stable_name || row.name || row.Table || Object.values(row)[0] || "");
}

function databaseName(row: Record<string, unknown>) {
  return String(row.name || row.database_name || row.Database || Object.values(row)[0] || "");
}

async function loadTreeNode(node: { level: number; data: TreeNodeData }, resolve: (data: TreeNodeData[]) => void) {
  if (node.level === 0) {
    resolve(treeData.value);
    return;
  }

  const data = node.data;
  if (data.type === "connection") {
    selectedConnection.value = data.connectionId || selectedConnection.value;
    const rows = await http.get<Record<string, unknown>[]>(`/tdengine/${selectedConnection.value}/databases`);
    databases.value = rows;
    resolve(
      rows
        .map(databaseName)
        .filter(Boolean)
        .map((name) => ({
          id: `db:${selectedConnection.value}:${name}`,
          label: name,
          type: "database",
          connectionId: selectedConnection.value,
          database: name,
          badge: "库"
        }))
    );
    return;
  }

  if (data.type === "database") {
    resolve([
      {
        id: `tables:${data.connectionId}:${data.database}`,
        label: "普通表",
        type: "tableGroup",
        connectionId: data.connectionId,
        database: data.database
      },
      {
        id: `stables:${data.connectionId}:${data.database}`,
        label: "超级表",
        type: "stableGroup",
        connectionId: data.connectionId,
        database: data.database
      }
    ]);
    return;
  }

  if (data.type === "tableGroup" || data.type === "stableGroup") {
    const result = await http.get<{ tables: Record<string, unknown>[]; stables: Record<string, unknown>[] }>(
      `/tdengine/${data.connectionId}/databases/${data.database}/tables`
    );
    if (data.type === "tableGroup") {
      tables.value = result.tables;
      resolve(
        result.tables.map((table) => ({
          id: `table:${data.connectionId}:${data.database}:${tableName(table)}`,
          label: tableName(table),
          type: "table",
          connectionId: data.connectionId,
          database: data.database,
          table: tableName(table),
          tableType: "table",
          leaf: true
        }))
      );
      return;
    }

    stables.value = result.stables;
    resolve(
      result.stables.map((stable) => ({
        id: `stable:${data.connectionId}:${data.database}:${tableName(stable)}`,
        label: tableName(stable),
        type: "stable",
        connectionId: data.connectionId,
        database: data.database,
        table: tableName(stable),
        tableType: "stable",
        leaf: true
      }))
    );
    return;
  }

  resolve([]);
}

function handleTreeClick(data: TreeNodeData) {
  if (data.connectionId) {
    selectedConnection.value = data.connectionId;
  }
  if (data.database) {
    query.database = data.database;
  }
  if (data.table) {
    query.table = data.table;
    selectedTableType.value = data.tableType || (data.type === "stable" ? "stable" : "table");
  }
}

async function loadRows() {
  const fields = selectedTableType.value === "stable" ? ["tbname"] : undefined;
  const result = await http.post<{ sql: string; items: Record<string, unknown>[] }>(`/tdengine/${selectedConnection.value}/data/query`, {
    ...query,
    fields,
    startTime: timeRange.value[0],
    endTime: timeRange.value[1]
  });
  rows.value = result.items;
  lastSql.value = result.sql;
}

function openCreate() {
  editMode.value = "create";
  originalRow.value = {};
  editJson.value = JSON.stringify({ ts: dayjs().format("YYYY-MM-DD HH:mm:ss") }, null, 2);
  previewSql.value = "";
  editVisible.value = true;
}

function openEdit(row: Record<string, unknown>) {
  editMode.value = "edit";
  originalRow.value = row;
  editJson.value = JSON.stringify(row, null, 2);
  previewSql.value = "";
  editVisible.value = true;
}

async function previewEdit() {
  const values = JSON.parse(editJson.value) as Record<string, unknown>;
  const path = editMode.value === "create" ? "create" : "update";
  const payload = editMode.value === "create" ? buildEditPayload(values) : buildEditPayload(values, originalRow.value);
  const result = await http.post<{ sql: string }>(`/tdengine/${selectedConnection.value}/data/${path}/preview`, payload);
  previewSql.value = result.sql;
}

async function executeEdit() {
  const values = JSON.parse(editJson.value) as Record<string, unknown>;
  const path = editMode.value === "create" ? "create" : "update";
  const payload = editMode.value === "create" ? buildEditPayload(values) : buildEditPayload(values, originalRow.value);
  await http.post(`/tdengine/${selectedConnection.value}/data/${path}/execute`, payload);
  ElMessage.success("执行成功");
  editVisible.value = false;
  await loadRows();
}

function buildEditPayload(values: Record<string, unknown>, original?: Record<string, unknown>) {
  const targetTable = selectedTableType.value === "stable" ? String(values.tbname || original?.tbname || "") : undefined;
  if (selectedTableType.value === "stable" && !targetTable) {
    throw new Error("超级表新增或编辑必须包含子表名 tbname");
  }
  return original ? { ...query, targetTable, original, values } : { ...query, targetTable, values };
}

async function openDelete(row: Record<string, unknown>) {
  deletingTimestamp.value = String(row.ts || row.TS || "");
  deletingTargetTable.value = selectedTableType.value === "stable" ? readRowStringField(row, "tbname") : "";
  if (selectedTableType.value === "stable" && !deletingTargetTable.value) {
    ElMessage.error("超级表删除必须先定位到子表 tbname");
    return;
  }
  deleteConfirm.value = "";
  const result = await http.post<{ sql: string }>(`/tdengine/${selectedConnection.value}/data/delete/preview`, {
    ...query,
    targetTable: deletingTargetTable.value || undefined,
    timestamp: deletingTimestamp.value
  });
  previewSql.value = result.sql;
  deleteVisible.value = true;
}

async function executeDelete() {
  await http.post(`/tdengine/${selectedConnection.value}/data/delete/execute`, {
    ...query,
    targetTable: deletingTargetTable.value || undefined,
    timestamp: deletingTimestamp.value,
    confirmText: deleteConfirm.value.trim().toUpperCase()
  });
  ElMessage.success("删除成功");
  deleteVisible.value = false;
  await loadRows();
}

function readRowStringField(row: Record<string, unknown>, field: string) {
  const entry = Object.entries(row).find(([key]) => key.toLowerCase() === field.toLowerCase());
  const value = entry?.[1];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
</script>
