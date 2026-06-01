<template>
  <section class="page-card fill-card sql-console">
    <div class="toolbar">
      <el-select v-model="connectionId" placeholder="选择连接" style="width: 220px">
        <el-option v-for="item in connections" :key="item.id" :label="item.name" :value="item.id" />
      </el-select>
      <el-input v-model="database" placeholder="数据库，可选" style="width: 180px" />
      <el-button @click="preview">预览风险</el-button>
      <el-button type="primary" @click="execute">执行</el-button>
    </div>
    <el-input v-model="sql" type="textarea" :rows="8" class="mono sql-editor" placeholder="SELECT * FROM db.table WHERE ts >= '...' LIMIT 100" />
    <el-alert style="margin: 14px 0" type="warning" show-icon :closable="false" title="写 SQL 必须输入 CONFIRM；DROP/ALTER/CREATE/IMPORT/UPDATE 默认禁止。" />
    <el-input v-model="confirmText" placeholder="写 SQL 输入 CONFIRM" style="width: 260px; margin-bottom: 14px" />
    <pre v-if="previewSql" class="sql-preview mono">{{ previewSql }}</pre>
    <div class="sql-result">
      <el-table :data="rows" border height="100%" style="margin-top: 14px">
        <el-table-column v-for="column in columns" :key="column" :prop="column" :label="column" min-width="160" show-overflow-tooltip />
      </el-table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "../api/http";

interface ConnectionItem { id: string; name: string }

const connections = ref<ConnectionItem[]>([]);
const connectionId = ref("");
const database = ref("");
const sql = ref("SHOW DATABASES");
const confirmText = ref("");
const previewSql = ref("");
const rows = ref<Record<string, unknown>[]>([]);
const columns = computed(() => Array.from(new Set(rows.value.flatMap((row) => Object.keys(row)))));

onMounted(async () => {
  connections.value = await http.get<ConnectionItem[]>("/connections");
  connectionId.value = connections.value[0]?.id || "";
});

async function preview() {
  const result = await http.post<{ sql: string; riskLevel: string }>(`/tdengine/${connectionId.value}/sql/preview`, { database: database.value, sql: sql.value });
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
  ElMessage.success("执行完成");
}
</script>
