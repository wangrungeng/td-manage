<template>
  <section class="account-page">
    <div class="account-hero page-card">
      <div class="account-avatar">{{ initials }}</div>
      <div class="account-summary">
        <span class="eyebrow">ACCOUNT CONTROL</span>
        <h2>{{ auth.user?.displayName || auth.user?.username }}</h2>
        <p class="mono">{{ auth.user?.username }}</p>
        <div class="role-row">
          <el-tag v-for="role in auth.user?.roles || []" :key="role" effect="dark">{{ role }}</el-tag>
          <el-button v-if="auth.hasPermission('system:user:manage')" size="small" type="warning" @click="router.push('/users')">账号管理</el-button>
        </div>
      </div>
    </div>

    <div class="account-grid">
      <section class="page-card account-panel">
        <div class="panel-heading">
          <h3>基本信息</h3>
          <p>用户名作为登录标识暂不支持修改。</p>
        </div>
        <el-form label-position="top" :model="profileForm">
          <el-form-item label="用户名">
            <el-input :model-value="auth.user?.username" disabled />
          </el-form-item>
          <el-form-item label="显示名">
            <el-input v-model="profileForm.displayName" maxlength="64" show-word-limit />
          </el-form-item>
          <el-button type="primary" :loading="savingProfile" @click="saveProfile">保存账号信息</el-button>
        </el-form>
      </section>

      <section class="page-card account-panel password-panel">
        <div class="panel-heading">
          <h3>修改密码</h3>
          <p>新密码至少 8 位，修改后当前登录状态保持有效。</p>
        </div>
        <el-form label-position="top" :model="passwordForm">
          <el-form-item label="原密码">
            <el-input v-model="passwordForm.oldPassword" type="password" show-password autocomplete="current-password" />
          </el-form-item>
          <el-form-item label="新密码">
            <el-input v-model="passwordForm.newPassword" type="password" show-password autocomplete="new-password" />
          </el-form-item>
          <el-form-item label="确认新密码">
            <el-input v-model="passwordForm.confirmPassword" type="password" show-password autocomplete="new-password" />
          </el-form-item>
          <el-button type="primary" :loading="savingPassword" @click="changePassword">修改密码</el-button>
        </el-form>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();
const { user } = storeToRefs(auth);
const profileForm = reactive({ displayName: "" });
const passwordForm = reactive({ oldPassword: "", newPassword: "", confirmPassword: "" });
const savingProfile = ref(false);
const savingPassword = ref(false);

const initials = computed(() => {
  const source = user.value?.displayName || user.value?.username || "U";
  return source.trim().slice(0, 2).toUpperCase();
});

watch(
  user,
  (value) => {
    profileForm.displayName = value?.displayName || "";
  },
  { immediate: true }
);

async function saveProfile() {
  const displayName = profileForm.displayName.trim();
  if (!displayName) {
    ElMessage.warning("请输入显示名");
    return;
  }

  savingProfile.value = true;
  try {
    await auth.updateMe({ displayName });
    ElMessage.success("账号信息已保存");
  } finally {
    savingProfile.value = false;
  }
}

async function changePassword() {
  if (!passwordForm.oldPassword) {
    ElMessage.warning("请输入原密码");
    return;
  }
  if (passwordForm.newPassword.length < 8) {
    ElMessage.warning("新密码至少 8 位");
    return;
  }
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    ElMessage.warning("两次输入的新密码不一致");
    return;
  }

  savingPassword.value = true;
  try {
    await auth.changePassword({ oldPassword: passwordForm.oldPassword, newPassword: passwordForm.newPassword });
    Object.assign(passwordForm, { oldPassword: "", newPassword: "", confirmPassword: "" });
    ElMessage.success("密码已修改");
  } finally {
    savingPassword.value = false;
  }
}
</script>
