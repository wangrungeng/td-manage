<template>
  <section class="page-card fill-card audit-page">
    <div class="toolbar">
      <el-input v-model="keyword" placeholder="搜索用户、连接、表或 SQL" style="width: 280px" />
      <el-select v-model="operation" clearable placeholder="操作" style="width: 180px">
        <el-option label="create" value="create" />
        <el-option label="update" value="update" />
        <el-option label="delete" value="delete" />
        <el-option label="sql_execute" value="sql_execute" />
        <el-option label="connection_test" value="connection_test" />
      </el-select>
      <el-button type="primary" @click="loadLogs">查询</el-button>
    </div>
    <div class="table-fill">
      <el-table :data="logs" border height="100%">
        <el-table-column prop="created_at" label="时间" min-width="180" />
        <el-table-column prop="username" label="用户" width="120" />
        <el-table-column prop="connection_name" label="连接" width="150" />
        <el-table-column prop="operation" label="操作" width="120" />
        <el-table-column prop="risk_level" label="风险" width="90" />
        <el-table-column prop="success" label="成功" width="80" />
        <el-table-column prop="sql_text" label="SQL" min-width="360" show-overflow-tooltip />
        <el-table-column label="详情" width="90">
          <template #default="{ row }"><el-button size="small" @click="showDetail(row)">查看</el-button></template>
        </el-table-column>
      </el-table>
    </div>
  </section>
  <el-dialog v-model="visible" title="审计详情" width="860px">
    <pre class="sql-preview mono">{{ JSON.stringify(current, null, 2) }}</pre>
  </el-dialog>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { http } from "../api/http";

const logs = ref<Record<string, unknown>[]>([]);
const keyword = ref("");
const operation = ref("");
const visible = ref(false);
const current = ref<Record<string, unknown>>({});

onMounted(loadLogs);

async function loadLogs() {
  const result = await http.get<{ items: Record<string, unknown>[] }>("/audit-logs", { params: { keyword: keyword.value, operation: operation.value || undefined } });
  logs.value = result.items;
}

function showDetail(row: Record<string, unknown>) {
  current.value = row;
  visible.value = true;
}
</script>
