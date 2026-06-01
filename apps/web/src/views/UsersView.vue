<template>
  <section class="page-card fill-card users-page">
    <div class="account-manager-header">
      <div>
        <span class="eyebrow">ACCOUNT MANAGEMENT</span>
        <h2>账号管理</h2>
        <p>创建账号、查看账号列表，并维护显示名、状态、角色和密码。</p>
      </div>
      <div class="toolbar account-manager-actions">
        <el-button type="primary" @click="openCreate">创建账号</el-button>
        <el-button @click="loadUsers">刷新列表</el-button>
      </div>
    </div>
    <div class="account-list-title">
      <h3>账号列表</h3>
      <span>共 {{ users.length }} 个账号</span>
    </div>
    <div class="table-fill">
      <el-table :data="users" border height="100%" empty-text="暂无账号，请先创建账号">
        <el-table-column prop="username" label="用户名" min-width="140" />
        <el-table-column prop="display_name" label="显示名" min-width="160" />
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'danger'">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="角色" min-width="180">
          <template #default="{ row }">
            <el-tag v-for="role in row.roles" :key="role" style="margin-right: 4px">{{ role }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="warning" @click="openResetPassword(row)">重置密码</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </section>

  <el-dialog v-model="visible" :title="editingId ? '编辑账号' : '创建账号'" width="560px">
    <el-form :model="form" label-width="100px">
      <el-form-item label="用户名">
        <el-input v-model="form.username" :disabled="Boolean(editingId)" maxlength="32" />
      </el-form-item>
      <el-form-item label="显示名">
        <el-input v-model="form.displayName" maxlength="64" />
      </el-form-item>
      <el-form-item v-if="!editingId" label="密码">
        <el-input v-model="form.password" type="password" show-password autocomplete="new-password" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="form.status">
          <el-option label="active" value="active" />
          <el-option label="disabled" value="disabled" />
        </el-select>
      </el-form-item>
      <el-form-item label="角色">
        <el-checkbox-group v-model="form.roleCodes">
          <el-checkbox v-for="role in roles" :key="role.code" :label="role.code">
            {{ role.name || role.code }}
          </el-checkbox>
        </el-checkbox-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="resetVisible" title="重置密码" width="460px">
    <el-alert
      v-if="resetTarget?.id === auth.user?.id"
      title="正在重置当前登录账号的密码，请牢记新密码。"
      type="warning"
      show-icon
      :closable="false"
      style="margin-bottom: 16px"
    />
    <el-form :model="resetForm" label-width="110px">
      <el-form-item label="账号">
        <el-input :model-value="resetTarget?.username" disabled />
      </el-form-item>
      <el-form-item label="新密码">
        <el-input v-model="resetForm.password" type="password" show-password autocomplete="new-password" />
      </el-form-item>
      <el-form-item label="确认新密码">
        <el-input v-model="resetForm.confirmPassword" type="password" show-password autocomplete="new-password" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="resetVisible = false">取消</el-button>
      <el-button type="primary" :loading="resetting" @click="resetPassword">确认重置</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "../api/http";
import { useAuthStore } from "../stores/auth";

interface RoleItem { id: string; code: string; name: string; description?: string }
interface UserItem { id: string; username: string; display_name: string; status: string; roles: string[] }
interface UserForm { username: string; displayName: string; password: string; status: string; roleCodes: string[] }

const auth = useAuthStore();
const users = ref<UserItem[]>([]);
const roles = ref<RoleItem[]>([]);
const visible = ref(false);
const resetVisible = ref(false);
const saving = ref(false);
const resetting = ref(false);
const editingId = ref("");
const resetTarget = ref<UserItem | null>(null);
const form = reactive<UserForm>({ username: "", displayName: "", password: "", status: "active", roleCodes: ["viewer"] });
const resetForm = reactive({ password: "", confirmPassword: "" });

onMounted(async () => {
  await Promise.all([loadRoles(), loadUsers()]);
});

async function loadUsers() {
  users.value = await http.get<UserItem[]>("/users");
}

async function loadRoles() {
  roles.value = await http.get<RoleItem[]>("/roles");
}

function openCreate() {
  editingId.value = "";
  Object.assign(form, { username: "", displayName: "", password: "", status: "active", roleCodes: ["viewer"] });
  visible.value = true;
}

function openEdit(row: UserItem) {
  editingId.value = row.id;
  Object.assign(form, { username: row.username, displayName: row.display_name, password: "", status: row.status, roleCodes: [...row.roles] });
  visible.value = true;
}

function openResetPassword(row: UserItem) {
  resetTarget.value = row;
  Object.assign(resetForm, { password: "", confirmPassword: "" });
  resetVisible.value = true;
}

async function save() {
  if (!validateUserForm()) return;

  saving.value = true;
  try {
    if (editingId.value) {
      await http.patch(`/users/${editingId.value}`, { displayName: form.displayName.trim(), status: form.status, roleCodes: form.roleCodes });
    } else {
      await http.post("/users", { ...form, username: form.username.trim(), displayName: form.displayName.trim() });
    }
    visible.value = false;
    await loadUsers();
    if (editingId.value === auth.user?.id) {
      await auth.loadMe();
    }
    ElMessage.success("用户已保存");
  } finally {
    saving.value = false;
  }
}

async function resetPassword() {
  if (!resetTarget.value) return;
  if (resetForm.password.length < 8) {
    ElMessage.warning("新密码至少 8 位");
    return;
  }
  if (resetForm.password !== resetForm.confirmPassword) {
    ElMessage.warning("两次输入的新密码不一致");
    return;
  }

  resetting.value = true;
  try {
    await http.post(`/users/${resetTarget.value.id}/reset-password`, { password: resetForm.password });
    resetVisible.value = false;
    ElMessage.success("密码已重置");
  } finally {
    resetting.value = false;
  }
}

function validateUserForm() {
  if (!editingId.value && (form.username.trim().length < 3 || form.username.trim().length > 32)) {
    ElMessage.warning("用户名需为 3-32 位");
    return false;
  }
  if (!form.displayName.trim()) {
    ElMessage.warning("请输入显示名");
    return false;
  }
  if (!editingId.value && form.password.length < 8) {
    ElMessage.warning("密码至少 8 位");
    return false;
  }
  if (!form.roleCodes.length) {
    ElMessage.warning("请至少选择一个角色");
    return false;
  }
  return true;
}
</script>
