<template>
  <section class="page-card fill-card connections-page">
    <div class="toolbar">
      <el-button type="primary" @click="openCreate">新增连接</el-button>
      <el-button @click="loadConnections">刷新</el-button>
    </div>
    <div class="table-fill">
      <el-table :data="connections" border height="100%">
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column label="地址" min-width="220">
          <template #default="{ row }">{{ row.protocol }}://{{ row.host }}:{{ row.port }}</template>
        </el-table-column>
        <el-table-column prop="username" label="用户" width="120" />
        <el-table-column prop="default_database" label="默认库" width="140" />
        <el-table-column prop="last_test_status" label="测试状态" width="110" />
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="testConnection(row.id)">测试</el-button>
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-popconfirm title="删除连接配置？不会删除 TDengine 数据。" @confirm="removeConnection(row.id)">
              <template #reference><el-button size="small" type="danger">删除</el-button></template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </section>

  <el-dialog v-model="dialogVisible" :title="editingId ? '编辑连接' : '新增连接'" width="620px">
    <el-form :model="form" label-width="120px">
      <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
      <el-form-item label="协议">
        <el-select v-model="form.protocol"><el-option label="ws" value="ws" /><el-option label="wss" value="wss" /></el-select>
      </el-form-item>
      <el-form-item label="主机"><el-input v-model="form.host" /></el-form-item>
      <el-form-item label="端口"><el-input-number v-model="form.port" :min="1" :max="65535" /></el-form-item>
      <el-form-item label="用户名"><el-input v-model="form.username" /></el-form-item>
      <el-form-item label="密码"><el-input v-model="form.password" type="password" show-password placeholder="编辑时留空则不修改" /></el-form-item>
      <el-form-item label="默认数据库"><el-input v-model="form.defaultDatabase" /></el-form-item>
      <el-form-item label="时区"><el-input v-model="form.timezone" placeholder="例如 UTC" /></el-form-item>
      <el-form-item label="备注"><el-input v-model="form.remark" type="textarea" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" @click="saveConnection">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "../api/http";

interface ConnectionItem {
  id: string;
  name: string;
  protocol: "ws" | "wss";
  host: string;
  port: number;
  username: string;
  default_database?: string;
  timezone?: string;
  remark?: string;
  last_test_status: string;
}

const connections = ref<ConnectionItem[]>([]);
const dialogVisible = ref(false);
const editingId = ref("");
const form = reactive({
  name: "",
  protocol: "ws" as "ws" | "wss",
  host: "127.0.0.1",
  port: 6041,
  username: "root",
  password: "",
  defaultDatabase: "",
  timezone: "UTC",
  remark: ""
});

onMounted(loadConnections);

async function loadConnections() {
  connections.value = await http.get<ConnectionItem[]>("/connections");
}

function openCreate() {
  editingId.value = "";
  Object.assign(form, { name: "", protocol: "ws", host: "127.0.0.1", port: 6041, username: "root", password: "", defaultDatabase: "", timezone: "UTC", remark: "" });
  dialogVisible.value = true;
}

function openEdit(row: ConnectionItem) {
  editingId.value = row.id;
  Object.assign(form, {
    name: row.name,
    protocol: row.protocol,
    host: row.host,
    port: row.port,
    username: row.username,
    password: "",
    defaultDatabase: row.default_database || "",
    timezone: row.timezone || "UTC",
    remark: row.remark || ""
  });
  dialogVisible.value = true;
}

async function saveConnection() {
  try {
    const payload = { ...form, password: form.password || undefined };
    if (editingId.value) await http.patch(`/connections/${editingId.value}`, payload);
    else await http.post("/connections", payload);
    dialogVisible.value = false;
    await loadConnections();
    ElMessage.success("连接已保存");
  } catch {
    // 错误由全局拦截器提示。
  }
}

async function testConnection(id: string) {
  try {
    await http.post(`/connections/${id}/test`);
    ElMessage.success("连接测试成功");
  } catch {
    // 错误由全局拦截器提示，失败状态由后端写入连接记录。
  } finally {
    await loadConnections();
  }
}

async function removeConnection(id: string) {
  try {
    await http.delete(`/connections/${id}`);
    await loadConnections();
  } catch {
    // 错误由全局拦截器提示。
  }
}
</script>
