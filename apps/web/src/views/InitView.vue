<template>
  <div class="auth-shell">
    <section class="auth-hero">
      <h1>Bootstrap your private data console.</h1>
      <p>首次启动需要创建本地管理员。账号只保存在本机 SQLite，不会连接任何 TDengine，直到你主动配置连接。</p>
    </section>
    <section class="auth-panel">
      <el-form class="auth-card" :model="form" label-position="top">
        <h2>初始化管理员</h2>
        <el-form-item label="用户名">
          <el-input v-model="form.username" />
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="form.displayName" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" show-password />
        </el-form-item>
        <el-button type="primary" size="large" :loading="loading" style="width: 100%" @click="submit">创建管理员</el-button>
      </el-form>
    </section>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();
const loading = ref(false);
const form = reactive({ username: "admin", displayName: "管理员", password: "" });

async function submit() {
  loading.value = true;
  try {
    await auth.initAdmin(form);
    ElMessage.success("初始化完成，请登录");
    router.push("/login");
  } finally {
    loading.value = false;
  }
}
</script>
